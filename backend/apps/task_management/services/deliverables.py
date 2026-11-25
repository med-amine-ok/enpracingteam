"""Deliverables, their assignments, progress and Milestones (specification §4–5, §7.3)."""

from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import PermissionDenied

from ..models import (
    Action, Assignment, AssignmentHistory, AssignmentRole, Deliverable, DeliverableProgressLog, DeliverableProposal,
    DeliverableStatus, EntityType, Milestone, MilestoneHistory, ProposalStatus, RUNNING_WO_STATUSES,
    WorkOrder, WorkOrderStatus,
)
from . import dependencies, formulas, notify, work_orders
from .activity import log
from .common import now, refuse, require_reason

OFFICIAL_FIELDS = ("title", "description", "acceptance_criteria", "start_date", "original_deadline")
CLOSED = (DeliverableStatus.CANCELLED, DeliverableStatus.VALIDATED)
# Cancellation (§4.3 rule 4; §17.3 left open): not while a submission awaits its review, and a validated
# Deliverable must first be reopened (an explicit, audited action).
CANCELLABLE = (
    DeliverableStatus.DRAFT, DeliverableStatus.READY, DeliverableStatus.IN_PROGRESS,
    DeliverableStatus.REVISION_REQUESTED,
)


def locked(deliverable):
    return Deliverable.objects.select_for_update(of=("self",)).select_related("work_order", "work_order__department").get(
        pk=deliverable.pk
    )


def next_code(work_order):
    base = work_order.code or f"WO{work_order.pk}"
    taken = set(Deliverable.objects.filter(code__startswith=f"{base}-D").values_list("code", flat=True))
    number = len(taken) + 1
    while f"{base}-D{number:02d}" in taken:
        number += 1
    return f"{base}-D{number:02d}"


def open_work_order(work_order):
    if work_order.status in (WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED):
        refuse("This Work Order is completed or cancelled.")


def values(deliverable, fields=OFFICIAL_FIELDS):
    return {name: getattr(deliverable, name) for name in fields}


# --- Creation and proposals ---


@transaction.atomic
def create(actor, work_order, data, member_ids=()):
    """A Head creates an official Deliverable (§4.4). Its weight is set with the credit plan."""
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    open_work_order(work_order)
    if not work_order.is_official:
        refuse("Approve the Work Order proposal first.")
    deliverable = Deliverable(work_order=work_order, created_by=actor, **data)
    deliverable.code = next_code(work_order)
    deliverable.save()
    dependencies.recompute_relief(deliverable)
    log(EntityType.DELIVERABLE, deliverable.pk, Action.CREATED, actor, new=values(deliverable), deliverable=deliverable)
    for member in member_ids:
        assign(actor, deliverable, member)
    return deliverable


@transaction.atomic
def propose(actor, work_order, data, *, justification="", submit=True):
    """A member proposes a Deliverable for a Work Order (§4.2). Not official, earns nothing, until approved."""
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    open_work_order(work_order)
    if not work_order.is_official:
        refuse("This Work Order is not approved yet.")
    deliverable = Deliverable.objects.create(
        work_order=work_order, created_by=actor, proposed_by=actor,
        proposal_status=ProposalStatus.PENDING_REVIEW if submit else ProposalStatus.DRAFT,
        proposal_submitted_at=now() if submit else None, **data,
    )
    DeliverableProposal.objects.create(
        deliverable=deliverable, proposed_by=actor, status=deliverable.proposal_status,
        proposed_title=deliverable.title, proposed_desc=deliverable.description,
        proposed_criteria=deliverable.acceptance_criteria, proposed_deadline=deliverable.original_deadline,
        justification=justification or "",
    )
    log(EntityType.DELIVERABLE, deliverable.pk, Action.PROPOSED, actor, new=values(deliverable), deliverable=deliverable)
    if submit:
        notify.deliverable_event("deliverable_proposed", deliverable, notify.heads_of(work_order.department), actor)
    return deliverable


