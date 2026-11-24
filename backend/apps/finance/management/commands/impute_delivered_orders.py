"""
The orders delivered before the Finance module (the purchases imported from the sheet, those received
before 20/10/2026) become expenses, as if they had been received in the ERP now: their total in dinars,
on the day of their delivery, imputed to their unit's budget that year, else to the nearest unit above
with one, else "to impute" (apps/finance/budgets.py). Run it once the budgets of the years concerned
exist; running it again creates nothing twice. It prints numbers only.

    python manage.py impute_delivered_orders --dry-run   what it would do
    python manage.py impute_delivered_orders             do it
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.purchasing.models import PurchaseAction, PurchaseOrder, PurchaseRequestEvent, PurchaseStatus

from ...budgets import Imputation, unit_id_of
from ...models import Expense, ExpenseCategory
from ...years import fiscal_year_of


class Command(BaseCommand):
    help = "Turn the orders delivered before the Finance module into expenses of the budgets."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Say what would be done, change nothing.")

    def handle(self, *args, dry_run=False, **options):
        delivered = (
            PurchaseOrder.objects.filter(status=PurchaseStatus.LIVRE, expenses__isnull=True)
            .select_related("purchase_request__subsystem", "purchase_request__requested_by")
            .order_by("id")
        )
        imputation = Imputation()
        to_create, without_price = [], 0
        for order in delivered:
            if order.total_price_dzd is None:
                without_price += 1
                continue
            day = order.actual_delivery_date or order.ordered_at or order.updated_at.date()
            to_create.append(Expense(
                budget_id=imputation.budget_id(unit_id_of(order.purchase_request), fiscal_year_of(day)),
                purchase_order=order, amount=order.total_price_dzd, category=ExpenseCategory.PURCHASE,
                recorded_by=self.receiver(order), recorded_at=day,
            ))
        imputed = sum(1 for expense in to_create if expense.budget_id is not None)
        self.stdout.write(
            f"{len(to_create)} expense(s) to create: {imputed} imputed to a budget, {len(to_create) - imputed} to impute."
        )
        if without_price:
            self.stdout.write(
                f"{without_price} delivered order(s) without a price: no expense (give the order its price, then run this again)."
            )
        if dry_run:
            self.stdout.write("Dry run: nothing was saved.")
            return
        with transaction.atomic():
            Expense.objects.bulk_create(to_create)
        self.stdout.write(self.style.SUCCESS("Done."))

    @staticmethod
    def receiver(order):
        """Who received the parts in the ERP, else who asked for them (the imported requests are in the
        name of the head of Operations)."""
        received = (
            PurchaseRequestEvent.objects.filter(purchase_request_id=order.purchase_request_id, action=PurchaseAction.RECEIVED)
            .select_related("actor").order_by("-created_at").first()
        )
        return received.actor if received is not None and received.actor is not None else order.purchase_request.requested_by
