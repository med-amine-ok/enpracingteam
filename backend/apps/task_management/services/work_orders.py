"""Work Orders: proposal, approval and lifecycle (specification §3, §7.2)."""

from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import PermissionDenied

from ..models import (
    Action, DeliverableStatus, DeliverableWeightSnapshot, EntityType, FormulaVersion, ProjectDepartment,
    ProposalStatus, WoBudgetRubric, WorkOrder, WorkOrderStatus, WorkOrderStatusHistory,
)
from . import formulas, notify
from .activity import log, scoring_audit
from .common import now, refuse, require_reason

EDITABLE = (
    "title", "description", "objectives", "justification", "estimated_effort_units", "priority", "coordinator",
    "project",
)
PROPOSAL_FIELDS = EDITABLE + ("season", "department")


def snapshot(work_order, fields=PROPOSAL_FIELDS):
    values = {}
    for name in fields:
        value = getattr(work_order, name)
        values[name] = value.pk if hasattr(value, "pk") else value
    return values


def next_code(season):
    prefix = f"WO-{season.year}-"
    taken = set(WorkOrder.objects.filter(code__startswith=prefix).values_list("code", flat=True))
    number = len(taken) + 1
    while f"{prefix}{number:03d}" in taken:
        number += 1
    return f"{prefix}{number:03d}"


def set_status(work_order, status, actor, reason=""):
    old = work_order.status
    work_order.status = status
    work_order.save(update_fields=["status", "updated_at"])
    WorkOrderStatusHistory.objects.create(
        work_order=work_order, from_status=old, to_status=status, changed_by=actor, reason=reason or ""
    )
    log(EntityType.WORK_ORDER, work_order.pk, Action.STATUS_CHANGED, actor,
        old={"status": old}, new={"status": status}, reason=reason, work_order=work_order)


def join_project(work_order):
    """A department with work in a project takes part in it (§6.3)."""
    if work_order.project_id:
        ProjectDepartment.objects.get_or_create(project_id=work_order.project_id, org_unit_id=work_order.department_id)


@transaction.atomic
def create(actor, data):
    """A Head creates an official Work Order; it stays a draft while its Deliverables are prepared (§3.1 A)."""
    work_order = WorkOrder(created_by=actor, **data)
    work_order.code = next_code(work_order.season)
    work_order.save()
    WorkOrderStatusHistory.objects.create(work_order=work_order, to_status=work_order.status, changed_by=actor)
    log(EntityType.WORK_ORDER, work_order.pk, Action.CREATED, actor, new=snapshot(work_order), work_order=work_order)
    join_project(work_order)
    return work_order


@transaction.atomic
def propose(actor, data, *, submit=True):
    """A member proposes a Work Order (§3.1 B). Not official work until a Head approves it."""
    data = {key: value for key, value in data.items() if key != "budget_tier"}
    work_order = WorkOrder(created_by=actor, proposed_by=actor, **data)
    work_order.proposal_status = ProposalStatus.PENDING_REVIEW if submit else ProposalStatus.DRAFT
    if submit:
        work_order.proposal_submitted_at = now()
    work_order.save()
    work_order.proposal_original = snapshot(work_order)
    work_order.save(update_fields=["proposal_original"])
    log(EntityType.WORK_ORDER, work_order.pk, Action.PROPOSED, actor, new=work_order.proposal_original,
        work_order=work_order)
    if submit:
        notify.work_order_event("wo_proposed", work_order, notify.heads_of(work_order.department), actor)
    return work_order


@transaction.atomic
def submit_proposal(actor, work_order):
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    if work_order.proposed_by_id != actor.pk or work_order.proposal_status != ProposalStatus.DRAFT:
        refuse("Only its author submits a draft proposal.")
    work_order.proposal_status = ProposalStatus.PENDING_REVIEW
    work_order.proposal_submitted_at = now()
    work_order.proposal_original = snapshot(work_order)
    work_order.save(update_fields=["proposal_status", "proposal_submitted_at", "proposal_original", "updated_at"])
    log(EntityType.WORK_ORDER, work_order.pk, Action.PROPOSED, actor, new=work_order.proposal_original,
        work_order=work_order)
    notify.work_order_event("wo_proposed", work_order, notify.heads_of(work_order.department), actor)
    return work_order