@transaction.atomic
def submit_proposal(actor, deliverable):
    deliverable = locked(deliverable)
    if deliverable.proposed_by_id != actor.pk or deliverable.proposal_status != ProposalStatus.DRAFT:
        refuse("Only its author submits a draft proposal.")
    deliverable.proposal_status = ProposalStatus.PENDING_REVIEW
    deliverable.proposal_submitted_at = now()
    deliverable.save(update_fields=["proposal_status", "proposal_submitted_at", "updated_at"])
    DeliverableProposal.objects.filter(deliverable=deliverable).update(
        status=ProposalStatus.PENDING_REVIEW, proposed_title=deliverable.title, proposed_desc=deliverable.description,
        proposed_criteria=deliverable.acceptance_criteria, proposed_deadline=deliverable.original_deadline,
    )
    notify.deliverable_event(
        "deliverable_proposed", deliverable, notify.heads_of(deliverable.work_order.department), actor
    )
    return deliverable


def decide_guard(actor, deliverable):
    if deliverable.proposal_status != ProposalStatus.PENDING_REVIEW:
        refuse("This proposal is not awaiting a decision.")
    if deliverable.proposed_by_id == actor.pk:
        raise PermissionDenied("Nobody decides on their own proposal.")


@transaction.atomic
def approve(actor, deliverable, data, member_ids=(), note=""):
    """On approval the Head confirms the official criteria, dates, weight and assignments (§4.2)."""
    deliverable = locked(deliverable)
    decide_guard(actor, deliverable)
    weight = data.pop("weight", None)
    for name, value in data.items():
        setattr(deliverable, name, value)
    deliverable.proposal_status = ProposalStatus.APPROVED
    deliverable.proposal_decided_at = now()
    deliverable.proposal_decided_by = actor
    deliverable.proposal_note = note or ""
    deliverable.code = next_code(deliverable.work_order)
    deliverable.save()
    if weight is not None:
        set_weights(actor, deliverable.work_order, {deliverable.pk: weight}, reason=note, partial=True)
    dependencies.recompute_relief(deliverable)
    DeliverableProposal.objects.filter(deliverable=deliverable).update(
        status=ProposalStatus.APPROVED, decided_by=actor, decided_at=now(), decision_note=note or ""
    )
    log(EntityType.DELIVERABLE, deliverable.pk, Action.APPROVED, actor, new=values(deliverable), reason=note,
        deliverable=deliverable)
    for member in member_ids:
        assign(actor, deliverable, member)
    notify.deliverable_event("deliverable_proposal_approved", deliverable, [deliverable.proposed_by], actor)
    return deliverable


@transaction.atomic
def reject(actor, deliverable, note):
    deliverable = locked(deliverable)
    decide_guard(actor, deliverable)
    note = require_reason(note, "Explain the rejection.")
    deliverable.proposal_status = ProposalStatus.REJECTED
    deliverable.proposal_decided_at = now()
    deliverable.proposal_decided_by = actor
    deliverable.proposal_note = note
    deliverable.save()
    DeliverableProposal.objects.filter(deliverable=deliverable).update(
        status=ProposalStatus.REJECTED, decided_by=actor, decided_at=now(), decision_note=note
    )
    log(EntityType.DELIVERABLE, deliverable.pk, Action.REJECTED, actor, reason=note, deliverable=deliverable)
    notify.deliverable_event("deliverable_proposal_rejected", deliverable, [deliverable.proposed_by], actor, note=note)
    return deliverable


# --- Official details and the credit plan ---


