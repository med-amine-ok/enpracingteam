from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators
from django.db import models
from django.db.models import Func


class EquipmentStatus(models.TextChoices):
    AVAILABLE = "available", "Available"
    BORROWED = "borrowed", "Borrowed"
    MAINTENANCE = "maintenance", "Maintenance"
    RESERVED = "reserved", "Reserved"
    OUT_OF_SERVICE = "out_of_service", "Out of service"


class ReservationStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    CONFIRMED = "confirmed", "Confirmed"
    CANCELLED = "cancelled", "Cancelled"
    COMPLETED = "completed", "Completed"


class Equipment(models.Model):
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=150, blank=True)
    status = models.CharField(max_length=20, choices=EquipmentStatus.choices, default=EquipmentStatus.AVAILABLE)
    location = models.CharField(max_length=255, blank=True)
    purchased_at = models.DateField(null=True, blank=True)
    last_maintenance_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["status"], name="idx_equipment_status"),
            models.Index(fields=["category"], name="idx_equipment_category"),
        ]

    def __str__(self):
        return self.name


class EquipmentReservation(models.Model):
    equipment = models.ForeignKey(Equipment, on_delete=models.CASCADE, related_name="reservations")
    reserved_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="equipment_reservations"
    )
    reserved_from = models.DateTimeField()
    reserved_to = models.DateTimeField()
    status = models.CharField(max_length=20, choices=ReservationStatus.choices, default=ReservationStatus.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(reserved_to__gt=models.F("reserved_from")),
                name="ck_equipment_reservation_period",
            ),
            # The same equipment cannot have two overlapping active reservations.
            ExclusionConstraint(
                name="ex_equipment_reservation_no_overlap",
                expressions=[
                    ("equipment", RangeOperators.EQUAL),
                    (
                        Func(
                            "reserved_from",
                            "reserved_to",
                            function="tstzrange",
                            output_field=DateTimeRangeField(),
                        ),
                        RangeOperators.OVERLAPS,
                    ),
                ],
                condition=models.Q(status__in=["pending", "confirmed"]),
            ),
        ]

    def __str__(self):
        return f"{self.equipment.name} - {self.reserved_by}"


class EquipmentMaintenance(models.Model):
    equipment = models.ForeignKey(Equipment, on_delete=models.CASCADE, related_name="maintenance_logs")
    performed_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="equipment_maintenance_performed"
    )
    performed_at = models.DateTimeField(auto_now_add=True)
    description = models.TextField(blank=True)
    cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(cost__isnull=True) | models.Q(cost__gte=0), name="ck_equipment_maint_cost"
            ),
        ]

    def __str__(self):
        return f"Maintenance on {self.equipment.name}"