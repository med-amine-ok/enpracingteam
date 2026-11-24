from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy


class SponsorshipStatus(models.TextChoices):
    # Context: stage of the sponsor pipeline (French: le sponsor, masculine); "Confirmed" is
    # feminine for a reservation.
    PROSPECT = "prospect", pgettext_lazy("sponsorship status", "Prospect")
    CONTACTED = "contacted", pgettext_lazy("sponsorship status", "Contacted")
    NEGOTIATING = "negotiating", pgettext_lazy("sponsorship status", "Negotiating")
    CONFIRMED = "confirmed", pgettext_lazy("sponsorship status", "Confirmed")
    DECLINED = "declined", pgettext_lazy("sponsorship status", "Declined")


class ExpenseCategory(models.TextChoices):
    """What the money went to. "Purchase" is the expense of a delivered order (apps/finance/budgets.py);
    the others are entered by hand by the finance managers."""

    PURCHASE = "purchase", pgettext_lazy("expense category", "Purchase")
    REGISTRATION = "registration", pgettext_lazy("expense category", "Registration")
    TRANSPORT = "transport", pgettext_lazy("expense category", "Transport")
    ACCOMMODATION = "accommodation", pgettext_lazy("expense category", "Accommodation")
    COMMUNICATION = "communication", pgettext_lazy("expense category", "Communication")
    TOOLING = "tooling", pgettext_lazy("expense category", "Tooling")
    OTHER = "other", pgettext_lazy("expense category", "Other")


class Budget(models.Model):
    org_unit = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, related_name="budgets",
        verbose_name=_("organisational unit"),
    )
    fiscal_year = models.CharField(_("fiscal year"), max_length=20)
    allocated_amount = models.DecimalField(_("allocated amount"), max_digits=12, decimal_places=2, default=0)
    # Where the money comes from, what it is for. The demo's budgets start with "[DEMO]".
    notes = models.TextField(_("notes"), blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("budget")
        verbose_name_plural = _("budgets")
        constraints = [
            models.UniqueConstraint(fields=["org_unit", "fiscal_year"], name="uq_budget_org_unit_year"),
            models.CheckConstraint(condition=Q(allocated_amount__gte=0), name="ck_budget_allocated_amount"),
        ]

    def __str__(self):
        return f"{self.org_unit.name} - {self.fiscal_year}"


class Expense(models.Model):
    # Empty for the expense of an order whose unit has no budget that year: "to impute" by the
    # finance managers (apps/finance/budgets.py).
    budget = models.ForeignKey(
        Budget, null=True, blank=True, on_delete=models.PROTECT, related_name="expenses", verbose_name=_("budget")
    )
    purchase_order = models.ForeignKey(
        "purchasing.PurchaseOrder", null=True, blank=True,
        on_delete=models.PROTECT, related_name="expenses", verbose_name=_("purchase order"),
    )
    invoice = models.ForeignKey(
        "purchasing.Invoice", null=True, blank=True,
        on_delete=models.PROTECT, related_name="expenses", verbose_name=_("invoice"),
    )
    amount = models.DecimalField(_("amount"), max_digits=12, decimal_places=2)
    category = models.CharField(
        _("category"), max_length=150, choices=ExpenseCategory.choices, default=ExpenseCategory.OTHER
    )
    description = models.TextField(_("description"), blank=True)
    recorded_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="recorded_expenses", verbose_name=_("recorded by")
    )
    # Day the money was spent: today by default, editable for receipts entered later.
    recorded_at = models.DateField(_("expense date"), default=timezone.localdate)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("expense")
        verbose_name_plural = _("expenses")
        indexes = [models.Index(fields=["recorded_at"], name="idx_expense_recorded_at")]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_expense_amount"),
            # Only the expense of an order may wait for its budget.
            models.CheckConstraint(
                condition=Q(budget__isnull=False) | Q(purchase_order__isnull=False), name="ck_expense_budget_or_order"
            ),
            models.UniqueConstraint(
                fields=["purchase_order"], condition=Q(purchase_order__isnull=False), name="uq_expense_one_per_order"
            ),
        ]

    def __str__(self):
        return f"{self.amount} - {self.get_category_display() or gettext('expense')}"


class Sponsorship(models.Model):
    sponsor_name = models.CharField(_("sponsor name"), max_length=255)
    amount = models.DecimalField(_("amount"), max_digits=12, decimal_places=2, null=True, blank=True)
    in_kind_description = models.TextField(_("in-kind contribution"), blank=True)
    contact_name = models.CharField(_("contact name"), max_length=150, blank=True)
    contact_email = models.EmailField(_("contact email"), blank=True)
    status = models.CharField(
        _("status"), max_length=20, choices=SponsorshipStatus.choices, default=SponsorshipStatus.PROSPECT
    )
    managed_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="sponsorships", verbose_name=_("managed by"),
    )
    notes = models.TextField(_("notes"), blank=True)
    # Day of the agreement: it counts in the confirmed total of that budget year.
    confirmed_at = models.DateField(_("confirmation date"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("sponsorship")
        verbose_name_plural = _("sponsorships")
        indexes = [models.Index(fields=["status"], name="idx_sponsorship_status")]
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__isnull=True) | Q(amount__gte=0), name="ck_sponsorship_amount"
            ),
        ]

    def __str__(self):
        return self.sponsor_name