@transaction.atomic
def update(actor, deliverable, data, *, reason=""):
    """The Head edits the official details. Once the Work Order is active, a change of criteria or dates is
    audited with its reason (§4.4: "Change official deadline: subject to audit")."""
    deliverable = locked(deliverable)
    if deliverable.status in CLOSED:
        refuse("A validated or cancelled Deliverable no longer changes.")
    if deliverable.proposal_status == ProposalStatus.REJECTED:
        refuse("A rejected proposal no longer changes.")
    old = values(deliverable, tuple(data))
    for name, value in data.items():
        setattr(deliverable, name, value)
    changed = {name: value for name, value in values(deliverable, tuple(data)).items() if old[name] != value}
    if not changed:
        return deliverable
    sensitive = {"acceptance_criteria", "start_date", "original_deadline"} & set(changed)
    if sensitive and deliverable.work_order.is_locked:
        reason = require_reason(reason, "Once the Work Order is active, criteria and dates change only with a reason.")
    if deliverable.start_date and deliverable.original_deadline and deliverable.original_deadline < deliverable.start_date:
        refuse("The deadline cannot be before the start date.", "original_deadline")
    deliverable.save()
    if "original_deadline" in changed:
        dependencies.recompute_relief(deliverable)
        log(EntityType.DELIVERABLE, deliverable.pk, Action.DEADLINE_CHANGED, actor,
            old={"original_deadline": old["original_deadline"]}, new={"original_deadline": deliverable.original_deadline},
            reason=reason, deliverable=deliverable)
    log(EntityType.DELIVERABLE, deliverable.pk, Action.UPDATED, actor,
        old={name: old[name] for name in changed}, new=changed, reason=reason, deliverable=deliverable)
    return deliverable


@transaction.atomic
def set_weights(actor, work_order, weights, *, reason="", partial=False):
    """The Head sets the official weights (§7.3). While planning they may not total 100 % yet; once the Work
    Order is active they must, and the change needs a reason (§7.2)."""
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    open_work_order(work_order)
    if work_order.proposal_status in (ProposalStatus.DRAFT, ProposalStatus.PENDING_REVIEW, ProposalStatus.REJECTED):
        refuse("Weights are set on an approved Work Order.")
    active = {deliverable.pk: deliverable for deliverable in work_orders.active_deliverables(work_order)}
    unknown = set(weights) - set(active)
    if unknown:
        refuse("These Deliverables are not active Deliverables of this Work Order.", "weights")
    new = {pk: Decimal(str(weights.get(pk, deliverable.weight))) for pk, deliverable in active.items()}
    for weight in new.values():
        if weight < 0 or weight > 100 or weight != weight.quantize(formulas.WEIGHT_STEP):
            refuse("A weight goes from 0 to 100 %, to the thousandth.", "weights")
    total = sum(new.values(), Decimal("0"))
    if total > formulas.HUNDRED:
        refuse(f"The weights total {total.normalize():f} %, more than 100 %.", "weights")
    if work_order.is_locked:
        reason = require_reason(reason, "The weights of an active Work Order change only with a reason.")
        if total != formulas.HUNDRED and not partial:
            refuse(f"The weights must total 100 %, not {total.normalize():f} %.", "weights")
    for pk, weight in new.items():
        deliverable = active[pk]
        if deliverable.weight != weight:
            log(EntityType.DELIVERABLE, pk, Action.WEIGHT_CHANGED, actor, old={"weight": deliverable.weight},
                new={"weight": weight}, reason=reason, deliverable=deliverable, work_order=work_order)
            deliverable.weight = weight
            deliverable.save(update_fields=["weight", "updated_at"])
    if work_order.is_locked:
        work_orders.refresh_snapshot(work_order, actor)
    return work_order


def redistribute(actor, deliverable, reason):
    """A cancelled Deliverable's weight goes equally to the other active ones (§4.3 rule 4)."""
    work_order = deliverable.work_order
    others = [item for item in work_orders.active_deliverables(work_order) if item.pk != deliverable.pk]
    removed = deliverable.weight
    if not others or not removed:
        return
    for item, weight in zip(others, formulas.redistribute([item.weight for item in others], removed), strict=True):
        log(EntityType.DELIVERABLE, item.pk, Action.WEIGHT_CHANGED, actor, old={"weight": item.weight},
            new={"weight": weight}, reason=reason, deliverable=item, work_order=work_order)
        item.weight = weight
        item.save(update_fields=["weight", "updated_at"])
    if work_order.is_locked:
        work_orders.refresh_snapshot(work_order, actor)


