# apps/inventory/admin.py
from django.contrib import admin
from .models import StockItem, StockMovement

@admin.register(StockItem)
class StockItemAdmin(admin.ModelAdmin):
    list_display = ("part", "quantity_available", "min_threshold", "location")
    # The quantity follows the movements, recorded by the ERP (apps/inventory/movements.py).
    readonly_fields = ("quantity_available",)

@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    """Read-only: a movement added or changed here would not change the quantity of its line."""
    list_display = ("stock_item", "movement_type", "quantity", "moved_by", "handed_to", "moved_at")
    list_filter = ("movement_type",)
    readonly_fields = ("created_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
