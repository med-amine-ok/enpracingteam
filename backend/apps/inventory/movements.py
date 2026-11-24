"""
Every change of a stock quantity goes through record() (knowledge base: PROJECTS/ERP/stock_design.md):
the movement and the new quantity are saved together, on the stock line locked until the end of
the transaction, so two exits at once cannot both take the last part and the quantity always equals
the sum of the movements. The purchasing module calls it when an order is received; the stock API
for the rest. When an exit or a count brings a line to its threshold or below, the stock managers
are told (once, when it crosses).
"""

from django.utils import timezone

from apps.communication import notify

from .models import StockItem, StockMovement, StockMovementType as Type


class NotEnoughStock(Exception):
    """An exit larger than what is in stock."""

    def __init__(self, available):
        super().__init__(available)
        self.available = available


def change_of(movement_type, quantity):
    """How much a movement adds to the stock: an exit takes away, an adjustment is signed already."""
    return -quantity if movement_type == Type.OUT else quantity


def is_low(quantity, threshold):
    """Low when at the threshold or below (team's schema guide: 5 in stock, threshold 6 → low)."""
    return quantity <= threshold


def record(item, movement_type, quantity, *, by, moved_at=None, notes="", task=None, purchase_order=None,
           handed_to=None):
    """Saves a movement and the new quantity of `item` (inside a transaction). Returns the movement."""
    line = StockItem.objects.select_for_update(of=("self",)).select_related("part").get(pk=item.pk)
    before = line.quantity_available
    after = before + change_of(movement_type, quantity)
    if after < 0:
        raise NotEnoughStock(before)
    line.quantity_available = after
    line.save(update_fields=["quantity_available", "updated_at"])
    movement = StockMovement.objects.create(
        stock_item=line, movement_type=movement_type, quantity=quantity, moved_by=by,
        moved_at=moved_at or timezone.now(), notes=notes, related_task=task,
        related_purchase_order=purchase_order, handed_to=handed_to,
    )
    if not is_low(before, line.min_threshold) and is_low(after, line.min_threshold):
        notify.stock_low(line, by)
    return movement


def line_for(part, location=""):
    """The stock line where `part` goes: the one of `location` (created if needed), else its first
    line (created, without a place, if the part has none)."""
    location = " ".join(location.split())
    if location:
        return StockItem.objects.get_or_create(part=part, location=location)[0]
    line = StockItem.objects.filter(part=part).order_by("pk").first()
    return line or StockItem.objects.create(part=part)
