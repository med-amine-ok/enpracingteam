"""
The life of a purchase request (knowledge base: PROJECTS/ERP/purchasing_design.md, 19/10/2026):

    To approve (leader) → To approve (Operations) → To order → Ordered → Delivered
    Cancelled at any step before delivery; a cancelled order sends the request back to "To order".

Since 23/10/2026 (decision D-023): several requests may be ordered together from one supplier
(order_batch), and the parts of an order may arrive in several deliveries (receive with a quantity);
an order whose rest will not come is closed with what arrived (close_short).

Each function changes the request, writes its history line and tells the people concerned
(apps/communication/notify.py). The views call them inside a transaction, on a locked request,
after checking the step and the rights (access.py).
"""

from datetime import datetime, time
from decimal import ROUND_DOWN, Decimal

from django.utils import timezone

from apps.communication import notify
from apps.finance import budgets
from apps.inventory import movements
from apps.inventory.models import StockMovementType

from .models import (
    CENTIME, OrderBatch, PurchaseAction as Action, PurchaseOrder, PurchaseRequestEvent, PurchaseStatus as Status,
)

AFTER_APPROVAL = {Status.A_VALIDER_CHEF: Status.A_VALIDER_OPERATIONS, Status.A_VALIDER_OPERATIONS: Status.A_COMMANDER}


def _move(purchase, status, action, actor, comment="", quantity=None):
    purchase.status = status
    purchase.save(update_fields=["status", "updated_at"])
    PurchaseRequestEvent.objects.create(
        purchase_request=purchase, action=action, status=status, actor=actor, comment=comment, quantity=quantity
    )


def _approve_while_allowed(purchase, access, comment=""):
    """Approves the step the request awaits, then the next ones this person may approve too."""
    while purchase.status in AFTER_APPROVAL and access.can_approve(purchase):
        _move(purchase, AFTER_APPROVAL[purchase.status], Action.APPROVED, access.viewer, comment)
        comment = ""


def submit(purchase, access):
    """A request just created (status "to approve (leader)")."""
    PurchaseRequestEvent.objects.create(
        purchase_request=purchase, action=Action.REQUESTED, status=purchase.status, actor=access.viewer
    )
    _approve_while_allowed(purchase, access)
    notify.purchase_moved(purchase, Action.REQUESTED, access.viewer)


def approve(purchase, access, comment=""):
    _approve_while_allowed(purchase, access, comment)
    notify.purchase_moved(purchase, Action.APPROVED, access.viewer)


def refuse(purchase, access, reason):
    _move(purchase, Status.ANNULE, Action.REFUSED, access.viewer, reason)
    notify.purchase_moved(purchase, Action.REFUSED, access.viewer, reason=reason)


def cancel(purchase, access, reason):
    was_ordered = purchase.status == Status.EN_COMMANDE
    awaited_operations = purchase.status in (Status.A_COMMANDER, Status.EN_COMMANDE)
    if was_ordered:
        purchase.orders.filter(status=Status.EN_COMMANDE).update(status=Status.ANNULE, updated_at=timezone.now())
    _move(purchase, Status.ANNULE, Action.CANCELLED, access.viewer, reason)
    notify.purchase_moved(purchase, Action.CANCELLED, access.viewer, reason=reason, tell_operations=awaited_operations)


def order(purchase, access, order_serializer):
    """Places the order (the serializer holds the supplier, prices and dates, already checked)."""
    placed = order_serializer.save(purchase_request=purchase, status=Status.EN_COMMANDE)
    _move(purchase, Status.EN_COMMANDE, Action.ORDERED, access.viewer)
    notify.purchase_moved(purchase, Action.ORDERED, access.viewer, supplier=placed.supplier.name)
    return placed


def cancel_order(purchase, access, reason):
    """The supplier cannot deliver: the order is cancelled and the request is to be ordered again."""
    purchase.orders.filter(status=Status.EN_COMMANDE).update(status=Status.ANNULE, updated_at=timezone.now())
    _move(purchase, Status.A_COMMANDER, Action.ORDER_CANCELLED, access.viewer, reason)
    notify.purchase_moved(purchase, Action.ORDER_CANCELLED, access.viewer, reason=reason)


