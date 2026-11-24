from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import F, Max, Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy


class TaskStatus(models.TextChoices):
    """The life of a task (knowledge base: PROJECTS/ERP/tasks_v2_design.md, decision D-012): planned,
    in progress, submitted with its evidence, then validated with a quality mark or to be reworked.
    A blocked task is one with a blocker not resolved yet (Blocker)."""

    # Context: feminine in French (une tâche prévue, soumise, validée).
    PLANNED = "planned", pgettext_lazy("task status", "Planned")
    IN_PROGRESS = "in_progress", _("In progress")
    SUBMITTED = "submitted", pgettext_lazy("task status", "Submitted")
    NEEDS_REVISION = "needs_revision", pgettext_lazy("task status", "Needs revision")
    VALIDATED = "validated", pgettext_lazy("task status", "Validated")


# Statuses of a task still being worked on (not submitted, not validated).
OPEN_STATUSES = (TaskStatus.PLANNED, TaskStatus.IN_PROGRESS, TaskStatus.NEEDS_REVISION)


class TaskPoints(models.IntegerChoices):
    """The weight of a task, set by its leader before work starts (Ranking System §3)."""

    ROUTINE = 1, _("Routine")
    IMPORTANT = 2, pgettext_lazy("task points", "Important")
    COMPLEX = 3, pgettext_lazy("task points", "Complex")
    CRITICAL = 4, pgettext_lazy("task points", "Critical")
    PROJECT_CRITICAL = 5, pgettext_lazy("task points", "Project-critical")


class TaskPriority(models.TextChoices):
    LOW = "low", _("Low")
    MEDIUM = "medium", _("Medium")
    HIGH = "high", _("High")

class TaskLinkType(models.TextChoices):
    DRIVE = "drive", _("Google Drive")
    GITHUB = "github", _("GitHub")
    CAD = "cad", _("CAD file")
    REPORT = "report", _("Report")
    OTHER = "other", _("Other")


