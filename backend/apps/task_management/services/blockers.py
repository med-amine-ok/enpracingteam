"""Blockers (specification §11). A blocker report never lowers anything and never moves a deadline by itself."""

from django.db import transaction

from ..models import (
    Action, Blocker, BlockerImpact, BlockerInvolvement, BlockerStatus, BlockerValidation, Deliverable, EntityType,
    ExecutionState, InvolvementRole,
)
from . import notify
from .activity import log
from .common import now, refuse, require_reason

EDITABLE = ("severity", "impact", "description", "required_action", "responsible_unit", "resolver", "origin")


def refresh_execution(deliverable):
    """Fully blocked if an open blocker prevents all the work, partially if some (§11.2)."""
    if deliverable is None:
        return
    impacts = set(Blocker.objects.filter(deliverable=deliverable, status=BlockerStatus.OPEN).values_list("impact", flat=True))
    if BlockerImpact.FULL in impacts:
        state = ExecutionState.FULLY_BLOCKED
    elif BlockerImpact.PARTIAL in impacts:
        state = ExecutionState.PARTIALLY_BLOCKED
    else:
        state = ExecutionState.NORMAL
    if deliverable.execution_state != state:
        Deliverable.objects.filter(pk=deliverable.pk).update(execution_state=state, updated_at=now())
        deliverable.execution_state = state


def involve(blocker, member, role):
    if member is None:
        return
    BlockerInvolvement.objects.update_or_create(blocker=blocker, member=member, defaults={"involvement_role": role})


def department_of(blocker):
    return (blocker.deliverable.work_order if blocker.deliverable_id else blocker.work_order).department


@transaction.atomic
def report(actor, data):
    """Any member reports an obstacle; no approval needed (§11.3)."""
    deliverable = data.get("deliverable")
    if deliverable is not None:
        data["work_order"] = deliverable.work_order
    if data.get("milestone") and data["milestone"].deliverable_id != getattr(deliverable, "pk", None):
        refuse("The Milestone must belong to the affected Deliverable.", "milestone")
    link = data.get("dependency_link")
    if link and deliverable and deliverable.pk not in (link.dependent_id, link.prerequisite_id):
        refuse("This dependency does not concern the affected Deliverable.", "dependency_link")
    previous = data.get("previous")
    if previous and previous.status == BlockerStatus.OPEN:
        refuse("The earlier blocker is still open: update it instead.", "previous")
    blocker = Blocker.objects.create(reported_by=actor, **data)
    involve(blocker, actor, InvolvementRole.REPORTER)
    involve(blocker, blocker.resolver, InvolvementRole.RESOLVER)
    refresh_execution(blocker.deliverable)
    log(EntityType.BLOCKER, blocker.pk, Action.CREATED, actor, new={
        "severity": blocker.severity, "impact": blocker.impact, "origin": blocker.origin,
    }, reason=blocker.description, deliverable=blocker.deliverable, work_order=blocker.work_order)
    notify.blocker_event("blocker_reported", blocker, notify.heads_of(department_of(blocker)) + [blocker.resolver], actor)
    return blocker


def locked(blocker):
    return Blocker.objects.select_for_update(of=("self",)).select_related("deliverable__work_order", "work_order").get(pk=blocker.pk)


@transaction.atomic
def update(actor, blocker, data):
    blocker = locked(blocker)
    if blocker.status != BlockerStatus.OPEN:
        refuse("A resolved or cancelled blocker is not reopened: report a new one (§11.1).")
    old = {name: getattr(blocker, name) for name in data}
    old = {name: value.pk if hasattr(value, "pk") else value for name, value in old.items()}
    for name, value in data.items():
        setattr(blocker, name, value)
    blocker.save()
    if "resolver" in data and blocker.resolver:
        involve(blocker, blocker.resolver, InvolvementRole.RESOLVER)
        notify.blocker_event("blocker_assigned", blocker, [blocker.resolver], actor)
    refresh_execution(blocker.deliverable)
    new = {name: value.pk if hasattr(value, "pk") else value for name, value in data.items()}
    log(EntityType.BLOCKER, blocker.pk, Action.UPDATED, actor, old=old, new=new,
        deliverable=blocker.deliverable, work_order=blocker.work_order)
    return blocker


@transaction.atomic
def resolve(actor, blocker, note):
    """Resolved is terminal; a resolution note is required (§11.3)."""
    blocker = locked(blocker)
    if blocker.status != BlockerStatus.OPEN:
        refuse("This blocker is not open.")
    blocker.resolution_note = require_reason(note, "Describe the resolution.")
    blocker.status = BlockerStatus.RESOLVED
    blocker.resolved_by = actor
    blocker.resolved_at = now()
    blocker.save()
    refresh_execution(blocker.deliverable)
    log(EntityType.BLOCKER, blocker.pk, Action.RESOLVED, actor, reason=blocker.resolution_note,
        deliverable=blocker.deliverable, work_order=blocker.work_order)
    people = [row.member for row in blocker.involvements.select_related("member")]
    notify.blocker_event("blocker_resolved", blocker, people + [blocker.reported_by], actor)
    return blocker


@transaction.atomic
def cancel(actor, blocker, reason):
    blocker = locked(blocker)
    if blocker.status != BlockerStatus.OPEN:
        refuse("This blocker is not open.")
    reason = require_reason(reason)
    blocker.status = BlockerStatus.CANCELLED
    blocker.resolution_note = reason
    blocker.save()
    refresh_execution(blocker.deliverable)
    log(EntityType.BLOCKER, blocker.pk, Action.CANCELLED, actor, reason=reason,
        deliverable=blocker.deliverable, work_order=blocker.work_order)
    return blocker


@transaction.atomic
def validate_impact(actor, blocker, confirmed, note=""):
    """The Head's verdict on the blocker's real impact on delivery, required before any relief (§11.3).
    Resolving a blocker does not validate its impact (§14)."""
    blocker = locked(blocker)
    if hasattr(blocker, "validation"):
        refuse("This blocker's impact is already validated.")
    if confirmed and blocker.deliverable_id is None:
        refuse("Relief concerns a Deliverable: this blocker is on a Work Order.")
    validation = BlockerValidation.objects.create(
        blocker=blocker, validated_by=actor, impact_confirmed=confirmed, impact_note=note or ""
    )
    involve(blocker, actor, InvolvementRole.VALIDATOR)
    log(EntityType.BLOCKER, blocker.pk, Action.IMPACT_VALIDATED, actor, new={"impact_confirmed": confirmed},
        reason=note, deliverable=blocker.deliverable, work_order=blocker.work_order)
    return validation
