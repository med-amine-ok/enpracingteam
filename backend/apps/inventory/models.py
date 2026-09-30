from django.db import models


class StockMovementType(models.TextChoices):
    IN = "in", "In"
    OUT = "out", "Out"
    ADJUSTMENT = "adjustment", "Adjustment"


class StockItem(models.Model):
    part = models.ForeignKey(
        "purchasing.Part", on_delete=models.PROTECT, related_name="stock_items"
    )
    quantity_available = models.IntegerField(default=0)
    location = models.CharField(max_length=255, blank=True)
    min_threshold = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["part"],
                condition=models.Q(quantity_available__lte=models.F("min_threshold")),
                name="idx_stock_item_low_stock",
            ),
        ]
        constraints = [
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
    stock_item = models.ForeignKey(StockItem, on_delete=models.PROTECT, related_name="movements")
    movement_type = models.CharField(max_length=20, choices=StockMovementType.choices)
    # 'in' / 'out': positive quantity. 'adjustment': signed, non-zero.
    quantity = models.IntegerField()
    related_purchase_order = models.ForeignKey(
        "purchasing.PurchaseOrder", null=True, blank=True,
        on_delete=models.PROTECT, related_name="stock_movements",
    )
    related_task = models.ForeignKey(
        "tasks.Task", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="stock_movements",
    )
    moved_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="stock_movements"
    )
    moved_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    class Meta:
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
        return f"{self.movement_type} {self.quantity} - {self.stock_item.part.name}"