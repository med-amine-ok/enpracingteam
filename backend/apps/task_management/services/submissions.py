"""Submissions and reviews (specification §12), the first complete submission and the frozen credit set (§4.5,
§9.8)."""

from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import PermissionDenied

from ..models import (
    Action, Assignment, DeliverableStatus, EntityType, FcssMember, FirstCompleteSubmissionSnapshot, QualityDataStatus,
    QualityInput, Review, ReviewDecision, ReviewRevisionRequest, Submission, SubmissionEvidence,
)
from . import dependencies, notify, work_orders
from .activity import log, scoring_audit
from .common import refuse
from .deliverables import locked, set_status

SUBMITTABLE = (DeliverableStatus.IN_PROGRESS, DeliverableStatus.REVISION_REQUESTED)


def missing_for_completeness(evidence, declares_complete):
    """What the backend requires of a complete submission (§12.1): evidence, and the work declared complete
    against the acceptance criteria."""
    missing = []
    if not evidence:
        missing.append("evidence")
    if not declares_complete:
        missing.append("declared complete")
    return missing


@transaction.atomic
def submit(actor, deliverable, note="", evidence=(), declares_complete=True):
    """An assigned member submits. An incomplete submission is recorded and reviewed, but it does not establish
    A (§4.3 rule 5). The first complete one freezes the credit set."""
    deliverable = locked(deliverable)
    if not Assignment.objects.filter(deliverable=deliverable, member=actor, is_active=True).exists():
        raise PermissionDenied("Only the members assigned to this Deliverable submit it.")
    if deliverable.status not in SUBMITTABLE:
        refuse("Submit while the work is in progress or after a revision request.")
    last = deliverable.submissions.order_by("-submission_number").first()
    submission = Submission.objects.create(
        deliverable=deliverable, submission_number=(last.submission_number + 1) if last else 1,
        is_complete=not missing_for_completeness(evidence, declares_complete), submitted_by=actor,
        submission_note=note or "",
    )
    SubmissionEvidence.objects.bulk_create(
        SubmissionEvidence(submission=submission, uploaded_by=actor, **item) for item in evidence
    )
    first = False
    if submission.is_complete and not FirstCompleteSubmissionSnapshot.objects.filter(deliverable=deliverable).exists():
        freeze(deliverable, submission)
        first = True
    set_status(actor, deliverable, DeliverableStatus.SUBMITTED, action=Action.SUBMITTED)
    log(EntityType.SUBMISSION, submission.pk, Action.SUBMITTED, actor, new={
        "number": submission.submission_number, "complete": submission.is_complete, "first_complete": first,
    }, reason=note, deliverable=deliverable)
    if first:
        dependencies.evaluate_from(deliverable, actor)
    notify.deliverable_event("deliverable_submitted", deliverable, notify.heads_of(deliverable.work_order.department),
                             actor, number=submission.submission_number)
    return submission


def freeze(deliverable, submission):
    members = list(Assignment.objects.filter(deliverable=deliverable, is_active=True).values_list("member_id", flat=True))
    snapshot = FirstCompleteSubmissionSnapshot.objects.create(
        deliverable=deliverable, submission=submission, first_submitted_at=submission.submitted_at,
        member_count=len(members),
    )
    FcssMember.objects.bulk_create(FcssMember(snapshot=snapshot, member_id=member) for member in members)
    return snapshot


def check_reviewer(access, deliverable):
    """A Head of the department (or above it) who did not contribute to the Deliverable (§4.4, §12.4)."""
    if not access.heads(deliverable.work_order.department_id):
        raise PermissionDenied("Only a Head of this department reviews its Deliverables.")
    if Assignment.objects.filter(deliverable=deliverable, member=access.user, is_contributor=True).exists():
        raise PermissionDenied("You contributed to this Deliverable: another Head must review it.")


