"""
The rules of each change in the workshop (decision D-016, knowledge base: PROJECTS/ERP/workshop_design.md).
The views check who may make the change (access.py); these functions check that it may happen now.
"""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import formats, timezone
from django.utils.translation import gettext as _
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.communication import notify

from .models import (
    UNAVAILABLE_STATUSES, EquipmentCertification, EquipmentMaintenance, EquipmentReservation, EquipmentStatus,
    LoanStatus, ReservationStatus, ReturnCondition,
)

# A slot may start a little before now (the member books as they arrive), and lasts a week at most.
START_GRACE = timedelta(minutes=15)
LONGEST_RESERVATION = timedelta(days=7)
ACTIVE_RESERVATIONS = (ReservationStatus.PENDING, ReservationStatus.CONFIRMED)


def check_usable(equipment):
    if equipment.status in UNAVAILABLE_STATUSES:
        raise ValidationError({"detail": _("This equipment is in maintenance or out of service.")})


def check_certified(access, equipment):
    if not access.may_use(equipment):
        raise PermissionDenied(_("This machine needs a certification: ask the workshop lead."))


def coming_reservations(equipment):
    return equipment.reservations.filter(status__in=ACTIVE_RESERVATIONS, reserved_to__gt=timezone.now())


# --- Reservations ---


def reserve(equipment, member, start, end, purpose, access):
    """A slot, confirmed at once when it is free (decision D-016)."""
    if end <= start:
        raise ValidationError({"reserved_to": [_("The end must come after the start.")]})
    if start < timezone.now() - START_GRACE:
        raise ValidationError({"reserved_from": [_("This slot has already started.")]})
    if end - start > LONGEST_RESERVATION:
        raise ValidationError({"reserved_to": [_("A reservation lasts 7 days at most.")]})
    check_usable(equipment)
    check_certified(access, equipment)
    loan = equipment.loans.filter(status=LoanStatus.OUT).first()
    if loan is not None and timezone.localdate(start) <= loan.due_date:
        raise ValidationError({"detail": _("It is lent out until %(date)s.") % {
            "date": formats.date_format(loan.due_date, "DATE_FORMAT")}})
    try:
        with transaction.atomic():
            return EquipmentReservation.objects.create(
                equipment=equipment, reserved_by=member, reserved_from=start, reserved_to=end, purpose=purpose,
            )
    except IntegrityError as overlap:  # ex_equipment_reservation_no_overlap
        raise ValidationError({"detail": _("This slot is already taken.")}) from overlap


def cancel_reservation(reservation, actor, reason="", unavailable=False):
    if reservation.status not in ACTIVE_RESERVATIONS:
        raise ValidationError({"detail": _("This reservation is already cancelled.")})
    if reservation.reserved_to <= timezone.now():
        raise ValidationError({"detail": _("This slot is over.")})
    reservation.status = ReservationStatus.CANCELLED
    reservation.cancelled_by = actor
    reservation.cancelled_at = timezone.now()
    reservation.save(update_fields=["status", "cancelled_by", "cancelled_at"])
    if actor is None or actor.pk != reservation.reserved_by_id:
        notify.reservation_cancelled(reservation, actor, reason=reason, unavailable=unavailable)


# --- Status and maintenance ---


def set_status(equipment, status, actor):
    """Available, in maintenance or out of service; "borrowed" comes and goes with the loans."""
    if status == equipment.status:
        return
    if status == EquipmentStatus.BORROWED:
        raise ValidationError({"status": [_("“Borrowed” is set when a loan is handed out.")]})
    if equipment.status == EquipmentStatus.BORROWED:
        raise ValidationError({"status": [_("It is lent out: record its return first.")]})
    equipment.status = status
    equipment.save(update_fields=["status", "updated_at"])
    if status in UNAVAILABLE_STATUSES:
        for reservation in coming_reservations(equipment).select_related("equipment"):
            cancel_reservation(reservation, actor, unavailable=True)


