# apps/purchasing/admin.py
from django.contrib import admin
from .models import Invoice, InvoiceLineItem, Part, PurchaseOrder, PurchaseRequest, ShippingAddress, Supplier

class InvoiceLineItemInline(admin.TabularInline):
    model = InvoiceLineItem
    extra = 1

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
    list_display = ("part", "quantity", "status", "priority", "requested_by")
    list_filter = ("status", "priority")

@admin.register(ShippingAddress)
class ShippingAddressAdmin(admin.ModelAdmin):
    list_display = ("address", "country", "contacted_by")

@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ("id", "supplier", "status", "total_price", "ordered_at")
    list_filter = ("status", "supplier")

@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ("reference", "supplier", "total_amount", "issued_at")
    inlines = [InvoiceLineItemInline]