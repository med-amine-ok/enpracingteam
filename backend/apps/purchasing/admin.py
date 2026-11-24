# apps/purchasing/admin.py
from django.contrib import admin
from .models import (
    Invoice, InvoiceLineItem, Part, PurchaseOrder, PurchaseRequest, PurchaseRequestEvent, ShippingAddress, Supplier,
)

class InvoiceLineItemInline(admin.TabularInline):
    model = InvoiceLineItem
    extra = 1

class PurchaseRequestEventInline(admin.TabularInline):
    """The request's history: written by the ERP at each step, read-only here."""
    model = PurchaseRequestEvent
    fields = ("created_at", "action", "status", "actor", "comment")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ("name", "type", "status", "city", "country")
    list_filter = ("type", "status")
    search_fields = ("name",)

@admin.register(Part)
class PartAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "reference", "quantity", "subsystem", "org_unit")
    list_filter = ("category",)
    search_fields = ("name", "reference")

@admin.register(PurchaseRequest)
class PurchaseRequestAdmin(admin.ModelAdmin):
    list_display = ("part", "quantity", "status", "priority", "requested_by", "org_unit", "requested_date")
    list_filter = ("status", "priority")
    inlines = [PurchaseRequestEventInline]

@admin.register(ShippingAddress)
class ShippingAddressAdmin(admin.ModelAdmin):
    list_display = ("address", "country", "contacted_by")

@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ("id", "supplier", "status", "total_price", "currency", "total_price_dzd", "ordered_at")
    list_filter = ("status", "currency", "supplier")
    readonly_fields = ("total_price", "total_price_dzd")

@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ("reference", "supplier", "total_amount", "issued_at")
    inlines = [InvoiceLineItemInline]