class Task(models.Model):
    project = models.ForeignKey(
        "projects.Project", on_delete=models.PROTECT, related_name="tasks", verbose_name=_("project")
    )
    # Optional: parent task. NULL = top-level task.
    parent_task = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="subtasks",
        verbose_name=_("parent task"),
    )
    # Optional: task supports a specific Formula Student subsystem.
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="tasks", verbose_name=_("subsystem"),
    )
    # Optional: task is tied to a specific engineering lifecycle step.
    lifecycle_step = models.ForeignKey(
        "subsystems.LifecycleStep", null=True, blank=True,
        on_delete=models.PROTECT, related_name="tasks", verbose_name=_("lifecycle step"),
    )
    # Its number in its project, given at creation: the reference is the project's key and this number.
    number = models.PositiveIntegerField(_("number"), null=True, blank=True, editable=False)
    title = models.CharField(_("title"), max_length=255)
    description = models.TextField(_("description"), blank=True)
    status = models.CharField(_("status"), max_length=20, choices=TaskStatus.choices, default=TaskStatus.PLANNED)
    # The work order's follow-up (the team's Figma, decision D-022): how far it is (0 to 100, used while it
    # has no subtasks), the phase it is in and what comes next, given by who works on it.
    progress = models.PositiveSmallIntegerField(_("progress (%)"), default=0)
    current_phase = models.CharField(_("current phase"), max_length=150, blank=True)
    next_step = models.CharField(_("next step"), max_length=255, blank=True)
    priority = models.CharField(_("priority"), max_length=10, choices=TaskPriority.choices, null=True, blank=True)
    # Set by a leader before work starts, then locked (apps/tasks/workflow.py); only a validated
    # blocker moves the due date afterwards.
    points = models.PositiveSmallIntegerField(_("points"), choices=TaskPoints.choices, null=True, blank=True)
    start_date = models.DateField(_("start date"), null=True, blank=True)
    due_date = models.DateField(_("due date"), null=True, blank=True)
    # The due date when work began, kept when a blocker moves it.
    initial_due_date = models.DateField(_("initial due date"), null=True, blank=True)
    deliverable = models.TextField(_("expected deliverable"), blank=True)
    success_criteria = models.TextField(_("success criteria"), blank=True)
    actual_deliverable = models.TextField(_("actual deliverable"), blank=True)
    quality_mark = models.PositiveSmallIntegerField(_("quality mark"), null=True, blank=True)
    started_at = models.DateTimeField(_("started at"), null=True, blank=True)
    submitted_at = models.DateTimeField(_("submitted at"), null=True, blank=True)
    validated_at = models.DateTimeField(_("validated at"), null=True, blank=True)
    validated_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="validated_tasks", verbose_name=_("validated by"),
    )
    # Counts in the monthly ranking: true for the tasks created from 20/10/2026 on (they need points);
    # the tasks of before keep no points.
    scored = models.BooleanField(_("scored"), default=True)
    created_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="created_tasks", verbose_name=_("created by"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("task")
        verbose_name_plural = _("tasks")
        indexes = [
            models.Index(fields=["status"], name="idx_task_status"),
            models.Index(fields=["due_date"], name="idx_task_due_date"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(points__isnull=True) | Q(points__gte=1, points__lte=5), name="ck_task_points"
            ),
            models.CheckConstraint(
                condition=Q(quality_mark__isnull=True) | Q(quality_mark__lte=5), name="ck_task_quality_mark"
            ),
            models.CheckConstraint(
                condition=Q(start_date__isnull=True) | Q(due_date__isnull=True) | Q(due_date__gte=F("start_date")),
                name="ck_task_start_before_due",
            ),
            models.CheckConstraint(condition=Q(progress__lte=100), name="ck_task_progress"),
            models.UniqueConstraint(fields=["project", "number"], name="uniq_task_number_in_project"),
        ]

    def clean(self):
        # Equivalent of the SQL's composite FK (parent_task_id, project_id):
        # a subtask must belong to the same project as its parent.
        if self.parent_task_id and self.parent_task.project_id != self.project_id:
            raise ValidationError(_("A subtask must belong to the same project as its parent task."))
        if self.parent_task_id == self.id and self.id is not None:
            raise ValidationError(_("A task cannot be its own parent."))

    def save(self, *args, **kwargs):
        if self.number is None and self.project_id:
            with transaction.atomic():
                # One numbering at a time per project: the project's row is locked until the task is saved.
                projects = Task._meta.get_field("project").related_model.objects
                list(projects.select_for_update().filter(pk=self.project_id).values_list("pk", flat=True))
                last = Task.objects.filter(project_id=self.project_id).aggregate(last=Max("number"))["last"]
                self.number = (last or 0) + 1
                return super().save(*args, **kwargs)
        return super().save(*args, **kwargs)

    @property
    def reference(self):
        """"EV27-007": the project's key (or "P" and its id) and the task's number in it."""
        return f"{self.project.key or f'P{self.project_id}'}-{self.number or 0:03d}"

    def __str__(self):
        return self.title


class TaskAssignee(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="assignees", verbose_name=_("task"))
    member = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="task_assignments", verbose_name=_("member")
    )
    # Marks the main task owner when multiple members are assigned.
    is_primary = models.BooleanField(_("main assignee"), default=False)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("task assignment")
        verbose_name_plural = _("task assignments")
        constraints = [
            models.UniqueConstraint(fields=["task", "member"], name="uq_task_assignee_task_member"),
            # At most one primary assignee per task.
            models.UniqueConstraint(
                fields=["task"], condition=models.Q(is_primary=True), name="uq_task_assignee_one_primary"
            ),
        ]

    def __str__(self):
        return f"{self.member} on {self.task}"


class TaskComment(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="comments", verbose_name=_("task"))
    author = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="task_comments", verbose_name=_("author")
    )
    content = models.TextField(_("comment"))
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("task comment")
        verbose_name_plural = _("task comments")
        ordering = ["created_at"]

    def __str__(self):
        return f"Comment by {self.author} on {self.task}"


class TaskLink(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="links", verbose_name=_("task"))
    url = models.URLField(_("URL"), max_length=500)
    label = models.CharField(_("label"), max_length=255, blank=True)
    link_type = models.CharField(
        _("link type"), max_length=20, choices=TaskLinkType.choices, default=TaskLinkType.OTHER
    )
    added_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="task_links", verbose_name=_("added by")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("task link")
        verbose_name_plural = _("task links")
        indexes = [
            models.Index(fields=["task"], name="idx_task_link_task_id"),
        ]

    def __str__(self):
        return self.label or self.url


# --- Blockers (Team Manager requirements §6, Ranking System §5.1) ---


class BlockerSeverity(models.TextChoices):
    LOW = "low", pgettext_lazy("blocker severity", "Low")
    MEDIUM = "medium", pgettext_lazy("blocker severity", "Medium")
    HIGH = "high", pgettext_lazy("blocker severity", "High")
    CRITICAL = "critical", pgettext_lazy("blocker severity", "Critical")


class BlockerOrigin(models.TextChoices):
    TECHNICAL = "technical", _("Technical")
    SUPPLIER = "supplier", _("Supplier")
    FINANCIAL = "financial", _("Financial")
    ORGANISATION = "organisation", _("Organisation")
    OTHER = "other", pgettext_lazy("blocker origin", "Other")


