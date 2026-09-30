from django.db import models
from django.db.models import F, Q


class SubsystemStatus(models.TextChoices):
    PLANNED = "planned", "Planned"
    ACTIVE = "active", "Active"
    BLOCKED = "blocked", "Blocked"
    COMPLETE = "complete", "Complete"


class MemberLevel(models.TextChoices):
    """Duplicated from apps.members on purpose: same meaning (main/junior),
    kept separate to avoid a cross-app import."""
    MAIN = "main", "Main"
    JUNIOR = "junior", "Junior"


class Subsystem(models.Model):
    # Stable identifier used by the seed command. NULL for subsystems created by hand.
    code = models.SlugField(max_length=100, unique=True, null=True, blank=True)
    name = models.CharField(max_length=255)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.PROTECT, related_name="subsystems"
    )
    # Technical org unit (fs_department) that owns it. Enforced in Django, not the DB.
    org_unit = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, related_name="subsystems"
    )
    parent_subsystem = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )
    status = models.CharField(max_length=20, choices=SubsystemStatus.choices, default=SubsystemStatus.PLANNED)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=~Q(parent_subsystem=F("id")), name="ck_subsystem_not_own_parent"
            ),
        ]

    def __str__(self):
        return self.name


class LifecycleStep(models.Model):
    step_order = models.IntegerField(unique=True)
    name = models.CharField(max_length=150)
    applies_to_ic = models.BooleanField(default=True)
    applies_to_ev = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["step_order"]

    def __str__(self):
        return f"{self.step_order}. {self.name}"


class SubsystemStepProgress(models.Model):
    subsystem = models.ForeignKey(Subsystem, on_delete=models.CASCADE, related_name="step_progress")
    lifecycle_step = models.ForeignKey(LifecycleStep, on_delete=models.PROTECT, related_name="progress_rows")
    is_complete = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    validated_by = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.PROTECT, related_name="validated_steps"
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["subsystem", "lifecycle_step"], name="uq_substep_progress_subsystem_step"
            ),
        ]

    def __str__(self):
        return f"{self.subsystem} - {self.lifecycle_step}"


class MemberSubsystem(models.Model):
    """Table name kept close to the SQL schema's member_subsystem."""
    subsystem = models.ForeignKey(Subsystem, on_delete=models.CASCADE, related_name="member_assignments")
    member = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="subsystem_assignments"
    )
    member_level = models.CharField(max_length=10, choices=MemberLevel.choices)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)  # NULL = currently active
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["subsystem", "member", "start_date"], name="uq_membersubsystem_subsystem_member_start"
            ),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(start_date__isnull=True) | Q(end_date__gte=F("start_date")),
                name="ck_membersubsystem_dates",
            ),
        ]

    def __str__(self):
        return f"{self.member} - {self.subsystem}"

    