@transaction.atomic
def update(actor, work_order, data, *, reason=""):
    """Edit the details. Once active, the budget changes only with a reason (§7.2: never silently)."""
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    if work_order.status in (WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED):
        refuse("A completed or cancelled Work Order no longer changes.")
    if work_order.proposal_status == ProposalStatus.REJECTED:
        refuse("A rejected proposal no longer changes.")
    old = snapshot(work_order, tuple(data))
    old_budget = work_order.budget_tier
    for name, value in data.items():
        setattr(work_order, name, value)
    if "budget_tier" in data and work_order.budget_tier != old_budget:
        if work_order.proposal_status in (ProposalStatus.DRAFT, ProposalStatus.PENDING_REVIEW):
            refuse("The budget is set once the proposal is approved.", "budget_tier")
        if work_order.is_locked:
            reason = require_reason(reason, "The budget of an active Work Order changes only with a reason.")
        log(EntityType.WORK_ORDER, work_order.pk, Action.BUDGET_CHANGED, actor,
            old={"budget_tier": old_budget}, new={"budget_tier": work_order.budget_tier}, reason=reason,
            work_order=work_order)
        if work_order.is_locked:
            refresh_snapshot(work_order, actor)
    work_order.save()
    changed = {key: value for key, value in snapshot(work_order, tuple(data)).items() if old.get(key) != value}
    changed.pop("budget_tier", None)
    if changed:
        log(EntityType.WORK_ORDER, work_order.pk, Action.UPDATED, actor,
            old={key: old[key] for key in changed}, new=changed, reason=reason, work_order=work_order)
    join_project(work_order)
    return work_order


def decide_guard(actor, work_order):
    if work_order.proposal_status != ProposalStatus.PENDING_REVIEW:
        refuse("This proposal is not awaiting a decision.")
    if work_order.proposed_by_id == actor.pk:
        raise PermissionDenied("Nobody decides on their own proposal.")


@transaction.atomic
def approve(actor, work_order, note=""):
    """Approve: the proposal, as edited by the Head, becomes an official Work Order (draft) (§3.1)."""
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    decide_guard(actor, work_order)
    work_order.proposal_status = ProposalStatus.APPROVED
    work_order.proposal_decided_at = now()
    work_order.proposal_decided_by = actor
    work_order.proposal_note = note or ""
    work_order.code = next_code(work_order.season)
    work_order.save()
    WorkOrderStatusHistory.objects.create(work_order=work_order, to_status=work_order.status, changed_by=actor,
                                          reason="proposal approved")
    log(EntityType.WORK_ORDER, work_order.pk, Action.APPROVED, actor, old=work_order.proposal_original,
        new=snapshot(work_order), reason=note, work_order=work_order)
    join_project(work_order)
    notify.work_order_event("wo_proposal_approved", work_order, [work_order.proposed_by], actor)
    return work_order


@transaction.atomic
def reject(actor, work_order, note):
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    decide_guard(actor, work_order)
    note = require_reason(note, "Explain the rejection.")
    work_order.proposal_status = ProposalStatus.REJECTED
    work_order.proposal_decided_at = now()
    work_order.proposal_decided_by = actor
    work_order.proposal_note = note
    work_order.save()
    log(EntityType.WORK_ORDER, work_order.pk, Action.REJECTED, actor, reason=note, work_order=work_order)
    notify.work_order_event("wo_proposal_rejected", work_order, [work_order.proposed_by], actor, note=note)
    return work_order


def active_deliverables(work_order):
    return [
        deliverable for deliverable in work_order.deliverables.select_for_update().order_by("pk")
        if deliverable.is_active
    ]


def credit_plan_problems(work_order, deliverables):
    """Why the Work Order cannot be active for scoring yet (§3.1, §7.3): budget, Deliverables, dates, 100 %."""
    problems = []
    if work_order.budget_tier is None:
        problems.append("Set the point budget (1 to 5).")
    if not deliverables:
        problems.append("Add at least one Deliverable.")
    for deliverable in deliverables:
        if deliverable.start_date is None or deliverable.original_deadline is None:
            problems.append(f"{deliverable.code or deliverable.title}: set its start date and deadline.")
    total = sum((deliverable.weight for deliverable in deliverables), Decimal("0"))
    if deliverables and total != formulas.HUNDRED:
        problems.append(f"The Deliverable weights total {total.normalize():f} %, not 100 %.")
    return problems


@transaction.atomic
def to_planning(actor, work_order):
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    if work_order.status != WorkOrderStatus.DRAFT or not work_order.is_official:
        refuse("Only an official draft goes to planning.")
    set_status(work_order, WorkOrderStatus.PLANNING, actor)
    return work_order


