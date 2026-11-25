"""Dependencies between exact Deliverables (specification §10) and deadline relief (§9.3–9.5)."""

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied

from ..models import (
    Action, Deliverable, DeliverableStatus, DependencyLink, DependencyProposal, DependencyState,
    EntityType, FirstCompleteSubmissionSnapshot, LinkStatus, LinkType, ManualDependencyReleaseAudit, ProposalStatus, ReleaseCondition, ReliefInterval,
    ReliefStatus,
)
from . import formulas, notify
from .activity import log
from .common import club_day, lock_dependency_graph, now, refuse, require_reason

# --- The graph ---


def would_cycle(prerequisite_id, dependent_id):
    """Whether prerequisite → dependent closes a cycle, i.e. a path dependent ⇝ prerequisite already exists
    among the active links (§10.8). Called under lock_dependency_graph()."""
    seen = set()
    frontier = [dependent_id]
    while frontier:
        if prerequisite_id in frontier:
            return True
        seen.update(frontier)
        frontier = [
            pk for pk in DependencyLink.objects.filter(
                prerequisite_id__in=frontier, link_status=LinkStatus.ACTIVE
            ).values_list("dependent_id", flat=True) if pk not in seen
        ]
    return False


def check_link(prerequisite, dependent, link_type, condition, milestone):
    if prerequisite.pk == dependent.pk:
        refuse("A Deliverable cannot depend on itself.")
    for deliverable in (prerequisite, dependent):
        if not deliverable.is_official or deliverable.status == DeliverableStatus.CANCELLED:
            refuse(f"{deliverable.code or deliverable.title} is not an active official Deliverable.")
    if link_type == LinkType.BLOCKS and condition == ReleaseCondition.MILESTONE_COMPLETED:
        if milestone is None:
            refuse("Choose the Milestone of the prerequisite that releases the dependency.", "release_milestone")
        if milestone.deliverable_id != prerequisite.pk:
            refuse("The Milestone must belong to the prerequisite Deliverable.", "release_milestone")
        if milestone.is_cancelled:
            refuse("This Milestone is cancelled.", "release_milestone")
    if DependencyLink.objects.filter(
        prerequisite=prerequisite, dependent=dependent, link_type=link_type, link_status=LinkStatus.ACTIVE
    ).exists():
        refuse("This dependency already exists.")
    if would_cycle(prerequisite.pk, dependent.pk):
        refuse("This dependency would create a cycle: the prerequisite already depends on this Deliverable.")


def normalised(link_type, condition, milestone):
    """Only `blocks` has a release condition; the others are informational (§10.2)."""
    if link_type != LinkType.BLOCKS:
        return ReleaseCondition.VALIDATED, None
    if condition != ReleaseCondition.MILESTONE_COMPLETED:
        return condition, None
    return condition, milestone


def involved_heads(access, prerequisite, dependent):
    return access.heads_any(prerequisite.work_order.department_id, dependent.work_order.department_id)


@transaction.atomic
def create(actor, prerequisite, dependent, link_type, condition, milestone=None, reason="", *, proposed_by=None):
    """A Head of an involved department creates an active link directly (§10, rule 1)."""
    lock_dependency_graph()
    condition, milestone = normalised(link_type, condition, milestone)
    check_link(prerequisite, dependent, link_type, condition, milestone)
    link = DependencyLink.objects.create(
        prerequisite=prerequisite, dependent=dependent, link_type=link_type, release_condition=condition,
        release_milestone=milestone, reason=reason or "", created_by=proposed_by or actor,
        approved_by=actor, approved_at=now(),
    )
    log(EntityType.DEPENDENCY_LINK, link.pk, Action.CREATED, actor, new={
        "prerequisite": prerequisite.pk, "dependent": dependent.pk, "type": link_type, "condition": condition,
        "milestone": milestone.pk if milestone else None,
    }, reason=reason, deliverable=dependent)
    if link.link_type == LinkType.BLOCKS:
        evaluate(link, actor, announce=False)
        refresh_state(dependent)
        notify.deliverable_event("dependency_added", dependent, notify.assignees(dependent), actor,
                                 prerequisite=prerequisite.title)
    return link