# --- Workflow (§4.3) ---


def set_status(actor, deliverable, status, reason="", action=Action.STATUS_CHANGED):
    old = deliverable.status
    deliverable.status = status
    deliverable.save(update_fields=["status", "updated_at"])
    log(EntityType.DELIVERABLE, deliverable.pk, action, actor, old={"status": old}, new={"status": status},
        reason=reason, deliverable=deliverable)


@transaction.atomic
def mark_ready(actor, deliverable):
    deliverable = locked(deliverable)
    if deliverable.status != DeliverableStatus.DRAFT or not deliverable.is_official:
        refuse("Only an official draft becomes ready.")
    missing = [
        label for label, ok in (
            ("acceptance criteria", deliverable.acceptance_criteria.strip()),
            ("start date", deliverable.start_date), ("deadline", deliverable.original_deadline),
            ("an assigned member", deliverable.assignments.filter(is_active=True).exists()),
        ) if not ok
    ]
    if missing:
        refuse("Before it is ready, set: " + ", ".join(missing) + ".")
    set_status(actor, deliverable, DeliverableStatus.READY)
    return deliverable


@transaction.atomic
def start(actor, deliverable):
    """Ready → in progress, or back to work after a revision request. Work may go on while a prerequisite is
    still awaited (§9.10 cases B and C): the dependency state is shown, not enforced here."""
    deliverable = locked(deliverable)
    if deliverable.status not in (DeliverableStatus.READY, DeliverableStatus.REVISION_REQUESTED):
        refuse("Only a ready Deliverable, or one sent back for revision, is started.")
    if deliverable.work_order.status not in RUNNING_WO_STATUSES:
        refuse("Its Work Order is not active yet.")
    set_status(actor, deliverable, DeliverableStatus.IN_PROGRESS)
    work_orders.follow_deliverables(deliverable.work_order, actor)
    return deliverable


def close(actor, deliverable, reason, *, share_weight=True):
    """Cancels: excluded from progress, its weight shared out, its dependency links cancelled (guide §9.4)."""
    old_status = deliverable.status
    recipients = notify.assignees(deliverable)
    deliverable.status = DeliverableStatus.CANCELLED
    deliverable.save(update_fields=["status", "updated_at"])
    log(EntityType.DELIVERABLE, deliverable.pk, Action.CANCELLED, actor, old={"status": old_status},
        new={"status": DeliverableStatus.CANCELLED}, reason=reason, deliverable=deliverable)
    if share_weight:
        redistribute(actor, deliverable, reason)
    dependencies.cancel_links_of(actor, deliverable, reason, incoming=True)
    notify.deliverable_event("deliverable_cancelled", deliverable, recipients, actor)


@transaction.atomic
def cancel(actor, deliverable, reason):
    deliverable = locked(deliverable)
    if deliverable.status not in CANCELLABLE:
        refuse("A Deliverable awaiting its review, validated or already cancelled cannot be cancelled.")
    if not deliverable.is_official:
        refuse("A proposal is rejected, not cancelled.")
    close(actor, deliverable, require_reason(reason, "Give the reason for the cancellation."))
    work_orders.follow_deliverables(deliverable.work_order, actor)
    return deliverable


@transaction.atomic
def reopen(actor, deliverable, reason):
    """A validated Deliverable never reopens silently (§4.3 rule 3): explicit, audited, by its Head. Its links
    as a prerequisite are cancelled: a renewed prerequisite is a new dependency (guide §9.4)."""
    deliverable = locked(deliverable)
    if deliverable.status != DeliverableStatus.VALIDATED:
        refuse("Only a validated Deliverable is reopened.")
    reason = require_reason(reason, "Give the reason for reopening it.")
    set_status(actor, deliverable, DeliverableStatus.IN_PROGRESS, reason, action=Action.REOPENED)
    dependencies.cancel_links_of(actor, deliverable, reason, incoming=False)
    work_orders.follow_deliverables(deliverable.work_order, actor)
    notify.deliverable_event("deliverable_reopened", deliverable, notify.assignees(deliverable), actor)
    return deliverable


