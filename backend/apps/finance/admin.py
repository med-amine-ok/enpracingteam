# apps/finance/admin.py
from django.contrib import admin
from .models import Budget, Expense, Sponsorship

@admin.register(Budget)
class BudgetAdmin(admin.ModelAdmin):
    list_display = ("org_unit", "fiscal_year", "allocated_amount")

@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ("budget", "amount", "category", "recorded_by", "recorded_at")
    list_filter = ("category",)

@admin.register(Sponsorship)
class SponsorshipAdmin(admin.ModelAdmin):
    list_display = ("sponsor_name", "amount", "status", "managed_by")
    list_filter = ("status",)