@transaction.atomic
def propose(actor, prerequisite, dependent, link_type, condition, milestone=None, justification=""):
    """A member proposes a link; it is active only once a Head approves it (§10, rule 2)."""
    lock_dependency_graph()
    condition, milestone = normalised(link_type, condition, milestone)
    check_link(prerequisite, dependent, link_type, condition, milestone)
    proposal = DependencyProposal.objects.create(
        proposed_prerequisite=prerequisite, proposed_dependent=dependent, proposed_link_type=link_type,
        proposed_release_condition=condition, proposed_milestone=milestone, justification=justification or "",
        proposed_by=actor,
    )
    heads = notify.heads_of(prerequisite.work_order.department) + notify.heads_of(dependent.work_order.department)
    notify.deliverable_event("dependency_proposed", dependent, heads, actor, prerequisite=prerequisite.title)
    return proposal


@transaction.atomic
def decide(actor, proposal, approve, note=""):
    """One involved Head's approval is enough, even across two departments (§10, rule 4)."""
    proposal = DependencyProposal.objects.select_for_update(of=("self",)).select_related(
        "proposed_prerequisite__work_order", "proposed_dependent__work_order", "proposed_milestone"
    ).get(pk=proposal.pk)
    if proposal.status != ProposalStatus.PENDING_REVIEW:
        refuse("This proposal is not awaiting a decision.")
    if proposal.proposed_by_id == actor.pk:
        raise PermissionDenied("Nobody decides on their own proposal.")
    if approve:
        link = create(
            actor, proposal.proposed_prerequisite, proposal.proposed_dependent, proposal.proposed_link_type,
            proposal.proposed_release_condition, proposal.proposed_milestone, proposal.justification,
            proposed_by=proposal.proposed_by,
        )
        proposal.dependency_link = link
        proposal.status = ProposalStatus.APPROVED
    else:
        note = require_reason(note, "Explain the rejection.")
        proposal.status = ProposalStatus.REJECTED
    proposal.decided_by = actor
    proposal.decided_at = now()
    proposal.decision_note = note or ""
    proposal.save()
    log(EntityType.DEPENDENCY_LINK, proposal.dependency_link_id or 0, Action.APPROVED if approve else Action.REJECTED,
        actor, new={"proposal": proposal.pk}, reason=note, deliverable=proposal.proposed_dependent)
    notify.deliverable_event(
        "dependency_proposal_approved" if approve else "dependency_proposal_rejected", proposal.proposed_dependent,
        [proposal.proposed_by], actor, prerequisite=proposal.proposed_prerequisite.title,
    )
    return proposal


@transaction.atomic
def cancel(actor, link, reason):
    """The Head cancels a link no longer needed; the dependent's state is computed again (§10)."""
    lock_dependency_graph()
    link = DependencyLink.objects.select_for_update().get(pk=link.pk)
    if link.link_status != LinkStatus.ACTIVE:
        refuse("This dependency is already cancelled.")
    reason = require_reason(reason)
    close_link(actor, link, reason)
    return link


def close_link(actor, link, reason):
    link.link_status = LinkStatus.CANCELLED
    link.cancelled_by = actor
    link.cancelled_at = now()
    link.cancel_reason = reason
    link.save()
    log(EntityType.DEPENDENCY_LINK, link.pk, Action.CANCELLED, actor, reason=reason, deliverable=link.dependent)
    refresh_state(link.dependent)


def cancel_links_of(actor, deliverable, reason, *, incoming):
    """A prerequisite cancelled or reopened leaves the active set (guide §9.4); a cancelled dependent too."""
    lock_dependency_graph()
    links = Q(prerequisite=deliverable) | Q(dependent=deliverable) if incoming else Q(prerequisite=deliverable)
    for link in DependencyLink.objects.select_for_update(of=("self",)).filter(links, link_status=LinkStatus.ACTIVE).select_related(
        "dependent"
    ):
        close_link(actor, link, reason)


