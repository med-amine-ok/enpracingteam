"""Dependencies between exact Deliverables (specification §10) and deadline relief (§9)."""

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils.translation import gettext_lazy as _

from .choices import LinkStatus, LinkType, ProposalStatus, ReleaseCondition, ReliefStatus
from .deliverables import Deliverable, Milestone

MEMBER = settings.AUTH_USER_MODEL


class DependencyLink(models.Model):
    """Prerequisite → dependent. Only `blocks` gates readiness and may justify relief (§10.2).

    `released_at` is set by the backend the first time the release condition is met, or by the Head's permanent
    manual release (§10, rule 6); the release then stays. A prerequisite cancelled or reopened cancels its links
    (guide §9.4)."""

    prerequisite = models.ForeignKey(Deliverable, on_delete=models.PROTECT, related_name="dependents_links")
    dependent = models.ForeignKey(Deliverable, on_delete=models.PROTECT, related_name="prerequisite_links")
    link_type = models.CharField(max_length=12, choices=LinkType.choices, default=LinkType.BLOCKS)
    release_condition = models.CharField(
        max_length=20, choices=ReleaseCondition.choices, default=ReleaseCondition.VALIDATED
    )
    release_milestone = models.ForeignKey(
        Milestone, null=True, blank=True, on_delete=models.PROTECT, related_name="dependency_links"
    )
    link_status = models.CharField(max_length=10, choices=LinkStatus.choices, default=LinkStatus.ACTIVE)
    released_at = models.DateTimeField(null=True, blank=True)
    manually_released = models.BooleanField(default=False)
    manual_release_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    manual_release_at = models.DateTimeField(null=True, blank=True)
    manual_release_reason = models.TextField(blank=True)
    reason = models.TextField(blank=True)
    created_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("dependency")
        verbose_name_plural = _("dependencies")
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=~Q(prerequisite=F("dependent")), name="ck_dep_no_self"),
            models.CheckConstraint(
                condition=~Q(release_condition=ReleaseCondition.MILESTONE_COMPLETED)
                | Q(release_milestone__isnull=False),
                name="ck_dep_milestone_required",
            ),
            models.CheckConstraint(
                condition=Q(manually_released=False)
                | (Q(manual_release_by__isnull=False) & ~Q(manual_release_reason="")),
                name="ck_dep_manual_release",
            ),
            models.UniqueConstraint(
                fields=["prerequisite", "dependent", "link_type"], condition=Q(link_status=LinkStatus.ACTIVE),
                name="uq_dep_prereq_dep_type_act",
            ),
        ]

    def __str__(self):
        return f"{self.prerequisite_id} → {self.dependent_id} ({self.link_type})"

    @property
    def is_blocking(self):
        return self.link_status == LinkStatus.ACTIVE and self.link_type == LinkType.BLOCKS


class DependencyProposal(models.Model):
    """A member's proposed link; it becomes an active link only once a Head of an involved department approves
    it (§10, rules 2–4)."""

    dependency_link = models.ForeignKey(
        DependencyLink, null=True, blank=True, on_delete=models.SET_NULL, related_name="proposals"
    )
    proposed_prerequisite = models.ForeignKey(Deliverable, on_delete=models.CASCADE, related_name="+")
    proposed_dependent = models.ForeignKey(Deliverable, on_delete=models.CASCADE, related_name="+")
    proposed_link_type = models.CharField(max_length=12, choices=LinkType.choices, default=LinkType.BLOCKS)
    proposed_release_condition = models.CharField(
        max_length=20, choices=ReleaseCondition.choices, default=ReleaseCondition.VALIDATED
    )
    proposed_milestone = models.ForeignKey(
        Milestone, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    justification = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=ProposalStatus.choices, default=ProposalStatus.PENDING_REVIEW)
    proposed_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("dependency proposal")
        verbose_name_plural = _("dependency proposals")
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(proposed_prerequisite=F("proposed_dependent")), name="ck_dlp_no_self"
            ),
        ]


class ManualDependencyReleaseAudit(models.Model):
    dependency_link = models.ForeignKey(DependencyLink, on_delete=models.PROTECT, related_name="manual_releases")
    released_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    released_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField()
    unmet_condition = models.CharField(max_length=20, choices=ReleaseCondition.choices)

    class Meta:
        verbose_name = _("manual release")
        verbose_name_plural = _("manual releases")
        ordering = ["-released_at", "-id"]


class ReliefInterval(models.Model):
    """A period during which the dependent work was genuinely prevented (§9.3–9.5), from a blocking dependency
    or a blocker. Claimed by the team, approved or rejected by the Head: all or nothing, whole calendar days.

    The approved period is [approved_start, approved_end) — needed on 10 June, released on 16 June: 6 days.
    Overlapping approved periods of one Deliverable are allowed and counted once (the union, §9.4): the schema's
    exclusion constraint would have refused case D of §9.10."""

    deliverable = models.ForeignKey(Deliverable, on_delete=models.PROTECT, related_name="relief_intervals")
    dependency_link = models.ForeignKey(
        DependencyLink, null=True, blank=True, on_delete=models.PROTECT, related_name="relief_intervals"
    )
    blocker = models.ForeignKey(
        "task_management.Blocker", null=True, blank=True, on_delete=models.PROTECT, related_name="relief_intervals"
    )
    needed_at = models.DateField(_("needed on"))
    waiting_started_at = models.DateField(_("work prevented from"))
    released_at = models.DateField(_("released on"), null=True, blank=True)
    impact_description = models.TextField(_("impact"))
    team_ready = models.BooleanField(_("the team had done the work it could do before"), default=False)
    directly_prevented = models.BooleanField(_("the missing prerequisite prevented progress"), default=False)
    status = models.CharField(max_length=10, choices=ReliefStatus.choices, default=ReliefStatus.CLAIMED)
    claimed_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    claimed_at = models.DateTimeField(auto_now_add=True)
    approved_start = models.DateField(null=True, blank=True)
    approved_end = models.DateField(null=True, blank=True)
    approved_days = models.PositiveIntegerField(default=0)
    decided_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)

    class Meta:
        verbose_name = _("deadline relief")
        verbose_name_plural = _("deadline reliefs")
        ordering = ["deliverable_id", "needed_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(dependency_link__isnull=False) | Q(blocker__isnull=False), name="ck_relief_source"
            ),
            models.CheckConstraint(
                condition=~Q(status=ReliefStatus.APPROVED)
                | Q(approved_start__isnull=False, approved_end__isnull=False, approved_start__lt=F("approved_end")),
                name="ck_relief_approved_period",
            ),
            models.CheckConstraint(
                condition=Q(released_at__isnull=True) | Q(released_at__gte=F("waiting_started_at")),
                name="ck_relief_dates",
            ),
        ]
