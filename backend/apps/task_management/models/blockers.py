"""Blockers: actual obstacles, never a workflow status (specification §11), and the audit trail (§15)."""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from .choices import Action, BlockerImpact, BlockerOrigin, BlockerSeverity, BlockerStatus, EntityType, InvolvementRole
from .deliverables import Deliverable, Milestone
from .dependencies import DependencyLink
from .hierarchy import WorkOrder

MEMBER = settings.AUTH_USER_MODEL


class Blocker(models.Model):
    """An obstacle on a Deliverable or a Work Order. It may cite a Milestone for context, never changing it.
    Resolved is terminal: a recurring issue is a new blocker, linked by `previous` (§11.1)."""

    deliverable = models.ForeignKey(
        Deliverable, null=True, blank=True, on_delete=models.SET_NULL, related_name="blockers"
    )
    work_order = models.ForeignKey(WorkOrder, null=True, blank=True, on_delete=models.SET_NULL, related_name="blockers")
    milestone = models.ForeignKey(Milestone, null=True, blank=True, on_delete=models.SET_NULL, related_name="blockers")
    dependency_link = models.ForeignKey(
        DependencyLink, null=True, blank=True, on_delete=models.SET_NULL, related_name="blockers"
    )
    previous = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="recurrences",
        verbose_name=_("earlier blocker"),
    )
    origin = models.CharField(_("origin"), max_length=12, choices=BlockerOrigin.choices, default=BlockerOrigin.OTHER)
    severity = models.CharField(_("severity"), max_length=10, choices=BlockerSeverity.choices)
    impact = models.CharField(_("impact"), max_length=10, choices=BlockerImpact.choices, default=BlockerImpact.PARTIAL)
    description = models.TextField(_("description"))
    required_action = models.TextField(_("required action"), blank=True)
    responsible_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
        verbose_name=_("responsible unit"),
    )
    resolver = models.ForeignKey(
        MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="blockers_to_resolve",
        verbose_name=_("resolver"),
    )
    status = models.CharField(_("status"), max_length=10, choices=BlockerStatus.choices, default=BlockerStatus.OPEN)
    resolution_note = models.TextField(_("resolution"), blank=True)
    reported_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reported_at = models.DateTimeField(auto_now_add=True)
    resolved_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("blocker")
        verbose_name_plural = _("blockers")
        ordering = ["-reported_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(deliverable__isnull=False) | Q(work_order__isnull=False), name="ck_blocker_target"
            ),
            models.CheckConstraint(
                condition=~Q(status=BlockerStatus.RESOLVED) | ~Q(resolution_note=""), name="ck_blocker_resolution"
            ),
        ]

    def __str__(self):
        return self.description[:60]


class BlockerInvolvement(models.Model):
    blocker = models.ForeignKey(Blocker, on_delete=models.CASCADE, related_name="involvements")
    member = models.ForeignKey(MEMBER, on_delete=models.PROTECT, related_name="+")
    involvement_role = models.CharField(
        max_length=10, choices=InvolvementRole.choices, default=InvolvementRole.INFORMED
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField(blank=True)

    class Meta:
        verbose_name = _("blocker involvement")
        verbose_name_plural = _("blocker involvements")
        constraints = [models.UniqueConstraint(fields=["blocker", "member"], name="uq_blkinv_blocker_member")]


class BlockerValidation(models.Model):
    """The Head's verdict on a blocker's real impact on delivery (§11.3). Relief, if any, is an approved
    ReliefInterval linked to the blocker, so that it joins the union of the Deliverable's relief."""

    blocker = models.OneToOneField(Blocker, on_delete=models.CASCADE, related_name="validation")
    validated_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    validated_at = models.DateTimeField(auto_now_add=True)
    impact_confirmed = models.BooleanField(default=False)
    impact_note = models.TextField(blank=True)

    class Meta:
        verbose_name = _("blocker impact validation")
        verbose_name_plural = _("blocker impact validations")


class ActivityLog(models.Model):
    """Who did what, when, with the values before and after and the reason (§15). Never holds scoring data:
    that goes to ranking.ranking_audit_log."""

    entity_type = models.CharField(max_length=20, choices=EntityType.choices)
    entity_id = models.BigIntegerField()
    # The Deliverable and Work Order concerned, so that their timelines gather their children's events.
    deliverable = models.ForeignKey(
        Deliverable, null=True, blank=True, on_delete=models.SET_NULL, related_name="activity"
    )
    work_order = models.ForeignKey(WorkOrder, null=True, blank=True, on_delete=models.SET_NULL, related_name="activity")
    action = models.CharField(max_length=20, choices=Action.choices)
    actor = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    old_value = models.JSONField(default=dict, blank=True)
    new_value = models.JSONField(default=dict, blank=True)
    reason = models.TextField(blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("activity")
        verbose_name_plural = _("activity")
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id"], name="idx_act_entity"),
            models.Index(fields=["deliverable", "-occurred_at"], name="idx_act_deliverable"),
            models.Index(fields=["work_order", "-occurred_at"], name="idx_act_work_order"),
        ]