@transaction.atomic
def manual_release(actor, link, reason):
    """The Head's permanent override when the normal condition is unmet (§10, rule 6). Never revoked."""
    link = DependencyLink.objects.select_for_update(of=("self",)).select_related("dependent").get(pk=link.pk)
    if not link.is_blocking:
        refuse("Only an active blocking dependency is released.")
    if link.released_at:
        refuse("This dependency is already released.")
    reason = require_reason(reason, "Give the reason for the manual release.")
    link.released_at = now()
    link.manually_released = True
    link.manual_release_by = actor
    link.manual_release_at = link.released_at
    link.manual_release_reason = reason
    link.save()
    ManualDependencyReleaseAudit.objects.create(
        dependency_link=link, released_by=actor, reason=reason, unmet_condition=link.release_condition
    )
    log(EntityType.DEPENDENCY_LINK, link.pk, Action.MANUAL_RELEASED, actor, reason=reason, deliverable=link.dependent)
    refresh_state(link.dependent)
    notify.deliverable_event("dependency_released", link.dependent, notify.assignees(link.dependent), actor,
                             manual=True)
    return link


# --- Release conditions and the dependency state (§10.3–10.5) ---


def condition_met(link):
    prerequisite = link.prerequisite
    if link.release_condition == ReleaseCondition.SUBMITTED:
        return FirstCompleteSubmissionSnapshot.objects.filter(deliverable=prerequisite).exists()
    if link.release_condition == ReleaseCondition.VALIDATED:
        return prerequisite.status == DeliverableStatus.VALIDATED
    return bool(link.release_milestone and link.release_milestone.is_completed)


def evaluate(link, actor=None, *, announce=True):
    """Releases the link the first time its condition is met; the release then stays (members never declare it,
    the backend evaluates it: §10, rule 5)."""
    if not link.is_blocking or link.released_at:
        return False
    if not condition_met(link):
        return False
    link.released_at = now()
    link.save(update_fields=["released_at", "updated_at"])
    log(EntityType.DEPENDENCY_LINK, link.pk, Action.RELEASED, actor, new={"condition": link.release_condition},
        deliverable=link.dependent)
    if announce:
        notify.deliverable_event("dependency_released", link.dependent, notify.assignees(link.dependent), actor,
                                 prerequisite=link.prerequisite.title)
    return True


def evaluate_from(prerequisite, actor=None):
    """Something happened to a prerequisite (submitted, validated, a Milestone completed)."""
    links = DependencyLink.objects.select_for_update(of=("self",)).filter(
        prerequisite=prerequisite, link_type=LinkType.BLOCKS, link_status=LinkStatus.ACTIVE, released_at__isnull=True
    ).select_related("prerequisite", "dependent", "release_milestone")
    for link in links:
        if evaluate(link, actor):
            refresh_state(link.dependent)


def refresh_state(deliverable):
    """AND of every active blocking prerequisite (§10.4)."""
    links = list(DependencyLink.objects.filter(
        dependent=deliverable, link_type=LinkType.BLOCKS, link_status=LinkStatus.ACTIVE
    ).values_list("released_at", flat=True))
    if not links:
        state = DependencyState.NONE
    elif all(links):
        state = DependencyState.RELEASED
    else:
        state = DependencyState.WAITING
    if deliverable.dep_state != state:
        Deliverable.objects.filter(pk=deliverable.pk).update(dep_state=state, updated_at=now())
        deliverable.dep_state = state
    return state


# --- Deadline relief (§9) ---


def recompute_relief(deliverable):
    """X = the days of the union of the approved intervals, dependency and blocker alike; D_e = D + X (§9.4)."""
    periods = ReliefInterval.objects.filter(deliverable=deliverable, status=ReliefStatus.APPROVED).values_list(
        "approved_start", "approved_end"
    )
    days = formulas.union_days(list(periods))
    effective = formulas.effective_deadline(deliverable.original_deadline, days)
    if deliverable.relief_days != days or deliverable.effective_deadline != effective:
        Deliverable.objects.filter(pk=deliverable.pk).update(relief_days=days, effective_deadline=effective)
        deliverable.relief_days = days
        deliverable.effective_deadline = effective
    return days


