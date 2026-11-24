from django.contrib import admin

from .models import Equipment, EquipmentCertification, EquipmentLoan, EquipmentMaintenance, EquipmentReservation


@admin.register(Equipment)
class EquipmentAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "status", "location", "requires_certification", "loanable")
    list_filter = ("status", "category", "requires_certification", "loanable")
    search_fields = ("name", "location")


@admin.register(EquipmentCertification)
class EquipmentCertificationAdmin(admin.ModelAdmin):
    list_display = ("equipment", "member", "granted_by", "granted_at", "revoked_at")
    list_filter = ("equipment",)
    autocomplete_fields = ("equipment",)


@admin.register(EquipmentReservation)
class EquipmentReservationAdmin(admin.ModelAdmin):
    list_display = ("equipment", "reserved_by", "reserved_from", "reserved_to", "status")
    list_filter = ("status",)


@admin.register(EquipmentLoan)
class EquipmentLoanAdmin(admin.ModelAdmin):
    list_display = ("equipment", "borrower", "status", "due_date", "requested_at")
    list_filter = ("status",)


@admin.register(EquipmentMaintenance)
class EquipmentMaintenanceAdmin(admin.ModelAdmin):
    list_display = ("equipment", "performed_by", "performed_at", "cost")
    readonly_fields = ("created_at",)
