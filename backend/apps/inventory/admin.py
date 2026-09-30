# apps/inventory/admin.py
from django.contrib import admin
from .models import StockItem, StockMovement

@admin.register(StockItem)
class StockItemAdmin(admin.ModelAdmin):
    list_display = ("part", "quantity_available", "min_threshold", "location")

@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("stock_item", "movement_type", "quantity", "moved_by", "moved_at")
    list_filter = ("movement_type",)