def delivery_moment(day):
    """When the parts arrived, for the stock movement: now if they arrived today, else at noon that day."""
    now = timezone.localtime()
    if day == now.date():
        return now
    return timezone.make_aware(datetime.combine(day, time(12, 0)))


def still_to_come(purchase, placed):
    """How many parts of the order have not arrived yet."""
    return purchase.quantity - placed.quantity_received


def receive(purchase, access, delivered_on, location="", quantity=None):
    """Parts arrived (all those still to come when `quantity` is None): they enter the stock in the same
    transaction — in the line of the place given (created if needed), else in the part's first line.
    Once every part is here, the order is delivered and its total becomes an expense of the budgets
    (apps/finance/budgets.py); before, it stays in progress and the requester is told what arrived."""
    placed = purchase.orders.select_for_update().get(status=Status.EN_COMMANDE)
    arrived = still_to_come(purchase, placed) if quantity is None else quantity
    placed.quantity_received += arrived
    placed.actual_delivery_date = delivered_on
    movements.record(
        movements.line_for(purchase.part, location), StockMovementType.IN, arrived, by=access.viewer,
        moved_at=delivery_moment(delivered_on), purchase_order=placed,
    )
    if still_to_come(purchase, placed) > 0:
        placed.save()
        PurchaseRequestEvent.objects.create(
            purchase_request=purchase, action=Action.PARTLY_RECEIVED, status=purchase.status, actor=access.viewer,
            quantity=arrived,
        )
        purchase.save(update_fields=["updated_at"])
        notify.purchase_moved(purchase, Action.PARTLY_RECEIVED, access.viewer, received=placed.quantity_received)
        return placed
    _deliver(purchase, placed, access, Action.RECEIVED, quantity=arrived)
    return placed


def close_short(purchase, access, reason):
    """The rest of the parts will not come: the order is delivered with those that arrived, and only
    they are paid (PurchaseOrder.billed_quantity)."""
    placed = purchase.orders.select_for_update().get(status=Status.EN_COMMANDE)
    _deliver(purchase, placed, access, Action.CLOSED_SHORT, quantity=placed.quantity_received, reason=reason)
    return placed


def _deliver(purchase, placed, access, action, *, quantity, reason=""):
    placed.status = Status.LIVRE
    placed.save()
    budgets.record_delivery(placed, by=access.viewer)
    _move(purchase, Status.LIVRE, action, access.viewer, reason, quantity=quantity)
    notify.purchase_moved(purchase, action, access.viewer, reason=reason, received=placed.quantity_received)


def shares(amount, weights):
    """`amount` shared out in proportion to `weights` (evenly when they are all zero), to the centime:
    each share is rounded down and the last one takes the rest, so that they add up to `amount`."""
    total = sum(weights)
    if total == 0:
        weights, total = [1] * len(weights), len(weights)
    parts = [(amount * weight / total).quantize(CENTIME, rounding=ROUND_DOWN) for weight in weights[:-1]]
    return [*parts, amount - sum(parts, Decimal(0))]


def order_batch(lines, access, shared):
    """Orders several requests "to order" together from one supplier (one order on its side). `lines`
    are (request, unit price) pairs, the requests locked; `shared` holds the supplier, the currency and
    its rate, the dates, the shipping address and the delivery and customs costs paid once, which are
    shared out between the lines in proportion to their price (evenly while no price is known)."""
    batch = OrderBatch.objects.create(supplier=shared["supplier"], created_by=access.viewer)
    values = [unit_price * purchase.quantity for purchase, unit_price in lines]
    delivery = shares(shared.get("delivery_cost", Decimal(0)), values)
    customs = shares(shared.get("customs_cost", Decimal(0)), values)
    common = {key: value for key, value in shared.items() if key not in ("delivery_cost", "customs_cost")}
    for (purchase, unit_price), delivery_share, customs_share in zip(lines, delivery, customs, strict=True):
        PurchaseOrder.objects.create(
            **common, purchase_request=purchase, batch=batch, status=Status.EN_COMMANDE, unit_price=unit_price,
            delivery_cost=delivery_share, customs_cost=customs_share,
        )
        _move(purchase, Status.EN_COMMANDE, Action.ORDERED, access.viewer)
        notify.purchase_moved(purchase, Action.ORDERED, access.viewer, supplier=batch.supplier.name)
    return batch
