# apps/equipment/admin.py
from django.contrib import admin
from .models import Equipment, EquipmentMaintenance, EquipmentReservation

@admin.register(Equipment)
class EquipmentAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "status", "location")
    list_filter = ("status", "category")

@admin.register(EquipmentReservation)
class EquipmentReservationAdmin(admin.ModelAdmin):
    list_display = ("equipment", "reserved_by", "reserved_from", "reserved_to", "status")
    list_filter = ("status",)

@admin.register(EquipmentMaintenance)
class EquipmentMaintenanceAdmin(admin.ModelAdmin):
    list_display = ("equipment", "performed_by", "performed_at", "cost")