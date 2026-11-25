"""Deliverables, their Milestones and assignments (specification §4–5)."""

from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils.translation import gettext_lazy as _

from .choices import (
    AssignmentRole, DeliverableStatus, DependencyState, ExecutionState, NOT_OFFICIAL, ProposalStatus,
)
from .hierarchy import WorkOrder

MEMBER = settings.AUTH_USER_MODEL


class Deliverable(models.Model):
    """The assigned, submitted, reviewed and scored unit (§4). Three independent dimensions: the workflow
    `status`, the computed dependency state `dep_state` and the blockers' `execution_state` (§10.5)."""

    code = models.CharField(_("code"), max_length=100, unique=True, null=True, blank=True)
    work_order = models.ForeignKey(
        WorkOrder, on_delete=models.PROTECT, related_name="deliverables", verbose_name=_("work order")
    )
    title = models.CharField(_("title"), max_length=255)
    description = models.TextField(_("description"), blank=True)
    acceptance_criteria = models.TextField(_("acceptance criteria"), blank=True)
    # Share of the Work Order's budget, in percent (§7.3). Confidential: only Heads and the scoring admins see it.
    weight = models.DecimalField(_("weight (%)"), max_digits=6, decimal_places=3, default=Decimal("0"))
    status = models.CharField(
        _("status"), max_length=20, choices=DeliverableStatus.choices, default=DeliverableStatus.DRAFT
    )
    dep_state = models.CharField(
        _("dependency state"), max_length=30, choices=DependencyState.choices, default=DependencyState.NONE
    )
    execution_state = models.CharField(
        _("execution state"), max_length=20, choices=ExecutionState.choices, default=ExecutionState.NORMAL
    )
    # The team's own estimate, 0–100 (§5.3); never derived from the Milestones.
    progress = models.PositiveSmallIntegerField(_("progress (%)"), default=0)
    progress_updated_at = models.DateTimeField(_("progress updated at"), null=True, blank=True)
    start_date = models.DateField(_("start date"), null=True, blank=True)
    original_deadline = models.DateField(_("original deadline"), null=True, blank=True)
    # D + X: the original deadline moved by the approved relief (§9.4). Kept up to date by the backend only.
    effective_deadline = models.DateField(_("effective deadline"), null=True, blank=True)
    relief_days = models.PositiveIntegerField(_("approved relief (days)"), default=0)
    proposed_by = models.ForeignKey(
        MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="proposed_deliverables",
        verbose_name=_("proposed by"),
    )
    proposal_status = models.CharField(
        _("proposal status"), max_length=20, choices=ProposalStatus.choices, null=True, blank=True
    )
    proposal_submitted_at = models.DateTimeField(_("proposal submitted at"), null=True, blank=True)
    proposal_decided_at = models.DateTimeField(_("proposal decided at"), null=True, blank=True)
    proposal_decided_by = models.ForeignKey(
        MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name=_("decided by")
    )
    proposal_note = models.TextField(_("decision note"), blank=True)
    created_by = models.ForeignKey(
        MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name=_("created by")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("deliverable")
        verbose_name_plural = _("deliverables")
        ordering = ["work_order_id", "id"]
        indexes = [
            models.Index(fields=["status"], name="idx_del_status"),
            models.Index(fields=["dep_state"], name="idx_del_dep_state"),
            models.Index(fields=["original_deadline"], name="idx_del_deadline"),
            models.Index(fields=["proposal_status"], name="idx_del_proposal_status"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(weight__gte=0, weight__lte=100), name="ck_del_weight"),
            models.CheckConstraint(condition=Q(progress__lte=100), name="ck_del_progress"),
            models.CheckConstraint(condition=Q(status__in=DeliverableStatus.values), name="ck_del_status"),
            models.CheckConstraint(condition=Q(dep_state__in=DependencyState.values), name="ck_del_dep_state"),
            models.CheckConstraint(
                condition=Q(execution_state__in=ExecutionState.values), name="ck_del_execution_state"
            ),
            models.CheckConstraint(
                condition=Q(original_deadline__isnull=True) | Q(start_date__isnull=True)
                | Q(original_deadline__gte=F("start_date")),
                name="ck_del_dates",
            ),
            models.CheckConstraint(
                condition=Q(status=DeliverableStatus.DRAFT) | Q(status=DeliverableStatus.CANCELLED)
                | Q(proposal_status__isnull=True) | Q(proposal_status=ProposalStatus.APPROVED),
                name="ck_del_official_before_ready",
            ),
        ]

    def __str__(self):
        return f"{self.code} {self.title}" if self.code else self.title

    @property
    def is_official(self):
        return self.proposal_status not in NOT_OFFICIAL

    @property
    def is_active(self):
        return self.status != DeliverableStatus.CANCELLED and self.is_official


class DeliverableProgressLog(models.Model):
    deliverable = models.ForeignKey(Deliverable, on_delete=models.CASCADE, related_name="progress_log")
    progress_pct = models.PositiveSmallIntegerField()
    note = models.TextField(blank=True)
    recorded_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("progress update")
        verbose_name_plural = _("progress updates")
        ordering = ["-recorded_at", "-id"]
        constraints = [models.CheckConstraint(condition=Q(progress_pct__lte=100), name="ck_dpl_progress")]


class DeliverableWeightSnapshot(models.Model):
    """The credit plan as it was when its Work Order became active (§7.2)."""

    work_order = models.ForeignKey(WorkOrder, on_delete=models.CASCADE, related_name="weight_snapshots")
    deliverable = models.ForeignKey(Deliverable, on_delete=models.CASCADE, related_name="weight_snapshots")
    budget_tier = models.PositiveSmallIntegerField()
    weight = models.DecimalField(max_digits=6, decimal_places=3)
    allocated_points = models.DecimalField(max_digits=8, decimal_places=4)
    snapshotted_at = models.DateTimeField(auto_now_add=True)
    snapshotted_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        verbose_name = _("credit plan snapshot")
        verbose_name_plural = _("credit plan snapshots")
        constraints = [models.UniqueConstraint(fields=["work_order", "deliverable"], name="uq_dws_wo_del")]


class DeliverableProposal(models.Model):
    """What a member proposed, kept unchanged whatever the Head edits before deciding (§4.2, guide §15.6)."""

    deliverable = models.ForeignKey(Deliverable, on_delete=models.CASCADE, related_name="proposals")
    proposed_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=20, choices=ProposalStatus.choices, default=ProposalStatus.PENDING_REVIEW)
    proposed_title = models.CharField(max_length=255)
    proposed_desc = models.TextField(blank=True)
    proposed_criteria = models.TextField(blank=True)
    proposed_deadline = models.DateField(null=True, blank=True)
    justification = models.TextField(blank=True)
    decided_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("deliverable proposal")
        verbose_name_plural = _("deliverable proposals")
        ordering = ["-created_at", "-id"]


