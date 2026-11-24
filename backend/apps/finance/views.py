"""
The finance API (knowledge base: PROJECTS/ERP/finance_design.md §10, decision D-011): the budgets with
their figures, the expenses (of the delivered orders, or entered by hand), the suppliers' invoices,
and the sponsors. Who may do what: access.py. The money of the budgets: budgets.py.
"""

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.purchasing.models import Invoice

from . import budgets as money
from .access import finance_access_for
from .models import Budget, Expense, ExpenseCategory, Sponsorship, SponsorshipStatus
from .serializers import (
    BudgetChangeSerializer, BudgetDetailSerializer, BudgetSerializer, BudgetWriteSerializer, ExpenseImputeSerializer,
    ExpenseSerializer, ExpenseWriteSerializer, FinanceSummarySerializer, InvoiceWriteSerializer, SponsorshipSerializer,
    SponsorshipSummarySerializer, SponsorshipWriteSerializer,
)
from .years import current_fiscal_year, fiscal_year_bounds, is_fiscal_year

EXPENSE_RELATIONS = (
    "budget__org_unit", "recorded_by", "invoice", "purchase_order__supplier", "purchase_order__purchase_request__part",
    "purchase_order__purchase_request__subsystem",
)
YEAR = OpenApiParameter("year", str, description="A budget year, such as 2026-2027 (default: the current one).")


def year_param(request, default=True):
    year = request.query_params.get("year") or (current_fiscal_year() if default else "")
    if year and not is_fiscal_year(year):
        raise ValidationError({"year": [_("A budget year is written as two following years, such as 2026-2027.")]})
    return year


def integer(params, name):
    value = params.get(name)
    if value and not value.isdigit():
        raise ValidationError({name: _("A number is expected.")})
    return int(value) if value else None


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def require_manager(request):
    require(finance_access_for(request).can_manage(), _("Only the treasurer and the admins manage the club's money."))


class FinanceSummaryView(APIView):
    @extend_schema(
        summary="What the viewer may do with the club's money, and the key figures of a budget year",
        parameters=[YEAR], responses=FinanceSummarySerializer,
    )
    def get(self, request):
        access = finance_access_for(request)
        year = year_param(request)
        visible = []
        if access.can_see_budgets():
            visible = money.with_figures(access.visible_budgets(Budget.objects.filter(fiscal_year=year)))
        return Response(FinanceSummarySerializer({
            "fiscal_year": year,
            "can_manage": access.can_manage(),
            "can_see_all": access.can_see_all(),
            "can_see_budgets": access.can_see_budgets(),
            "can_see_sponsors": access.can_see_sponsors(),
            "can_manage_sponsors": access.can_manage_sponsors(),
            "budgets": len(visible),
            "over_budget": sum(1 for budget in visible if budget.is_over),
            "to_impute": Expense.objects.filter(budget__isnull=True).count() if access.can_see_all() else None,
        }).data)


