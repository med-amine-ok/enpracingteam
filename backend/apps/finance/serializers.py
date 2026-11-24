from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member, OrgUnit
from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer
from apps.purchasing.models import Invoice

from .access import finance_access_for
from .budgets import unit_id_of
from .models import Budget, Expense, ExpenseCategory, Sponsorship, SponsorshipStatus
from .years import fiscal_year_of, is_fiscal_year

MONEY = {"max_digits": 14, "decimal_places": 2, "read_only": True}
CONTACT_FIELDS = ("contact_name", "contact_email")


# --- Budgets ---


class BudgetSerializer(serializers.ModelSerializer):
    """A budget with its figures in dinars (apps/finance/budgets.py)."""

    org_unit = OrgUnitSummarySerializer(read_only=True)
    parent_unit_id = serializers.IntegerField(
        source="org_unit.parent_id", read_only=True, allow_null=True, help_text="The unit above (to show the tree)."
    )
    spent = serializers.DecimalField(**MONEY, help_text="The expenses imputed to it.")
    committed = serializers.DecimalField(**MONEY, help_text="The orders in progress that will be imputed to it.")
    remaining = serializers.DecimalField(**MONEY, help_text="Allocated - spent - committed (negative: over).")
    spent_percent = serializers.FloatField(read_only=True, allow_null=True, help_text="Spent, in % of the allocation.")
    is_over = serializers.BooleanField(read_only=True, help_text="The expenses are above the allocation.")
    will_exceed = serializers.BooleanField(read_only=True, help_text="Expenses + orders in progress are above it.")

    class Meta:
        model = Budget
        fields = [
            "id", "org_unit", "parent_unit_id", "fiscal_year", "allocated_amount", "spent", "committed", "remaining",
            "spent_percent", "is_over", "will_exceed", "notes", "updated_at",
        ]
        read_only_fields = fields


class CommittedOrderSerializer(serializers.Serializer):
    """An order in progress, counted as committed on a budget until it is delivered."""

    purchase_request_id = serializers.IntegerField(read_only=True)
    part = serializers.CharField(source="purchase_request.part.name", read_only=True)
    supplier = serializers.CharField(source="supplier.name", read_only=True)
    ordered_at = serializers.DateField(read_only=True, allow_null=True)
    total_dzd = serializers.DecimalField(source="total_price_dzd", **MONEY)


class BudgetTotalsSerializer(serializers.Serializer):
    allocated_amount = serializers.DecimalField(**MONEY)
    spent = serializers.DecimalField(**MONEY)
    committed = serializers.DecimalField(**MONEY)
    remaining = serializers.DecimalField(**MONEY)


class BudgetWriteSerializer(serializers.ModelSerializer):
    """A new budget (finance managers). Its unit and year never change afterwards."""

    org_unit = serializers.PrimaryKeyRelatedField(queryset=OrgUnit.objects.filter(is_active=True))

    class Meta:
        model = Budget
        fields = ["org_unit", "fiscal_year", "allocated_amount", "notes"]
        extra_kwargs = {"allocated_amount": {"min_value": 0}}
        validators = []  # one budget per unit and year: checked below, with a clear message

    def validate_fiscal_year(self, value):
        if not is_fiscal_year(value):
            raise serializers.ValidationError(_("A budget year is written as two following years, such as 2026-2027."))
        return value

    def validate(self, data):
        if Budget.objects.filter(org_unit=data["org_unit"], fiscal_year=data["fiscal_year"]).exists():
            raise serializers.ValidationError(
                {"fiscal_year": [_("This unit already has a budget for %(year)s.") % {"year": data["fiscal_year"]}]}
            )
        return data


class BudgetChangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Budget
        fields = ["allocated_amount", "notes"]
        extra_kwargs = {"allocated_amount": {"min_value": 0}}


# --- Expenses ---


class ExpenseBudgetSerializer(serializers.ModelSerializer):
    """The budget an expense is imputed to."""

    org_unit = OrgUnitSummarySerializer(read_only=True)

    class Meta:
        model = Budget
        fields = ["id", "org_unit", "fiscal_year"]
        read_only_fields = fields


class InvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ["id", "reference", "total_amount", "issued_at"]
        read_only_fields = fields


class ExpenseSerializer(serializers.ModelSerializer):
    """An expense: entered by hand, or the one of a delivered order (then with its part and supplier)."""

    budget = ExpenseBudgetSerializer(read_only=True, allow_null=True, help_text="Empty: it waits to be imputed.")
    fiscal_year = serializers.SerializerMethodField()
    recorded_by = MemberSummarySerializer(read_only=True)
    purchase_request_id = serializers.IntegerField(
        source="purchase_order.purchase_request_id", read_only=True, allow_null=True,
        help_text="The purchase request whose order made this expense.",
    )
    part = serializers.CharField(source="purchase_order.purchase_request.part.name", read_only=True, allow_null=True)
    supplier = serializers.CharField(source="purchase_order.supplier.name", read_only=True, allow_null=True)
    invoice = InvoiceSerializer(read_only=True, allow_null=True)
    suggested_unit = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = [
            "id", "budget", "fiscal_year", "amount", "category", "description", "recorded_at", "recorded_by",
            "purchase_request_id", "part", "supplier", "invoice", "suggested_unit", "created_at",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.CharField(help_text="Its budget's year, else the year of its date."))
    def get_fiscal_year(self, expense):
        return expense.budget.fiscal_year if expense.budget_id else fiscal_year_of(expense.recorded_at)

    @extend_schema_field(OrgUnitSummarySerializer(allow_null=True, help_text="For an expense to impute: its order's unit."))
    def get_suggested_unit(self, expense):
        if expense.budget_id is not None or expense.purchase_order_id is None:
            return None
        unit_id = unit_id_of(expense.purchase_order.purchase_request)
        unit = OrgUnit.objects.filter(pk=unit_id).first() if unit_id is not None else None
        return OrgUnitSummarySerializer(unit).data if unit is not None else None


