"""
The workshop's equipment (decision D-016, knowledge base: PROJECTS/ERP/workshop_design.md): machines and tools,
the members certified to use the marked ones (charter, art. 22-23), slot reservations, loans out of the
workshop (art. 24) and maintenance. Who may do what: access.py; the rules of each change: workflow.py.
"""

from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators
from django.db import models
from django.db.models import Func
from django.utils import timezone
from django.utils.translation import gettext
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy


class EquipmentStatus(models.TextChoices):
    # Context: state of an item of equipment (French masculine, Arabic معدّة feminine).
    AVAILABLE = "available", pgettext_lazy("equipment status", "Available")
    BORROWED = "borrowed", pgettext_lazy("equipment status", "Borrowed")  # set and cleared by the loans only
    MAINTENANCE = "maintenance", pgettext_lazy("equipment status", "Maintenance")
    OUT_OF_SERVICE = "out_of_service", pgettext_lazy("equipment status", "Out of service")


# The statuses in which nobody may reserve or borrow it.
UNAVAILABLE_STATUSES = (EquipmentStatus.MAINTENANCE, EquipmentStatus.OUT_OF_SERVICE)


class EquipmentCategory(models.TextChoices):
    MACHINE = "machine", _("Machine tool")
    POWER_TOOL = "power_tool", _("Power tool")
    HAND_TOOL = "hand_tool", _("Hand tool")
    MEASURING = "measuring", _("Measuring and inspection")
    ELECTRONICS = "electronics", pgettext_lazy("equipment category", "Electronics")
    SAFETY = "safety", _("Safety equipment (PPE)")
    OTHER = "other", pgettext_lazy("equipment category", "Other")


class ReservationStatus(models.TextChoices):
    # Context: state of a reservation (French feminine: Confirmée, Annulée; Arabic حجز masculine).
    PENDING = "pending", pgettext_lazy("reservation status", "Pending")
    CONFIRMED = "confirmed", pgettext_lazy("reservation status", "Confirmed")
    CANCELLED = "cancelled", pgettext_lazy("reservation status", "Cancelled")
    COMPLETED = "completed", pgettext_lazy("reservation status", "Completed")


class LoanStatus(models.TextChoices):
    # Context: state of a loan (French masculine: le prêt; Arabic إعارة feminine).
    REQUESTED = "requested", pgettext_lazy("loan status", "Requested")
    REFUSED = "refused", pgettext_lazy("loan status", "Refused")
    CANCELLED = "cancelled", pgettext_lazy("loan status", "Cancelled")
    OUT = "out", pgettext_lazy("loan status", "Out")
    RETURNED = "returned", pgettext_lazy("loan status", "Returned")


class ReturnCondition(models.TextChoices):
    GOOD = "good", _("Good condition")
    DAMAGED = "damaged", _("Damaged")


class Equipment(models.Model):
    name = models.CharField(_("name"), max_length=255)
    category = models.CharField(
        _("category"), max_length=150, choices=EquipmentCategory.choices, default=EquipmentCategory.OTHER
    )
    status = models.CharField(
        _("status"), max_length=20, choices=EquipmentStatus.choices, default=EquipmentStatus.AVAILABLE
    )
    location = models.CharField(_("location"), max_length=255, blank=True)
    description = models.TextField(_("description"), blank=True)
    requires_certification = models.BooleanField(
        _("certification required"), default=False,
        help_text=_("Only the members certified by the workshop lead may reserve or borrow it."),
    )
    loanable = models.BooleanField(
        _("may leave the workshop"), default=True, help_text=_("Members may ask to borrow it.")
    )
    purchased_at = models.DateField(_("purchase date"), null=True, blank=True)
    last_maintenance_at = models.DateField(_("last maintenance"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        # "equipment item(s)": English uses "equipment" for both, French needs équipement / équipements.
        verbose_name = _("equipment item")
        verbose_name_plural = _("equipment items")
        ordering = ["name"]
        indexes = [
            models.Index(fields=["status"], name="idx_equipment_status"),
            models.Index(fields=["category"], name="idx_equipment_category"),
        ]

    def __str__(self):
        return self.name


class EquipmentCertification(models.Model):
    """A member allowed to use a machine that needs it (charter, art. 22-23); kept once revoked."""

    equipment = models.ForeignKey(
        Equipment, on_delete=models.CASCADE, related_name="certifications", verbose_name=_("equipment")
    )
    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="equipment_certifications",
        verbose_name=_("member"),
    )
    granted_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("granted by"),
    )
    granted_at = models.DateTimeField(_("granted at"), default=timezone.now)
    note = models.CharField(_("note"), max_length=255, blank=True)
    revoked_at = models.DateTimeField(_("revoked at"), null=True, blank=True)
    revoked_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("revoked by"),
    )

    class Meta:
        verbose_name = _("machine certification")
        verbose_name_plural = _("machine certifications")
        ordering = ["-granted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["equipment", "member"], condition=models.Q(revoked_at__isnull=True),
                name="uq_equipment_certification_active",
            ),
        ]

    def __str__(self):
        return f"{self.member} - {self.equipment.name}"


