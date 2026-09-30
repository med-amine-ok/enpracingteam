from django.db import models
from django.db.models import Q


class SponsorshipStatus(models.TextChoices):
    PROSPECT = "prospect", "Prospect"
    CONTACTED = "contacted", "Contacted"
    NEGOTIATING = "negotiating", "Negotiating"
    CONFIRMED = "confirmed", "Confirmed"
    DECLINED = "declined", "Declined"


class Budget(models.Model):
    org_unit = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, related_name="budgets"
    )
    fiscal_year = models.CharField(max_length=20)
    allocated_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["org_unit", "fiscal_year"], name="uq_budget_org_unit_year"),
            models.CheckConstraint(condition=Q(allocated_amount__gte=0), name="ck_budget_allocated_amount"),
        ]

    def __str__(self):
        return f"{self.org_unit.name} - {self.fiscal_year}"


class Expense(models.Model):
    budget = models.ForeignKey(Budget, on_delete=models.PROTECT, related_name="expenses")
    purchase_order = models.ForeignKey(
        "purchasing.PurchaseOrder", null=True, blank=True,
        on_delete=models.PROTECT, related_name="expenses",
    )
    invoice = models.ForeignKey(
        "purchasing.Invoice", null=True, blank=True,
        on_delete=models.PROTECT, related_name="expenses",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.CharField(max_length=150, blank=True)
    recorded_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="recorded_expenses"
    )
    recorded_at = models.DateField(auto_now_add=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["recorded_at"], name="idx_expense_recorded_at")]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_expense_amount"),
        ]

    def __str__(self):
        return f"{self.amount} - {self.category or 'expense'}"


class Sponsorship(models.Model):
    sponsor_name = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    in_kind_description = models.TextField(blank=True)
    contact_name = models.CharField(max_length=150, blank=True)
    contact_email = models.EmailField(blank=True)
    status = models.CharField(max_length=20, choices=SponsorshipStatus.choices, default=SponsorshipStatus.PROSPECT)
    managed_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="sponsorships",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["status"], name="idx_sponsorship_status")]
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__isnull=True) | Q(amount__gte=0), name="ck_sponsorship_amount"
            ),
        ]

    def __str__(self):
        return self.sponsor_name