@transaction.atomic
def update_progress(actor, deliverable, progress, note=""):
    """The team's 0–100 % estimate (§5.3); a Milestone never changes it."""
    deliverable = locked(deliverable)
    if deliverable.status in CLOSED or deliverable.status == DeliverableStatus.DRAFT:
        refuse("The progress is reported while the Deliverable is ready or under way.")
    if not 0 <= progress <= 100:
        refuse("The progress goes from 0 to 100 %.", "progress")
    if progress == deliverable.progress:
        refuse("The progress is already at this value.", "progress")
    old = deliverable.progress
    deliverable.progress = progress
    deliverable.progress_updated_at = now()
    deliverable.save(update_fields=["progress", "progress_updated_at", "updated_at"])
    DeliverableProgressLog.objects.create(deliverable=deliverable, progress_pct=progress, note=note or "", recorded_by=actor)
    log(EntityType.DELIVERABLE, deliverable.pk, Action.PROGRESS_UPDATED, actor, old={"progress": old},
        new={"progress": progress}, reason=note, deliverable=deliverable)
    return deliverable


# --- Assignments (§4.5) ---


@transaction.atomic
def assign(actor, deliverable, member, role=AssignmentRole.MEMBER, reason=""):
    if deliverable.status in CLOSED:
        refuse("A validated or cancelled Deliverable keeps its assignments.")
    if not member.is_active:
        refuse("This member's account is not active.", "member")
    assignment, created = Assignment.objects.get_or_create(
        deliverable=deliverable, member=member, defaults={"role": role, "assigned_by": actor}
    )
    if not created:
        if assignment.is_active:
            refuse("This member is already assigned.", "member")
        assignment.is_active = True
        assignment.unassigned_at = None
        assignment.role = role
        assignment.assigned_by = actor
        assignment.save()
    AssignmentHistory.objects.create(deliverable=deliverable, member=member, action="assigned", new_role=role,
                                     changed_by=actor, reason=reason or "")
    log(EntityType.ASSIGNMENT, assignment.pk, Action.ASSIGNED, actor, new={"member": member.pk, "role": role},
        reason=reason, deliverable=deliverable)
    notify.deliverable_event("deliverable_assigned", deliverable, [member], actor)
    return assignment


@transaction.atomic
def unassign(actor, assignment, reason=""):
    """Operational only: the credit set frozen at the first complete submission does not change (§4.5)."""
    assignment = Assignment.objects.select_for_update(of=("self",)).select_related("deliverable", "member").get(pk=assignment.pk)
    if not assignment.is_active:
        refuse("This member is no longer assigned.")
    if assignment.deliverable.status in CLOSED:
        refuse("A validated or cancelled Deliverable keeps its assignments.")
    assignment.is_active = False
    assignment.unassigned_at = now()
    assignment.save(update_fields=["is_active", "unassigned_at"])
    AssignmentHistory.objects.create(deliverable=assignment.deliverable, member=assignment.member, action="unassigned",
                                     previous_role=assignment.role, changed_by=actor, reason=reason or "")
    log(EntityType.ASSIGNMENT, assignment.pk, Action.UNASSIGNED, actor, old={"member": assignment.member_id},
        reason=reason, deliverable=assignment.deliverable)
    return assignment


@transaction.atomic
def set_role(actor, assignment, role):
    assignment = Assignment.objects.select_for_update(of=("self",)).select_related("deliverable").get(pk=assignment.pk)
    if not assignment.is_active or assignment.role == role:
        return assignment
    AssignmentHistory.objects.create(deliverable=assignment.deliverable, member_id=assignment.member_id,
                                     action="role_changed", previous_role=assignment.role, new_role=role, changed_by=actor)
    assignment.role = role
    assignment.save(update_fields=["role"])
    return assignment


# --- Milestones (§5) ---


def milestone_history(milestone, field, old, new, actor, note=""):
    MilestoneHistory.objects.create(milestone=milestone, field_changed=field, old_value="" if old is None else str(old),
                                    new_value="" if new is None else str(new), changed_by=actor, note=note or "")


