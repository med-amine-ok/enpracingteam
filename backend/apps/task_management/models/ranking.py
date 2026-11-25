"""The confidential scoring data, in the PostgreSQL schema "ranking" (schema notes §9).

Ordinary members never reach it: no operational serializer reads these tables, and the scoring endpoints
answer 404 to whoever is not a scoring admin (plan §4.4)."""

from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

MEMBER = settings.AUTH_USER_MODEL


def ranking_table(name):
    return f'"ranking"."{name}"'


def factor(default):
    return models.DecimalField(max_digits=4, decimal_places=3, default=Decimal(default))


class FormulaVersion(models.Model):
    """The constants of the scoring formulas (specification §7.1, §8, §9.7). A version used by a calculation
    never changes: a change is a new version (guide §14.5)."""

    code = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    penalty_minor = factor("0.020")
    penalty_moderate = factor("0.050")
    penalty_major = factor("0.100")
    penalty_critical = factor("0.150")
    escalation_base = factor("0.250")
    penalty_round_cap = factor("0.300")
    revision_cap = factor("0.600")
    tf_early = factor("1.100")
    tf_on_time = factor("1.000")
    tf_late_25 = factor("0.800")
    tf_late_50 = factor("0.500")
    tf_late_over50 = factor("0.200")
    tf_no_submit = factor("0.000")
    weight_effort = factor("0.350")
    weight_complexity = factor("0.300")
    weight_uncertainty = factor("0.200")
    weight_responsibility = factor("0.150")
    is_current = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = ranking_table("formula_version")
        verbose_name = _("formula version")
        verbose_name_plural = _("formula versions")
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["is_current"], condition=Q(is_current=True), name="uq_fv_one_current"),
        ]

    def __str__(self):
        return self.code


class WoBudgetRubric(models.Model):
    """The Head's four ratings behind a Work Order's budget: S = 0.35E + 0.30C + 0.20U + 0.15R (§7.1)."""

    work_order = models.OneToOneField(
        "task_management.WorkOrder", on_delete=models.CASCADE, related_name="budget_rubric"
    )
    effort_rating = models.PositiveSmallIntegerField()
    complexity_rating = models.PositiveSmallIntegerField()
    uncertainty_rating = models.PositiveSmallIntegerField()
    responsibility_rating = models.PositiveSmallIntegerField()
    budget_score = models.DecimalField(max_digits=4, decimal_places=2)
    suggested_tier = models.PositiveSmallIntegerField()
    entered_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    entered_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = ranking_table("wo_budget_rubric")
        verbose_name = _("budget rubric")
        verbose_name_plural = _("budget rubrics")
        constraints = [
            models.CheckConstraint(
                condition=Q(
                    effort_rating__gte=1, effort_rating__lte=5, complexity_rating__gte=1, complexity_rating__lte=5,
                    uncertainty_rating__gte=1, uncertainty_rating__lte=5,
                    responsibility_rating__gte=1, responsibility_rating__lte=5,
                ),
                name="ck_wbr_ratings",
            ),
        ]


class QualityDataStatus(models.TextChoices):
    INCOMPLETE = "incomplete", _("Incomplete")
    COMPLETE = "complete", _("Complete")
    REQUIRES_CORRECTION = "requires_correction", _("Requires correction")
    SUBMITTED = "submitted", _("Submitted")


class QualityInput(models.Model):
    """The Head's final raw quality mark, 0–5, of a validated Deliverable (§8.1, guide §13)."""

    deliverable = models.OneToOneField(
        "task_management.Deliverable", on_delete=models.PROTECT, related_name="quality_input"
    )
    raw_quality = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    note = models.TextField(blank=True)
    entered_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    entered_at = models.DateTimeField(auto_now_add=True)
    last_modified_at = models.DateTimeField(auto_now=True)
    data_status = models.CharField(
        max_length=30, choices=QualityDataStatus.choices, default=QualityDataStatus.INCOMPLETE
    )

    class Meta:
        db_table = ranking_table("quality_input")
        verbose_name = _("quality input")
        verbose_name_plural = _("quality inputs")
        constraints = [
            models.CheckConstraint(
                condition=Q(raw_quality__isnull=True) | Q(raw_quality__gte=0, raw_quality__lte=5),
                name="ck_qi_quality",
            ),
            models.CheckConstraint(condition=Q(data_status__in=QualityDataStatus.values), name="ck_qi_status"),
        ]