class BlockerStatus(models.TextChoices):
    """Declared (open), then validated by a leader (the task's due date is frozen) or rejected, and
    finally resolved."""

    OPEN = "open", pgettext_lazy("blocker status", "Declared")
    VALIDATED = "validated", pgettext_lazy("blocker status", "Validated")
    REJECTED = "rejected", pgettext_lazy("blocker status", "Rejected")
    RESOLVED = "resolved", pgettext_lazy("blocker status", "Resolved")


# A blocker that still blocks its task.
UNRESOLVED = (BlockerStatus.OPEN, BlockerStatus.VALIDATED)


class Blocker(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="blockers", verbose_name=_("task"))
    description = models.TextField(_("description"))
    origin = models.CharField(_("origin"), max_length=20, choices=BlockerOrigin.choices, default=BlockerOrigin.OTHER)
    severity = models.CharField(
        _("severity"), max_length=10, choices=BlockerSeverity.choices, default=BlockerSeverity.MEDIUM
    )
    dependency = models.TextField(_("dependency"), blank=True)
    required_action = models.TextField(_("required action"), blank=True)
    responsible = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.SET_NULL, related_name="blockers_to_solve",
        verbose_name=_("responsible for solving it"),
    )
    responsible_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True, on_delete=models.SET_NULL, related_name="blockers",
        verbose_name=_("responsible unit"),
    )
    # When the problem became known: a blocker declared more than 2 working days later is late.
    known_since = models.DateField(_("known since"), default=timezone.localdate)
    is_late = models.BooleanField(_("declared late"), default=False)
    reported_by = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.SET_NULL, related_name="reported_blockers",
        verbose_name=_("reported by"),
    )
    reported_at = models.DateTimeField(_("reported at"), auto_now_add=True)
    status = models.CharField(_("status"), max_length=10, choices=BlockerStatus.choices, default=BlockerStatus.OPEN)
    decided_by = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.SET_NULL, related_name="decided_blockers",
        verbose_name=_("validated or rejected by"),
    )
    decided_at = models.DateTimeField(_("validated or rejected at"), null=True, blank=True)
    decision_note = models.TextField(_("decision note"), blank=True)
    resolved_at = models.DateTimeField(_("resolved at"), null=True, blank=True)
    resolution = models.TextField(_("resolution"), blank=True)

    class Meta:
        verbose_name = _("blocker")
        verbose_name_plural = _("blockers")
        indexes = [models.Index(fields=["status"], name="idx_blocker_status")]

    def __str__(self):
        return self.description[:80]


# --- History of a task (for its page, and the update rate of the monthly ranking) ---


class TaskEventKind(models.TextChoices):
    CREATED = "created", pgettext_lazy("task event", "Created")
    STARTED = "started", pgettext_lazy("task event", "Started")
    SUBMITTED = "submitted", pgettext_lazy("task event", "Submitted")
    VALIDATED = "validated", pgettext_lazy("task event", "Validated")
    REVISION = "revision", pgettext_lazy("task event", "Sent back for revision")
    ESTIMATED = "estimated", pgettext_lazy("task event", "Points and dates set")
    DEADLINE_MOVED = "deadline_moved", pgettext_lazy("task event", "Due date moved")
    BLOCKER_DECLARED = "blocker_declared", pgettext_lazy("task event", "Blocker declared")
    BLOCKER_VALIDATED = "blocker_validated", pgettext_lazy("task event", "Blocker validated")
    BLOCKER_REJECTED = "blocker_rejected", pgettext_lazy("task event", "Blocker rejected")
    BLOCKER_RESOLVED = "blocker_resolved", pgettext_lazy("task event", "Blocker resolved")
    COMMENTED = "commented", pgettext_lazy("task event", "Commented")
    LINK_ADDED = "link_added", pgettext_lazy("task event", "Link added")
    PROGRESS = "progress", pgettext_lazy("task event", "Progress updated")


class TaskEvent(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="events", verbose_name=_("task"))
    kind = models.CharField(_("kind"), max_length=20, choices=TaskEventKind.choices)
    actor = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.SET_NULL, related_name="task_events",
        verbose_name=_("actor"),
    )
    data = models.JSONField(_("details"), default=dict, blank=True)
    created_at = models.DateTimeField(_("date"), auto_now_add=True)

    class Meta:
        verbose_name = _("task event")
        verbose_name_plural = _("task events")
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["task", "created_at"], name="idx_task_event_task_date")]

    def __str__(self):
        return f"{self.get_kind_display()} - {self.task}"