def record_maintenance(equipment, actor, performed_at, description, cost, status):
    maintenance = EquipmentMaintenance.objects.create(
        equipment=equipment, performed_by=actor, performed_at=performed_at, description=description, cost=cost,
    )
    done = timezone.localdate(performed_at)
    if equipment.last_maintenance_at is None or done > equipment.last_maintenance_at:
        equipment.last_maintenance_at = done
        equipment.save(update_fields=["last_maintenance_at", "updated_at"])
    if status:
        set_status(equipment, status, actor)
    return maintenance


# --- Certifications (charter, art. 22-23) ---


def certify(equipment, member, actor, note=""):
    if not member.is_active:
        raise ValidationError({"member_id": [_("This account is inactive.")]})
    if equipment.certifications.filter(member=member, revoked_at__isnull=True).exists():
        raise ValidationError({"member_id": [_("This member is already certified on it.")]})
    certification = EquipmentCertification.objects.create(
        equipment=equipment, member=member, granted_by=actor, note=note
    )
    notify.certification_granted(certification, actor)
    return certification


def revoke(certification, actor):
    if certification.revoked_at is not None:
        raise ValidationError({"detail": _("This certification is already revoked.")})
    certification.revoked_at = timezone.now()
    certification.revoked_by = actor
    certification.save(update_fields=["revoked_at", "revoked_by"])


# --- Loans (charter, art. 24) ---


def request_loan(equipment, member, reason, due_date, access):
    if not equipment.loanable:
        raise ValidationError({"detail": _("This equipment stays in the workshop.")})
    check_usable(equipment)
    check_certified(access, equipment)
    if due_date < timezone.localdate():
        raise ValidationError({"due_date": [_("The return date is already past.")]})
    if equipment.loans.filter(borrower=member, status__in=(LoanStatus.REQUESTED, LoanStatus.OUT)).exists():
        raise ValidationError({"detail": _("You already asked to borrow it.")})
    loan = equipment.loans.create(borrower=member, reason=reason, due_date=due_date)
    notify.loan_requested(loan, member)
    return loan


def check_requested(loan):
    if loan.status != LoanStatus.REQUESTED:
        raise ValidationError({"detail": _("This request is no longer awaiting a decision.")})


def approve(loan, actor):
    """Handed out: the equipment leaves the workshop."""
    check_requested(loan)
    equipment = loan.equipment
    if equipment.status == EquipmentStatus.BORROWED or equipment.loans.filter(status=LoanStatus.OUT).exists():
        raise ValidationError({"detail": _("It is already lent out.")})
    check_usable(equipment)
    if loan.due_date < timezone.localdate():
        raise ValidationError({"detail": _("Its return date is past: the member asks again with a new date.")})
    if coming_reservations(equipment).filter(reserved_from__date__lte=loan.due_date).exists():
        raise ValidationError({"detail": _("It is reserved during this loan: see its reservations.")})
    loan.status = LoanStatus.OUT
    loan.decided_by, loan.decided_at = actor, timezone.now()
    loan.save(update_fields=["status", "decided_by", "decided_at"])
    equipment.status = EquipmentStatus.BORROWED
    equipment.save(update_fields=["status", "updated_at"])
    notify.loan_decided(loan, actor)


def refuse(loan, actor, note):
    check_requested(loan)
    loan.status = LoanStatus.REFUSED
    loan.decided_by, loan.decided_at, loan.decision_note = actor, timezone.now(), note
    loan.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
    notify.loan_decided(loan, actor)


def cancel_loan(loan):
    check_requested(loan)
    loan.status = LoanStatus.CANCELLED
    loan.save(update_fields=["status"])


def receive(loan, actor, condition, note=""):
    """Back in the workshop: available again, or in maintenance when damaged."""
    if loan.status != LoanStatus.OUT:
        raise ValidationError({"detail": _("This equipment is not out.")})
    loan.status = LoanStatus.RETURNED
    loan.returned_at, loan.received_by = timezone.now(), actor
    loan.return_condition, loan.return_note = condition, note
    loan.save(update_fields=["status", "returned_at", "received_by", "return_condition", "return_note"])
    equipment = loan.equipment
    equipment.status = (
        EquipmentStatus.AVAILABLE if condition == ReturnCondition.GOOD else EquipmentStatus.MAINTENANCE
    )
    equipment.save(update_fields=["status", "updated_at"])