class TimeInput(models.Model):
    """The time-factor inputs of a Deliverable at its latest calculation (§9)."""

    deliverable = models.OneToOneField(
        "task_management.Deliverable", on_delete=models.PROTECT, related_name="time_input"
    )
    start_date = models.DateField(null=True, blank=True)
    original_deadline = models.DateField(null=True, blank=True)
    effective_deadline = models.DateField(null=True, blank=True)
    first_submission_at = models.DateTimeField(null=True, blank=True)
    total_relief_days = models.PositiveIntegerField(default=0)
    delay_ratio = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    time_factor = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    formula_version = models.ForeignKey(FormulaVersion, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    calculated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = ranking_table("time_input")
        verbose_name = _("time input")
        verbose_name_plural = _("time inputs")


class RunStatus(models.TextChoices):
    RUNNING = "running", _("Running")
    COMPLETED = "completed", _("Completed")
    FAILED = "failed", _("Failed")


class CalculationRun(models.Model):
    season = models.ForeignKey("task_management.Season", on_delete=models.PROTECT, related_name="+")
    formula_version = models.ForeignKey(FormulaVersion, on_delete=models.PROTECT, related_name="runs")
    triggered_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    triggered_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=RunStatus.choices, default=RunStatus.RUNNING)
    records_processed = models.PositiveIntegerField(default=0)
    warnings_count = models.PositiveIntegerField(default=0)
    errors_count = models.PositiveIntegerField(default=0)
    # [{"deliverable": id, "code": "...", "level": "warning"|"error", "message": "..."}]
    issues = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True)
    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = ranking_table("calculation_run")
        verbose_name = _("calculation run")
        verbose_name_plural = _("calculation runs")
        ordering = ["-triggered_at", "-id"]
        constraints = [models.CheckConstraint(condition=Q(status__in=RunStatus.values), name="ck_rcr_status")]


class ScoreSnapshot(models.Model):
    """E_member,d = B_WO × w_d × Q_f × T_d / N_d with every input kept, so that a score can be reproduced (§13,
    §15.7). Never updated: a newer calculation supersedes it."""

    deliverable = models.ForeignKey("task_management.Deliverable", on_delete=models.PROTECT, related_name="+")
    member = models.ForeignKey(MEMBER, on_delete=models.PROTECT, related_name="+")
    formula_version = models.ForeignKey(FormulaVersion, on_delete=models.PROTECT, related_name="+")
    calculation_run = models.ForeignKey(
        CalculationRun, null=True, blank=True, on_delete=models.SET_NULL, related_name="snapshots"
    )
    department = models.ForeignKey("members.OrgUnit", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    budget_tier = models.PositiveSmallIntegerField()
    weight = models.DecimalField(max_digits=6, decimal_places=3)
    allocated_points = models.DecimalField(max_digits=8, decimal_places=4)
    raw_quality = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    quality_factor = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    time_factor = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    revision_penalty = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    revision_rounds = models.JSONField(default=list, blank=True)
    delay_ratio = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    effective_deadline = models.DateField(null=True, blank=True)
    first_submission_at = models.DateTimeField(null=True, blank=True)
    member_count = models.PositiveSmallIntegerField()
    earned_points = models.DecimalField(max_digits=8, decimal_places=4)
    is_superseded = models.BooleanField(default=False)
    superseded_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    superseded_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = ranking_table("score_snapshot")
        verbose_name = _("score snapshot")
        verbose_name_plural = _("score snapshots")
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["deliverable", "member", "calculation_run"], name="uq_score_del_member_run"
            ),
        ]


class RankingAuditLog(models.Model):
    action = models.CharField(max_length=50)
    entity_type = models.CharField(max_length=50)
    entity_id = models.BigIntegerField()
    actor = models.ForeignKey(MEMBER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    old_value = models.JSONField(default=dict, blank=True)
    new_value = models.JSONField(default=dict, blank=True)
    reason = models.TextField(blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = ranking_table("ranking_audit_log")
        verbose_name = _("scoring audit entry")
        verbose_name_plural = _("scoring audit entries")
        ordering = ["-occurred_at", "-id"]