class BudgetDetailSerializer(BudgetSerializer):
    """A budget with its expenses, its orders in progress and the budgets of the units below it (the
    view sets them as attributes)."""

    expenses = ExpenseSerializer(source="expense_list", many=True, read_only=True, help_text="The latest first.")
    committed_orders = CommittedOrderSerializer(many=True, read_only=True)
    children = BudgetSerializer(many=True, read_only=True, help_text="The budgets of the units below, that year.")
    with_children = BudgetTotalsSerializer(read_only=True, help_text="This budget and those below it, together.")

    class Meta(BudgetSerializer.Meta):
        fields = [*BudgetSerializer.Meta.fields, "expenses", "committed_orders", "children", "with_children"]
        read_only_fields = fields


class ExpenseWriteSerializer(serializers.ModelSerializer):
    """An expense entered by hand (finance managers): registration, transport... with its reason."""

    budget = serializers.PrimaryKeyRelatedField(queryset=Budget.objects.all())
    category = serializers.ChoiceField(choices=ExpenseCategory.choices, help_text="Any kind but a purchase.")
    description = serializers.CharField(help_text="What the money was for.")

    class Meta:
        model = Expense
        fields = ["budget", "amount", "category", "recorded_at", "description"]
        extra_kwargs = {"amount": {"min_value": 0}, "recorded_at": {"required": False}}

    def validate_category(self, value):
        if value == ExpenseCategory.PURCHASE:
            raise serializers.ValidationError(_("A purchase becomes an expense when its order is delivered."))
        return value


class ExpenseImputeSerializer(serializers.ModelSerializer):
    """The budget of the expense of an order: the only thing that changes (the rest follows the order)."""

    budget = serializers.PrimaryKeyRelatedField(queryset=Budget.objects.all())

    class Meta:
        model = Expense
        fields = ["budget"]


class InvoiceWriteSerializer(serializers.ModelSerializer):
    """The supplier's invoice of a delivered order (its supplier is the order's)."""

    class Meta:
        model = Invoice
        fields = ["reference", "total_amount", "issued_at"]
        extra_kwargs = {"total_amount": {"min_value": 0}}
        validators = []  # one reference per supplier: checked by the view, which knows the supplier


# --- Sponsors ---


class SponsorshipSerializer(serializers.ModelSerializer):
    """A sponsor followed by the club. Its contacts are null for those not allowed to see them."""

    managed_by = MemberSummarySerializer(read_only=True, allow_null=True)

    class Meta:
        model = Sponsorship
        fields = [
            "id", "sponsor_name", "status", "amount", "in_kind_description", *CONTACT_FIELDS, "managed_by", "notes",
            "confirmed_at", "created_at", "updated_at",
        ]
        read_only_fields = fields  # output only: every field is always present
        extra_kwargs = {field: {"allow_null": True} for field in CONTACT_FIELDS}

    def to_representation(self, sponsorship):
        data = super().to_representation(sponsorship)
        if not finance_access_for(self.context["request"]).can_manage_sponsors():
            for field in CONTACT_FIELDS:
                data[field] = None
        return data


class SponsorshipWriteSerializer(serializers.ModelSerializer):
    """Add or change a sponsor (Operations, admins). The answer is the sponsor as SponsorshipSerializer shows it."""

    managed_by_id = serializers.PrimaryKeyRelatedField(
        source="managed_by", queryset=Member.objects.filter(is_active=True), allow_null=True, required=False,
        help_text="The member who follows this sponsor (the author when not given).",
    )
    status = serializers.ChoiceField(choices=SponsorshipStatus.choices, required=False)

    class Meta:
        model = Sponsorship
        fields = [
            "sponsor_name", "status", "amount", "in_kind_description", *CONTACT_FIELDS, "managed_by_id", "notes",
            "confirmed_at",
        ]
        extra_kwargs = {"amount": {"min_value": 0}}


# --- Counters ---


class FinanceSummarySerializer(serializers.Serializer):
    fiscal_year = serializers.CharField()
    can_manage = serializers.BooleanField(help_text="Set the budgets, enter the expenses (treasurer, admins).")
    can_see_all = serializers.BooleanField(help_text="Sees every budget and the expenses to impute.")
    can_see_budgets = serializers.BooleanField()
    can_see_sponsors = serializers.BooleanField()
    can_manage_sponsors = serializers.BooleanField()
    budgets = serializers.IntegerField(help_text="Budgets of that year the viewer sees.")
    over_budget = serializers.IntegerField(help_text="Among them, those whose expenses are above the allocation.")
    to_impute = serializers.IntegerField(allow_null=True, help_text="Expenses waiting for a budget (null: not shown).")


class SponsorshipSummarySerializer(serializers.Serializer):
    fiscal_year = serializers.CharField()
    by_status = serializers.DictField(child=serializers.IntegerField(), help_text="How many sponsors at each stage.")
    confirmed_total = serializers.DecimalField(max_digits=14, decimal_places=2, help_text="Confirmed that year, in DA.")
    can_manage = serializers.BooleanField()