@extend_schema_view(
    list=extend_schema(summary="The budgets of a year the viewer sees, with their figures", parameters=[YEAR]),
    retrieve=extend_schema(
        summary="A budget with its expenses, its orders in progress and the budgets below it",
        responses=BudgetDetailSerializer,
    ),
    create=extend_schema(
        summary="A new budget for a unit and a year (treasurer, admins)",
        request=BudgetWriteSerializer, responses={201: BudgetDetailSerializer},
    ),
    partial_update=extend_schema(
        summary="Change the allocated amount or the notes of a budget (treasurer, admins)",
        request=BudgetChangeSerializer, responses=BudgetDetailSerializer,
    ),
)
class BudgetViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = BudgetSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        access = finance_access_for(self.request)
        budgets = Budget.objects.select_related("org_unit")
        if not access.can_see_budgets():
            return budgets.none()
        budgets = access.visible_budgets(budgets)
        if self.action == "list":
            budgets = budgets.filter(fiscal_year=year_param(self.request))
        return budgets.order_by("org_unit__name", "id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        listed = BudgetSerializer(money.with_figures(page), many=True, context=self.get_serializer_context())
        return self.get_paginated_response(listed.data)

    def detail_response(self, budget, status=200):
        """The budget, with the budgets of every unit below it that year: seeing a unit's budget means
        seeing those below it (access.py)."""
        below = [pk for pk in budget.org_unit.descendant_ids() if pk != budget.org_unit_id]
        family = money.with_figures(
            Budget.objects.select_related("org_unit")
            .filter(Q(pk=budget.pk) | Q(org_unit_id__in=below, fiscal_year=budget.fiscal_year))
            .order_by("org_unit__name", "id")
        )
        budget = next(member for member in family if member.pk == budget.pk)
        budget.children = [member for member in family if member.pk != budget.pk]
        budget.with_children = {
            field: sum((getattr(member, field) for member in family), money.ZERO)
            for field in ("allocated_amount", "spent", "committed", "remaining")
        }
        budget.expense_list = budget.expenses.select_related(*EXPENSE_RELATIONS).order_by("-recorded_at", "-id")
        return Response(BudgetDetailSerializer(budget, context=self.get_serializer_context()).data, status=status)

    def retrieve(self, request, *args, **kwargs):
        return self.detail_response(self.get_object())

    def create(self, request, *args, **kwargs):
        require_manager(request)
        serializer = BudgetWriteSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        return self.detail_response(serializer.save(), status=201)

    def partial_update(self, request, *args, **kwargs):
        require_manager(request)
        budget = self.get_object()
        serializer = BudgetChangeSerializer(budget, data=request.data, partial=True, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        return self.detail_response(serializer.save())


@extend_schema_view(
    list=extend_schema(
        summary="The expenses the viewer sees, the latest first",
        parameters=[
            YEAR,
            OpenApiParameter("unit", int, description="Only the expenses imputed to this unit's budget."),
            OpenApiParameter("category", enum=ExpenseCategory.values, description="Only this kind of expense."),
            OpenApiParameter("source", enum=["purchase", "manual"], description="Of an order, or entered by hand."),
            OpenApiParameter("to_impute", bool, description="Only those waiting for a budget."),
            OpenApiParameter("purchase_request", int, description="The expense of this purchase request's order."),
        ],
    ),
    retrieve=extend_schema(summary="An expense"),
    create=extend_schema(
        summary="An expense entered by hand, with its reason (treasurer, admins)",
        request=ExpenseWriteSerializer, responses={201: ExpenseSerializer},
    ),
    partial_update=extend_schema(
        summary="Change an expense entered by hand, or impute the expense of an order to a budget (treasurer, admins)",
        request=ExpenseWriteSerializer, responses=ExpenseSerializer,
    ),
    destroy=extend_schema(summary="Remove an expense entered by hand (treasurer, admins)"),
)
class ExpenseViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    serializer_class = ExpenseSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        access = finance_access_for(self.request)
        expenses = Expense.objects.select_related(*EXPENSE_RELATIONS)
        if not access.can_see_budgets():
            return expenses.none()
        if not access.can_see_all():
            expenses = access.visible_budgets(expenses, prefix="budget__")  # never those waiting for a budget
        if self.action != "list":
            return expenses
        params = self.request.query_params
        if year := year_param(self.request, default=False):
            start, end = fiscal_year_bounds(year)
            expenses = expenses.filter(Q(budget__fiscal_year=year) | Q(budget__isnull=True, recorded_at__range=(start, end)))
        if (unit := integer(params, "unit")) is not None:
            expenses = expenses.filter(budget__org_unit_id=unit)
        if params.get("category"):
            expenses = expenses.filter(category=params["category"])
        if params.get("source") in ("purchase", "manual"):
            expenses = expenses.filter(purchase_order__isnull=params["source"] == "manual")
        if params.get("to_impute") in ("1", "true"):
            expenses = expenses.filter(budget__isnull=True)
        if (purchase := integer(params, "purchase_request")) is not None:
            expenses = expenses.filter(purchase_order__purchase_request_id=purchase)
        return expenses.order_by("-recorded_at", "-id")

    def answer(self, expense, status=200):
        fresh = Expense.objects.select_related(*EXPENSE_RELATIONS).get(pk=expense.pk)
        return Response(ExpenseSerializer(fresh, context=self.get_serializer_context()).data, status=status)

    def saved(self, serializer, budget, **extra):
        """Saves the expense; its budget's people are told if this takes it above its allocation."""
        with transaction.atomic():
            if budget is not None:
                budget = Budget.objects.select_for_update().select_related("org_unit").get(pk=budget.pk)
            before = money.spent_on(budget) if budget is not None else money.ZERO
            expense = serializer.save(**extra)
            if budget is not None:
                money.tell_if_exceeded(budget, before, self.request.user)
        return expense

    def create(self, request, *args, **kwargs):
        require_manager(request)
        serializer = ExpenseWriteSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        expense = self.saved(serializer, serializer.validated_data["budget"], recorded_by=request.user)
        return self.answer(expense, status=201)

    def partial_update(self, request, *args, **kwargs):
        require_manager(request)
        expense = self.get_object()
        if expense.purchase_order_id is not None:
            if set(request.data) - {"budget"}:
                raise ValidationError({"detail": _("The expense of an order follows its order: only its budget can change.")})
            serializer = ExpenseImputeSerializer(expense, data=request.data, partial=True)
        else:
            serializer = ExpenseWriteSerializer(expense, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        expense = self.saved(serializer, serializer.validated_data.get("budget", expense.budget))
        return self.answer(expense)

    def destroy(self, request, *args, **kwargs):
        require_manager(request)
        if self.get_object().purchase_order_id is not None:
            raise ValidationError({"detail": _("The expense of an order follows its order: it cannot be removed.")})
        return super().destroy(request, *args, **kwargs)

    @extend_schema(
        summary="Note the supplier's invoice of the expense of a delivered order (treasurer, admins)",
        request=InvoiceWriteSerializer, responses=ExpenseSerializer,
    )
    @action(detail=True, methods=["post"])
    def invoice(self, request, pk=None):
        require_manager(request)
        found = self.get_object()
        serializer = InvoiceWriteSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            # Locked: two quick submits would otherwise each create an invoice (one left orphaned) or fail on the
            # unique reference with a 500.
            expense = Expense.objects.select_for_update(of=("self",)).select_related("purchase_order").get(
                pk=found.pk
            )
            if expense.purchase_order_id is None:
                raise ValidationError({"detail": _("Only the expense of an order has a supplier's invoice.")})
            if expense.invoice_id is not None:
                raise ValidationError({"detail": _("The invoice of this order is already noted.")})
            supplier = expense.purchase_order.supplier
            if Invoice.objects.filter(supplier=supplier, reference=serializer.validated_data["reference"]).exists():
                raise ValidationError({"reference": [_("This supplier already has an invoice with this reference.")]})
            expense.invoice = serializer.save(supplier=supplier)
            expense.save(update_fields=["invoice"])
        return self.answer(expense)


@extend_schema_view(
    list=extend_schema(
        summary="The sponsors (Operations, bureau, treasurer, admins); their contacts for Operations and admins",
        parameters=[OpenApiParameter("status", enum=SponsorshipStatus.values, description="Only this stage.")],
    ),
    retrieve=extend_schema(summary="A sponsor"),
    create=extend_schema(
        summary="A new sponsor to follow (Operations, admins)",
        request=SponsorshipWriteSerializer, responses={201: SponsorshipSerializer},
    ),
    partial_update=extend_schema(
        summary="Change a sponsor: its stage, amount, notes... (Operations, admins)",
        request=SponsorshipWriteSerializer, responses=SponsorshipSerializer,
    ),
    destroy=extend_schema(summary="Remove a sponsor (Operations, admins)"),
)
class SponsorshipViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    serializer_class = SponsorshipSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        require(
            finance_access_for(request).can_see_sponsors(),
            _("The sponsors are followed by Operations; the bureau and the treasurer see them."),
        )

    def get_queryset(self):
        sponsors = Sponsorship.objects.select_related("managed_by")
        if status := self.request.query_params.get("status"):
            sponsors = sponsors.filter(status=status)
        return sponsors.order_by("status", "sponsor_name", "id")

    def require_manager(self):
        require(
            finance_access_for(self.request).can_manage_sponsors(),
            _("Only Operations and the admins follow the sponsors."),
        )

    def answer(self, sponsorship, status=200):
        return Response(SponsorshipSerializer(sponsorship, context=self.get_serializer_context()).data, status=status)

    @staticmethod
    def dated(serializer, sponsorship=None):
        """The day of the agreement: today when it becomes confirmed without one, none when it is not."""
        data = serializer.validated_data
        status = data.get("status", sponsorship.status if sponsorship else SponsorshipStatus.PROSPECT)
        confirmed_at = data.get("confirmed_at", sponsorship.confirmed_at if sponsorship else None)
        if status != SponsorshipStatus.CONFIRMED:
            return {"confirmed_at": None}
        return {"confirmed_at": confirmed_at or timezone.localdate()}

    def create(self, request, *args, **kwargs):
        self.require_manager()
        serializer = SponsorshipWriteSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        extra = self.dated(serializer)
        if "managed_by" not in serializer.validated_data:
            extra["managed_by"] = request.user
        return self.answer(serializer.save(**extra), status=201)

    def partial_update(self, request, *args, **kwargs):
        self.require_manager()
        sponsorship = self.get_object()
        serializer = SponsorshipWriteSerializer(
            sponsorship, data=request.data, partial=True, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        return self.answer(serializer.save(**self.dated(serializer, sponsorship)))

    def destroy(self, request, *args, **kwargs):
        self.require_manager()
        return super().destroy(request, *args, **kwargs)

    @extend_schema(
        summary="How many sponsors at each stage, and the total confirmed in a budget year",
        parameters=[YEAR], responses=SponsorshipSummarySerializer,
    )
    @action(detail=False, methods=["get"])
    def summary(self, request):
        year = year_param(request)
        start, end = fiscal_year_bounds(year)
        counts = dict(Sponsorship.objects.values_list("status").annotate(number=Count("id")))
        confirmed = Sponsorship.objects.filter(status=SponsorshipStatus.CONFIRMED, confirmed_at__range=(start, end))
        return Response(SponsorshipSummarySerializer({
            "fiscal_year": year,
            "by_status": {status: counts.get(status, 0) for status in SponsorshipStatus.values},
            "confirmed_total": confirmed.aggregate(total=Sum("amount"))["total"] or money.ZERO,
            "can_manage": finance_access_for(request).can_manage_sponsors(),
        }).data)
