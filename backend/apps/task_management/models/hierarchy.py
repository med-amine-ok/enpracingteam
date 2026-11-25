"""Season → Project → Department → Work Order (specification §2–3)."""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from .choices import NOT_OFFICIAL, Priority, ProposalStatus, UNLOCKED_WO_STATUSES, WorkOrderStatus

MEMBER = settings.AUTH_USER_MODEL


class Season(models.Model):
    code = models.SlugField(_("code"), max_length=100, unique=True, null=True, blank=True)
    year = models.PositiveSmallIntegerField(_("year"))
    label = models.CharField(_("label"), max_length=255)
    is_active = models.BooleanField(_("current season"), default=False)
    # After this moment a Deliverable with no complete submission gets the time factor 0 (specification §9.7, §17.1).
    scoring_cutoff_at = models.DateTimeField(_("scoring cutoff"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("season")
        verbose_name_plural = _("seasons")
        ordering = ["-year", "-id"]
        constraints = [
            models.CheckConstraint(condition=Q(year__gte=2000, year__lte=2100), name="ck_season_year"),
            models.UniqueConstraint(fields=["is_active"], condition=Q(is_active=True), name="uq_season_one_active"),
        ]

    def __str__(self):
        return self.label


class ProjectDepartment(models.Model):
    """A Department taking part in a Project: the Project's progress is their equal-weighted average (§6.3)."""

    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="department_participations", verbose_name=_("project")
    )
    org_unit = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, related_name="project_participations", verbose_name=_("department")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("participating department")
        verbose_name_plural = _("participating departments")
        constraints = [models.UniqueConstraint(fields=["project", "org_unit"], name="uq_proj_dept")]

    def __str__(self):
        return f"{self.project} / {self.org_unit}"


class WorkOrder(models.Model):
    """A package of work with one point budget from 1 to 5, divided between its Deliverables (§3, §7).

    A member's proposal is a Work Order whose `proposal_status` is not approved yet: it is not official work and
    earns nothing (§3.1). `proposal_original` keeps what was proposed, before the Head's edits."""

    code = models.CharField(_("code"), max_length=100, unique=True, null=True, blank=True)
    season = models.ForeignKey(Season, on_delete=models.PROTECT, related_name="work_orders", verbose_name=_("season"))
    department = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, related_name="work_orders", verbose_name=_("department")
    )
    project = models.ForeignKey(
        "projects.Project", null=True, blank=True, on_delete=models.SET_NULL, related_name="work_orders",
        verbose_name=_("project"),
    )
    title = models.CharField(_("title"), max_length=255)
    description = models.TextField(_("description"), blank=True)
    objectives = models.TextField(_("expected result"), blank=True)
    justification = models.TextField(_("justification"), blank=True)
    estimated_effort_units = models.DecimalField(
        _("estimated effort units"), max_digits=6, decimal_places=1, null=True, blank=True
    )
    # Set by the Head (§7.1); required to activate. Confidential: never sent to ordinary members.
    budget_tier = models.PositiveSmallIntegerField(_("point budget"), null=True, blank=True)
    status = models.CharField(_("status"), max_length=20, choices=WorkOrderStatus.choices, default=WorkOrderStatus.DRAFT)
    priority = models.CharField(_("priority"), max_length=10, choices=Priority.choices, blank=True)
    coordinator = models.ForeignKey(
        MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="coordinated_work_orders",
        verbose_name=_("coordinator"),
    )
    proposed_by = models.ForeignKey(
        MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="proposed_work_orders",
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
    proposal_original = models.JSONField(_("proposal as submitted"), default=dict, blank=True)
    created_by = models.ForeignKey(
        MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name=_("created by")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("work order")
        verbose_name_plural = _("work orders")
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["season", "department"], name="idx_wo_season_dept"),
            models.Index(fields=["status"], name="idx_wo_status"),
            models.Index(fields=["proposal_status"], name="idx_wo_proposal_status"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(budget_tier__isnull=True) | Q(budget_tier__gte=1, budget_tier__lte=5),
                name="ck_wo_budget_tier",
            ),
            models.CheckConstraint(condition=Q(status__in=WorkOrderStatus.values), name="ck_wo_status"),
            models.CheckConstraint(
                condition=Q(proposal_status__isnull=True) | Q(proposal_status__in=ProposalStatus.values),
                name="ck_wo_proposal_status",
            ),
            # Only official work leaves the draft (§3.1: a proposal is not official work).
            models.CheckConstraint(
                condition=Q(status=WorkOrderStatus.DRAFT) | Q(status=WorkOrderStatus.CANCELLED)
                | Q(proposal_status__isnull=True) | Q(proposal_status=ProposalStatus.APPROVED),
                name="ck_wo_official_before_planning",
            ),
        ]

    def __str__(self):
        return f"{self.code} {self.title}" if self.code else self.title

    @property
    def is_official(self):
        return self.proposal_status not in NOT_OFFICIAL

    @property
    def is_locked(self):
        """Budget and weights are frozen once the Work Order is active (§7.2)."""
        return self.status not in UNLOCKED_WO_STATUSES


class WorkOrderStatusHistory(models.Model):
    work_order = models.ForeignKey(WorkOrder, on_delete=models.CASCADE, related_name="status_history")
    from_status = models.CharField(max_length=20, choices=WorkOrderStatus.choices, blank=True)
    to_status = models.CharField(max_length=20, choices=WorkOrderStatus.choices)
    changed_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reason = models.TextField(blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("work order status change")
        verbose_name_plural = _("work order status changes")
        ordering = ["-changed_at", "-id"]