class EquipmentReservation(models.Model):
    equipment = models.ForeignKey(
        Equipment, on_delete=models.CASCADE, related_name="reservations", verbose_name=_("equipment")
    )
    reserved_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="equipment_reservations",
        verbose_name=_("reserved by"),
    )
    reserved_from = models.DateTimeField(_("reservation start"))
    reserved_to = models.DateTimeField(_("reservation end"))
    purpose = models.CharField(_("purpose"), max_length=255, blank=True)
    # Confirmed at once when the slot is free (decision D-016): no waiting state.
    status = models.CharField(
        _("status"), max_length=20, choices=ReservationStatus.choices, default=ReservationStatus.CONFIRMED
    )
    cancelled_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("cancelled by"),
    )
    cancelled_at = models.DateTimeField(_("cancelled at"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("equipment reservation")
        verbose_name_plural = _("equipment reservations")
        ordering = ["reserved_from"]
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


class EquipmentLoan(models.Model):
    """Equipment taken out of the workshop (charter, art. 24): asked, then handed out by a manager, returned."""

    equipment = models.ForeignKey(
        Equipment, on_delete=models.CASCADE, related_name="loans", verbose_name=_("equipment")
    )
    borrower = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="equipment_loans", verbose_name=_("borrower")
    )
    reason = models.TextField(_("reason"))
    due_date = models.DateField(_("return date"))
    status = models.CharField(_("status"), max_length=20, choices=LoanStatus.choices, default=LoanStatus.REQUESTED)
    requested_at = models.DateTimeField(_("requested at"), auto_now_add=True)
    decided_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("decided by"),
    )
    decided_at = models.DateTimeField(_("decided at"), null=True, blank=True)
    decision_note = models.TextField(_("decision note"), blank=True)
    returned_at = models.DateTimeField(_("returned at"), null=True, blank=True)
    received_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("received by"),
    )
    return_condition = models.CharField(
        _("condition on return"), max_length=20, choices=ReturnCondition.choices, blank=True
    )
    return_note = models.TextField(_("return note"), blank=True)

    class Meta:
        verbose_name = _("equipment loan")
        verbose_name_plural = _("equipment loans")
        ordering = ["-requested_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["equipment"], condition=models.Q(status="out"), name="uq_equipment_loan_one_out"
            ),
        ]

    def __str__(self):
        return f"{self.equipment.name} - {self.borrower}"

    @property
    def is_overdue(self):
        return self.status == LoanStatus.OUT and self.due_date < timezone.localdate()


class EquipmentMaintenance(models.Model):
    equipment = models.ForeignKey(
        Equipment, on_delete=models.CASCADE, related_name="maintenance_logs", verbose_name=_("equipment")
    )
    performed_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="equipment_maintenance_performed",
        verbose_name=_("performed by"),
    )
    # When the work was done: now by default, editable for maintenance logged afterwards.
    performed_at = models.DateTimeField(_("maintenance date"), default=timezone.now)
    description = models.TextField(_("description"), blank=True)
    cost = models.DecimalField(_("cost"), max_digits=12, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("maintenance record")
        verbose_name_plural = _("maintenance records")
        ordering = ["-performed_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(cost__isnull=True) | models.Q(cost__gte=0), name="ck_equipment_maint_cost"
            ),
        ]

    def __str__(self):
        return gettext("Maintenance on %(equipment)s") % {"equipment": self.equipment.name}