@transaction.atomic
def claim(actor, deliverable, data):
    """The dependent team reports the period its work was genuinely prevented (§10 relief workflow)."""
    link = data.get("dependency_link")
    blocker = data.get("blocker")
    if not link and not blocker:
        refuse("Link the claim to the blocking dependency or to the blocker that caused the delay.")
    if link and (link.dependent_id != deliverable.pk or link.link_type != LinkType.BLOCKS):
        refuse("Relief comes only from a blocking dependency of this Deliverable (§9.2).", "dependency_link")
    if blocker and blocker.deliverable_id != deliverable.pk:
        refuse("This blocker concerns another Deliverable.", "blocker")
    if link and blocker is None and link.link_status != LinkStatus.ACTIVE and not link.released_at:
        refuse("This dependency was cancelled before it was released.", "dependency_link")
    if data["waiting_started_at"] < data["needed_at"]:
        refuse("The work cannot be prevented before the prerequisite was needed.", "waiting_started_at")
    interval = ReliefInterval.objects.create(deliverable=deliverable, claimed_by=actor, **data)
    log(EntityType.RELIEF, interval.pk, Action.RELIEF_CLAIMED, actor, new={
        "needed_at": interval.needed_at, "waiting_started_at": interval.waiting_started_at,
        "released_at": interval.released_at,
    }, reason=interval.impact_description, deliverable=deliverable)
    notify.deliverable_event("relief_claimed", deliverable, notify.heads_of(deliverable.work_order.department), actor)
    return interval


@transaction.atomic
def approve_relief(actor, interval, start, end, note=""):
    """All or nothing, whole calendar days, verified by the Head (§9.5): the four conditions must hold."""
    interval = ReliefInterval.objects.select_for_update(of=("self",)).select_related(
        "deliverable__work_order", "dependency_link", "blocker"
    ).get(pk=interval.pk)
    if interval.status != ReliefStatus.CLAIMED:
        refuse("This claim is already decided.")
    if not (interval.team_ready and interval.directly_prevented):
        refuse("Relief is granted only when the team had done the work it could and the missing prerequisite "
               "directly prevented progress; otherwise reject the claim.")
    if interval.blocker_id:
        validation = getattr(interval.blocker, "validation", None)
        if validation is None or not validation.impact_confirmed:
            refuse("Validate the blocker's impact on delivery first.")
    if interval.dependency_link_id and interval.dependency_link.released_at:
        released_on = club_day(interval.dependency_link.released_at)
        if end > released_on:
            refuse("The relief cannot run after the prerequisite was released.", "approved_end")
    if start >= end:
        refuse("The relieved period ends after it starts.", "approved_end")
    if start < interval.needed_at:
        refuse("The relieved period starts once the prerequisite was needed.", "approved_start")
    interval.status = ReliefStatus.APPROVED
    interval.approved_start = start
    interval.approved_end = end
    interval.approved_days = (end - start).days
    interval.decided_by = actor
    interval.decided_at = now()
    interval.decision_note = note or ""
    interval.save()
    deliverable = interval.deliverable
    before = deliverable.effective_deadline
    recompute_relief(deliverable)
    log(EntityType.RELIEF, interval.pk, Action.RELIEF_APPROVED, actor,
        old={"effective_deadline": before},
        new={"approved_start": start, "approved_end": end, "days": interval.approved_days,
             "effective_deadline": deliverable.effective_deadline},
        reason=note, deliverable=deliverable)
    notify.deliverable_event("relief_approved", deliverable, notify.assignees(deliverable), actor,
                             effective_deadline=str(deliverable.effective_deadline))
    return interval


@transaction.atomic
def reject_relief(actor, interval, note):
    interval = ReliefInterval.objects.select_for_update(of=("self",)).select_related("deliverable__work_order").get(pk=interval.pk)
    if interval.status != ReliefStatus.CLAIMED:
        refuse("This claim is already decided.")
    note = require_reason(note, "Explain why no relief is granted.")
    interval.status = ReliefStatus.REJECTED
    interval.decided_by = actor
    interval.decided_at = now()
    interval.decision_note = note
    interval.save()
    log(EntityType.RELIEF, interval.pk, Action.RELIEF_REJECTED, actor, reason=note, deliverable=interval.deliverable)
    notify.deliverable_event("relief_rejected", interval.deliverable, [interval.claimed_by], actor)
    return interval