@transaction.atomic
def create_milestone(actor, deliverable, title, description=""):
    if deliverable.status in CLOSED:
        refuse("A validated or cancelled Deliverable gets no new Milestone.")
    milestone = Milestone.objects.create(deliverable=deliverable, title=title, description=description or "",
                                         created_by=actor)
    milestone_history(milestone, "created", None, title, actor)
    log(EntityType.MILESTONE, milestone.pk, Action.CREATED, actor, new={"title": title}, deliverable=deliverable)
    return milestone


@transaction.atomic
def update_milestone(actor, milestone, data):
    milestone = Milestone.objects.select_for_update(of=("self",)).select_related("deliverable__work_order").get(pk=milestone.pk)
    if milestone.is_cancelled:
        refuse("A cancelled Milestone no longer changes.")
    for field in ("title", "description"):
        if field in data and data[field] != getattr(milestone, field):
            milestone_history(milestone, field, getattr(milestone, field), data[field], actor)
            setattr(milestone, field, data[field])
    milestone.save()
    log(EntityType.MILESTONE, milestone.pk, Action.UPDATED, actor, new=data, deliverable=milestone.deliverable)
    return milestone


@transaction.atomic
def set_completed(actor, milestone, completed, note=""):
    """Binary: completed or not (§5.2). Never touches the Deliverable's progress; may release dependencies."""
    milestone = Milestone.objects.select_for_update(of=("self",)).select_related("deliverable__work_order").get(pk=milestone.pk)
    if milestone.is_cancelled:
        refuse("A cancelled Milestone cannot be completed.")
    if milestone.deliverable.status == DeliverableStatus.CANCELLED:
        refuse("Its Deliverable is cancelled.")
    if milestone.is_completed == completed:
        return milestone
    milestone_history(milestone, "is_completed", milestone.is_completed, completed, actor, note)
    milestone.is_completed = completed
    milestone.completed_at = now() if completed else None
    milestone.completed_by = actor if completed else None
    milestone.save()
    log(EntityType.MILESTONE, milestone.pk, Action.COMPLETED if completed else Action.UNCOMPLETED, actor,
        new={"title": milestone.title}, reason=note, deliverable=milestone.deliverable)
    if completed:
        dependencies.evaluate_from(milestone.deliverable, actor)
    return milestone


def referenced(milestone):
    """Used by a dependency, active or not: then kept for good (§5.1)."""
    return milestone.dependency_links.exists()


@transaction.atomic
def cancel_milestone(actor, milestone, reason):
    milestone = Milestone.objects.select_for_update(of=("self",)).select_related("deliverable__work_order").get(pk=milestone.pk)
    if milestone.is_cancelled:
        refuse("This Milestone is already cancelled.")
    if milestone.is_completed:
        refuse("A completed Milestone is kept.")
    if referenced(milestone):
        refuse("A dependency refers to this Milestone: it is kept as a permanent record.")
    reason = require_reason(reason)
    milestone_history(milestone, "is_cancelled", False, True, actor, reason)
    milestone.is_cancelled = True
    milestone.cancelled_at = now()
    milestone.cancelled_by = actor
    milestone.save()
    log(EntityType.MILESTONE, milestone.pk, Action.CANCELLED, actor, new={"title": milestone.title}, reason=reason,
        deliverable=milestone.deliverable)
    return milestone


@transaction.atomic
def delete_milestone(actor, milestone):
    milestone = Milestone.objects.select_for_update(of=("self",)).select_related("deliverable__work_order").get(pk=milestone.pk)
    if milestone.is_completed or referenced(milestone) or milestone.history.filter(field_changed="is_completed").exists():
        refuse("This Milestone has a history (completed, or used by a dependency): cancel it instead.")
    log(EntityType.MILESTONE, milestone.pk, Action.CANCELLED, actor, old={"title": milestone.title},
        reason="deleted", deliverable=milestone.deliverable)
    milestone.delete()
