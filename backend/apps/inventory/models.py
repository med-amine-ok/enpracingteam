from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


class StockMovementType(models.TextChoices):
    IN = "in", _("Stock in")
    OUT = "out", _("Stock out")
    ADJUSTMENT = "adjustment", _("Adjustment")


class StockItem(models.Model):
    part = models.ForeignKey(
        "purchasing.Part", on_delete=models.PROTECT, related_name="stock_items", verbose_name=_("part")
    )
    quantity_available = models.IntegerField(_("quantity available"), default=0)
    location = models.CharField(_("location"), max_length=255, blank=True)
    min_threshold = models.IntegerField(_("minimum threshold"), default=0)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("stock item")
        verbose_name_plural = _("stock items")
        indexes = [
            models.Index(
                fields=["part"],
                condition=models.Q(quantity_available__lte=models.F("min_threshold")),
                name="idx_stock_item_low_stock",
            ),
        ]
        constraints = [
            # One line per part and place (the same part may be stored in several places).
            models.UniqueConstraint(fields=["part", "location"], name="uq_stock_item_part_location"),
            models.CheckConstraint(
                condition=models.Q(quantity_available__gte=0), name="ck_stock_item_qty_available"
            ),
            models.CheckConstraint(
                condition=models.Q(min_threshold__gte=0), name="ck_stock_item_min_threshold"
            ),
        ]

    def __str__(self):
        return f"{self.part.name} ({self.quantity_available})"


class StockMovement(models.Model):
    stock_item = models.ForeignKey(
        StockItem, on_delete=models.PROTECT, related_name="movements", verbose_name=_("stock item")
    )
    movement_type = models.CharField(_("movement type"), max_length=20, choices=StockMovementType.choices)
    # 'in' / 'out': positive quantity. 'adjustment': signed, non-zero.
    quantity = models.IntegerField(_("quantity"))
    related_purchase_order = models.ForeignKey(
        "purchasing.PurchaseOrder", null=True, blank=True,
        on_delete=models.PROTECT, related_name="stock_movements", verbose_name=_("related purchase order"),
    )
    related_task = models.ForeignKey(
        "tasks.Task", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="stock_movements", verbose_name=_("related task"),
    )
    moved_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="stock_movements", verbose_name=_("moved by")
    )
    # Who received the parts of an exit (a stock manager records it for them, like a storekeeper).
    handed_to = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="stock_received", verbose_name=_("handed to"),
    )
    # When the parts moved: now by default, editable for movements entered afterwards.
    moved_at = models.DateTimeField(_("movement date"), default=timezone.now)
    notes = models.TextField(_("notes"), blank=True)
    # When the line was entered in the ERP (audit trail, never edited).
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("stock movement")
        verbose_name_plural = _("stock movements")
        indexes = [models.Index(fields=["moved_at"], name="idx_stock_movement_moved_at")]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(movement_type="adjustment") & ~models.Q(quantity=0)
                ) | (
                    ~models.Q(movement_type="adjustment") & models.Q(quantity__gt=0)
                ),
                name="ck_stock_movement_quantity",
            ),
        ]

    def __str__(self):
        return f"{self.get_movement_type_display()} {self.quantity} - {self.stock_item.part.name}"