@transaction.atomic
def review(access, submission, data):
    """Exactly one review per submission: validated, or revision requested with one severity and one attribution
    decision for the round (§12.2–12.3)."""
    actor = access.user
    deliverable = locked(submission.deliverable)
    submission = Submission.objects.select_for_update().get(pk=submission.pk)
    check_reviewer(access, deliverable)
    if Review.objects.filter(submission=submission).exists():
        refuse("This submission already has its review.")
    if deliverable.status != DeliverableStatus.SUBMITTED or deliverable.submissions.filter(
        submission_number__gt=submission.submission_number
    ).exists():
        refuse("Only the latest submission awaiting review is reviewed.")
    decision = data["decision"]
    if data.get("raw_quality") is not None and not access.is_scoring_admin:
        raise PermissionDenied("The quality mark is entered by the club admins.")
    if decision == ReviewDecision.VALIDATED and not submission.is_complete:
        refuse("An incomplete submission cannot be validated: request a revision.", "decision")
    review = Review.objects.create(submission=submission, reviewer=actor, decision=decision,
                                   review_note=data.get("review_note", ""))
    if decision == ReviewDecision.REVISION_REQUESTED:
        attributable = data.get("is_attributable", True)
        reason = (data.get("attribution_reason") or "").strip()
        if not data.get("severity") or not (data.get("issues_summary") or "").strip():
            refuse("A revision request states its issues and their severity.", "issues_summary")
        if not attributable and not reason:
            refuse("Say why the revision is not attributable to the assigned members.", "attribution_reason")
        ReviewRevisionRequest.objects.create(
            review=review, severity=data["severity"], issues_summary=data["issues_summary"].strip(),
            is_attributable=attributable, attribution_reason=reason,
        )
        set_status(actor, deliverable, DeliverableStatus.REVISION_REQUESTED, action=Action.REVISION_REQUESTED)
        log(EntityType.REVIEW, review.pk, Action.REVISION_REQUESTED, actor,
            new={"severity": data["severity"], "attributable": attributable}, reason=data["issues_summary"],
            deliverable=deliverable)
        notify.deliverable_event("deliverable_revision_requested", deliverable, notify.assignees(deliverable), actor)
        return review
    set_status(actor, deliverable, DeliverableStatus.VALIDATED, action=Action.VALIDATED)
    log(EntityType.REVIEW, review.pk, Action.VALIDATED, actor, reason=review.review_note, deliverable=deliverable)
    if data.get("raw_quality") is not None:
        set_quality(actor, deliverable, data["raw_quality"], QualityDataStatus.COMPLETE, "")
    dependencies.evaluate_from(deliverable, actor)
    work_orders.follow_deliverables(deliverable.work_order, actor)
    notify.deliverable_event("deliverable_validated", deliverable, notify.assignees(deliverable), actor)
    return review


def set_quality(actor, deliverable, raw_quality, status, note, reason=""):
    """The Head's raw quality mark, 0–5, kept with the confidential data and audited (guide §13)."""
    raw_quality = None if raw_quality is None else Decimal(str(raw_quality))
    if raw_quality is not None and not Decimal("0") <= raw_quality <= Decimal("5"):
        refuse("The quality mark goes from 0 to 5.", "raw_quality")
    if raw_quality is not None and raw_quality != raw_quality.quantize(Decimal("0.1")):
        refuse("The quality mark has one decimal at most.", "raw_quality")
    if status in (QualityDataStatus.COMPLETE, QualityDataStatus.SUBMITTED) and raw_quality is None:
        refuse("Give the quality mark first.", "raw_quality")
    item = QualityInput.objects.select_for_update().filter(deliverable=deliverable).first()
    old = {"raw_quality": item.raw_quality, "data_status": item.data_status, "note": item.note} if item else {}
    if item is None:
        item = QualityInput(deliverable=deliverable, entered_by=actor)
    item.raw_quality = raw_quality
    item.data_status = status
    item.note = note or ""
    item.entered_by = actor
    item.save()
    scoring_audit("quality_input_changed", "deliverable", deliverable.pk, actor, old=old,
                  new={"raw_quality": raw_quality, "data_status": status, "note": item.note}, reason=reason)
    return item
