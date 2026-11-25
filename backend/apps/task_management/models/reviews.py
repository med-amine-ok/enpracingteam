"""Submissions and their single review (specification §12), and the credit set frozen at the first complete
submission (§4.5, §9.8)."""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from .choices import EvidenceType, ReviewDecision, RevisionSeverity
from .deliverables import Deliverable

MEMBER = settings.AUTH_USER_MODEL


class Submission(models.Model):
    """One submission round. `is_complete` is decided by the backend (evidence given and the work declared
    complete), never sent by the client (§12.1)."""

    deliverable = models.ForeignKey(Deliverable, on_delete=models.PROTECT, related_name="submissions")
    submission_number = models.PositiveSmallIntegerField()
    is_complete = models.BooleanField(default=False)
    submitted_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    submitted_at = models.DateTimeField(auto_now_add=True)
    submission_note = models.TextField(blank=True)

    class Meta:
        verbose_name = _("submission")
        verbose_name_plural = _("submissions")
        ordering = ["deliverable_id", "submission_number"]
        constraints = [
            models.UniqueConstraint(fields=["deliverable", "submission_number"], name="uq_sub_del_num"),
            models.CheckConstraint(condition=Q(submission_number__gte=1), name="ck_sub_number"),
        ]


class SubmissionEvidence(models.Model):
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="evidence")
    url = models.URLField(max_length=500)
    label = models.CharField(max_length=255, blank=True)
    link_type = models.CharField(max_length=10, choices=EvidenceType.choices, default=EvidenceType.DRIVE)
    uploaded_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("evidence")
        verbose_name_plural = _("evidence")
        ordering = ["submission_id", "id"]


class Review(models.Model):
    """Exactly one review per submission (§12.2)."""

    submission = models.OneToOneField(Submission, on_delete=models.PROTECT, related_name="review")
    reviewer = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decision = models.CharField(max_length=20, choices=ReviewDecision.choices)
    reviewed_at = models.DateTimeField(auto_now_add=True)
    review_note = models.TextField(blank=True)

    class Meta:
        verbose_name = _("review")
        verbose_name_plural = _("reviews")
        ordering = ["-reviewed_at", "-id"]
        constraints = [models.CheckConstraint(condition=Q(decision__in=ReviewDecision.values), name="ck_review_decision")]


class ReviewRevisionRequest(models.Model):
    """One severity and one attribution decision for the revision round as a whole (§8.2, §12.3)."""

    review = models.OneToOneField(Review, on_delete=models.CASCADE, related_name="revision")
    severity = models.CharField(max_length=10, choices=RevisionSeverity.choices)
    issues_summary = models.TextField()
    is_attributable = models.BooleanField(default=True)
    attribution_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("revision request")
        verbose_name_plural = _("revision requests")
        constraints = [
            models.CheckConstraint(condition=Q(severity__in=RevisionSeverity.values), name="ck_rrr_severity"),
            models.CheckConstraint(
                condition=Q(is_attributable=True) | ~Q(attribution_reason=""), name="ck_rrr_attribution"
            ),
        ]


class FirstCompleteSubmissionSnapshot(models.Model):
    """Timestamp A of the first complete submission, and the assigned members frozen with it (§4.5, §9.8)."""

    deliverable = models.OneToOneField(Deliverable, on_delete=models.PROTECT, related_name="first_complete")
    submission = models.OneToOneField(Submission, on_delete=models.PROTECT, related_name="+")
    first_submitted_at = models.DateTimeField()
    member_count = models.PositiveSmallIntegerField()
    snapshotted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("first complete submission")
        verbose_name_plural = _("first complete submissions")


class FcssMember(models.Model):
    snapshot = models.ForeignKey(FirstCompleteSubmissionSnapshot, on_delete=models.CASCADE, related_name="members")
    member = models.ForeignKey(MEMBER, on_delete=models.PROTECT, related_name="+")

    class Meta:
        verbose_name = _("frozen credit member")
        verbose_name_plural = _("frozen credit members")
        constraints = [models.UniqueConstraint(fields=["snapshot", "member"], name="uq_fcssm_snap_member")]
