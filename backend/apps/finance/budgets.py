"""
The money of the budgets (knowledge base: PROJECTS/ERP/finance_design.md §10, decision D-011).

- spent: the expenses imputed to a budget;
- committed: the orders in progress (ordered, not delivered yet) that will be imputed to it, by the
  same rule as their expense, for the budget year of their order date;
- remaining = allocated - spent - committed.

An order becomes an expense when it is delivered (record_delivery, called by
apps/purchasing/workflow.py): its total in dinars, imputed to the budget of the request's unit (else
of its subsystem's unit) for the budget year of the delivery, else of the nearest unit above with a
budget that year; with none, it waits "to impute" (no budget). An order without a price makes no
expense. When the expenses of a budget go above its allocation, the people concerned are told once
(tell_if_exceeded).
"""

from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.communication import notify
from apps.members.models import OrgUnit
from apps.purchasing.models import PurchaseOrder, PurchaseStatus

from .models import Budget, Expense, ExpenseCategory
from .years import fiscal_year_of

ZERO = Decimal("0.00")


def unit_id_of(purchase):
    """The unit a purchase request is for: its own, else its subsystem's (None if neither)."""
    if purchase.org_unit_id is not None:
        return purchase.org_unit_id
    return purchase.subsystem.org_unit_id if purchase.subsystem_id is not None else None


class Imputation:
    """Finds the budget a unit's money goes to in a budget year, with the units' tree and the
    budgets loaded once."""

    def __init__(self):
        self.parents = dict(OrgUnit.objects.values_list("pk", "parent_id"))
        self.budgets = {
            (unit_id, year): budget_id
            for budget_id, unit_id, year in Budget.objects.values_list("pk", "org_unit_id", "fiscal_year")
        }

    def budget_id(self, unit_id, fiscal_year):
        """The budget of the unit that year, else of the nearest unit above it with one; None if none."""
        seen = set()
        while unit_id is not None and unit_id not in seen:
            seen.add(unit_id)
            if (unit_id, fiscal_year) in self.budgets:
                return self.budgets[(unit_id, fiscal_year)]
            unit_id = self.parents.get(unit_id)
        return None


def orders_in_progress():
    return PurchaseOrder.objects.filter(status=PurchaseStatus.EN_COMMANDE, total_price_dzd__isnull=False).select_related(
        "purchase_request__part", "purchase_request__subsystem", "supplier"
    )


def committed_orders(imputation=None):
    """The orders in progress with a price, by the id of the budget they will be imputed to."""
    imputation = imputation or Imputation()
    by_budget = defaultdict(list)
    for order in orders_in_progress():
        day = order.ordered_at or timezone.localdate()
        budget_id = imputation.budget_id(unit_id_of(order.purchase_request), fiscal_year_of(day))
        if budget_id is not None:
            by_budget[budget_id].append(order)
    return by_budget


def spent_by_budget(budget_ids):
    return dict(
        Expense.objects.filter(budget_id__in=budget_ids).values_list("budget_id").annotate(total=Sum("amount"))
    )


def with_figures(budgets):
    """The budgets, each with its spent, committed and remaining amounts as attributes."""
    budgets = list(budgets)
    spent = spent_by_budget([budget.pk for budget in budgets])
    committed = committed_orders()
    for budget in budgets:
        budget.committed_orders = committed.get(budget.pk, [])
        set_figures(budget, spent.get(budget.pk) or ZERO, sum((o.total_price_dzd for o in budget.committed_orders), ZERO))
    return budgets


def set_figures(budget, spent, committed):
    allocated = budget.allocated_amount
    budget.spent = spent
    budget.committed = committed
    budget.remaining = allocated - spent - committed
    budget.spent_percent = float(round(spent * 100 / allocated, 1)) if allocated else None
    budget.is_over = spent > allocated
    budget.will_exceed = spent + committed > allocated


def spent_on(budget):
    return budget.expenses.aggregate(total=Sum("amount"))["total"] or ZERO


def tell_if_exceeded(budget, spent_before, actor):
    """After a change of the expenses of `budget`: if they just went above its allocation, the people
    concerned are told (once: the next expenses find it already above)."""
    spent = spent_on(budget)
    if spent_before <= budget.allocated_amount < spent:
        notify.budget_exceeded(budget, spent, actor)


def record_delivery(order, by):
    """The order was just delivered: its total in dinars becomes an expense of the delivery day."""
    if order.total_price_dzd is None:
        return None
    day = order.actual_delivery_date or timezone.localdate()
    budget_id = Imputation().budget_id(unit_id_of(order.purchase_request), fiscal_year_of(day))
    budget = Budget.objects.select_related("org_unit").get(pk=budget_id) if budget_id is not None else None
    before = spent_on(budget) if budget is not None else ZERO
    expense = Expense.objects.create(
        budget=budget, purchase_order=order, amount=order.total_price_dzd, category=ExpenseCategory.PURCHASE,
        recorded_by=by, recorded_at=day,
    )
    if budget is not None:
        tell_if_exceeded(budget, before, by)
    return expense