class Milestone(models.Model):
    """An atomic, binary checkpoint of one Deliverable (§5): completed or not, no percentage, weight, points or
    assignee. Never deleted once a dependency refers to it."""

    code = models.CharField(_("code"), max_length=100, unique=True, null=True, blank=True)
    deliverable = models.ForeignKey(
        Deliverable, on_delete=models.CASCADE, related_name="milestones", verbose_name=_("deliverable")
    )
    title = models.CharField(_("title"), max_length=255)
    description = models.TextField(_("description"), blank=True)
    is_completed = models.BooleanField(_("completed"), default=False)
    completed_at = models.DateTimeField(_("completed at"), null=True, blank=True)
    completed_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_cancelled = models.BooleanField(_("cancelled"), default=False)
    cancelled_at = models.DateTimeField(_("cancelled at"), null=True, blank=True)
    cancelled_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("milestone")
        verbose_name_plural = _("milestones")
        ordering = ["deliverable_id", "created_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(is_completed=True, is_cancelled=True), name="ck_ms_no_complete_and_cancel"
            ),
        ]

    def __str__(self):
        return self.title


class MilestoneHistory(models.Model):
    milestone = models.ForeignKey(Milestone, on_delete=models.CASCADE, related_name="history")
    field_changed = models.CharField(max_length=50)
    old_value = models.TextField(blank=True)
    new_value = models.TextField(blank=True)
    changed_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    changed_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField(blank=True)

    class Meta:
        verbose_name = _("milestone change")
        verbose_name_plural = _("milestone changes")
        ordering = ["-changed_at", "-id"]


class Assignment(models.Model):
    """A member assigned to a Deliverable. `is_contributor` stays true after an unassignment: a Head who
    contributed may not review the Deliverable (§4.4, §12.4)."""

    deliverable = models.ForeignKey(Deliverable, on_delete=models.CASCADE, related_name="assignments")
    member = models.ForeignKey(MEMBER, on_delete=models.PROTECT, related_name="work_assignments")
    role = models.CharField(max_length=10, choices=AssignmentRole.choices, default=AssignmentRole.MEMBER)
    is_active = models.BooleanField(default=True)
    is_contributor = models.BooleanField(default=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    unassigned_at = models.DateTimeField(null=True, blank=True)
    assigned_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        verbose_name = _("assignment")
        verbose_name_plural = _("assignments")
        ordering = ["deliverable_id", "-role", "member__last_name", "member__first_name"]
        constraints = [models.UniqueConstraint(fields=["deliverable", "member"], name="uq_assign_del_member")]
        indexes = [models.Index(fields=["member", "is_active"], name="idx_assign_member_active")]


class AssignmentHistory(models.Model):
    deliverable = models.ForeignKey(Deliverable, on_delete=models.CASCADE, related_name="assignment_history")
    member = models.ForeignKey(MEMBER, on_delete=models.PROTECT, related_name="+")
    action = models.CharField(max_length=20)  # assigned, unassigned, role_changed
    previous_role = models.CharField(max_length=10, blank=True)
    new_role = models.CharField(max_length=10, blank=True)
    changed_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    changed_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(blank=True)

    class Meta:
        verbose_name = _("assignment change")
        verbose_name_plural = _("assignment changes")
        ordering = ["-changed_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(action__in=["assigned", "unassigned", "role_changed"]), name="ck_ash_action"
            ),
        ]