def refresh_snapshot(work_order, actor):
    """Records the credit plan in force (activation, or an audited change of an active plan)."""
    for deliverable in work_order.deliverables.all():
        if not deliverable.is_active:
            DeliverableWeightSnapshot.objects.filter(work_order=work_order, deliverable=deliverable).delete()
            continue
        DeliverableWeightSnapshot.objects.update_or_create(
            work_order=work_order, deliverable=deliverable,
            defaults={
                "budget_tier": work_order.budget_tier, "weight": deliverable.weight, "snapshotted_by": actor,
                "allocated_points": formulas.allocated_points(work_order.budget_tier, deliverable.weight),
            },
        )


@transaction.atomic
def activate(actor, work_order):
    """Planning → active once the credit plan is valid; the budget and the weights freeze (§7.2)."""
    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    if work_order.status not in (WorkOrderStatus.DRAFT, WorkOrderStatus.PLANNING) or not work_order.is_official:
        refuse("Only an official Work Order in draft or planning is activated.")
    problems = credit_plan_problems(work_order, active_deliverables(work_order))
    if problems:
        refuse(" ".join(problems))
    set_status(work_order, WorkOrderStatus.ACTIVE, actor)
    refresh_snapshot(work_order, actor)
    notify.work_order_event("wo_activated", work_order, notify.work_order_members(work_order), actor)
    return work_order


def follow_deliverables(work_order, actor=None):
    """In progress once a Deliverable starts; completed once every active Deliverable is validated (§17.2,
    plan decision: validated or cancelled, at least one validated)."""
    work_order.refresh_from_db()
    if work_order.status in (WorkOrderStatus.CANCELLED, WorkOrderStatus.DRAFT, WorkOrderStatus.PLANNING):
        return
    active = [deliverable for deliverable in work_order.deliverables.all() if deliverable.is_active]
    if active and all(deliverable.status == DeliverableStatus.VALIDATED for deliverable in active):
        if work_order.status != WorkOrderStatus.COMPLETED:
            set_status(work_order, WorkOrderStatus.COMPLETED, actor, "every Deliverable validated")
            notify.work_order_event("wo_completed", work_order, notify.heads_of(work_order.department), actor)
        return
    started = any(deliverable.status != DeliverableStatus.READY and deliverable.status != DeliverableStatus.DRAFT
                  for deliverable in active)
    if work_order.status == WorkOrderStatus.COMPLETED:
        set_status(work_order, WorkOrderStatus.IN_PROGRESS, actor, "a Deliverable was reopened")
    elif work_order.status == WorkOrderStatus.ACTIVE and started:
        set_status(work_order, WorkOrderStatus.IN_PROGRESS, actor)


@transaction.atomic
def cancel(actor, work_order, reason):
    """Cancels the Work Order and its Deliverables not validated yet (their weights are not redistributed:
    the whole package stops). A validated Deliverable keeps its result."""
    from . import deliverables as deliverable_service

    work_order = WorkOrder.objects.select_for_update().get(pk=work_order.pk)
    if work_order.status in (WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED):
        refuse("This Work Order is already completed or cancelled.")
    if not work_order.is_official:
        refuse("A proposal is rejected, not cancelled.")
    reason = require_reason(reason, "Give the reason for the cancellation.")
    recipients = notify.work_order_members(work_order)
    for deliverable in work_order.deliverables.select_for_update():
        if deliverable.is_active and deliverable.status != DeliverableStatus.VALIDATED:
            deliverable_service.close(actor, deliverable, reason, share_weight=False)
    set_status(work_order, WorkOrderStatus.CANCELLED, actor, reason)
    notify.work_order_event("wo_cancelled", work_order, recipients, actor)
    return work_order


def current_formula():
    formula = FormulaVersion.objects.filter(is_current=True).first()
    if formula is None:
        refuse("No scoring formula is configured yet: run the seed_task_management command.")
    return formula


@transaction.atomic
def set_rubric(actor, work_order, ratings):
    """The Head's four ratings; the system suggests the budget, the Head confirms it (§7.1). Stored with the
    confidential scoring data."""
    formula = current_formula()
    score = formulas.budget_score(
        ratings["effort"], ratings["complexity"], ratings["uncertainty"], ratings["responsibility"], formula
    )
    tier = formulas.suggested_tier(score)
    rubric, _ = WoBudgetRubric.objects.update_or_create(
        work_order=work_order,
        defaults={
            "effort_rating": ratings["effort"], "complexity_rating": ratings["complexity"],
            "uncertainty_rating": ratings["uncertainty"], "responsibility_rating": ratings["responsibility"],
            "budget_score": score, "suggested_tier": tier, "entered_by": actor,
        },
    )
    scoring_audit("budget_rubric_set", "work_order", work_order.pk, actor, new={**ratings, "score": score,
                                                                              "suggested_tier": tier})
    return rubric
