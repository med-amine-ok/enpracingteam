from django.core.exceptions import ValidationError
from django.db import models


class TaskStatus(models.TextChoices):
    TODO = "todo", "To do"
    IN_PROGRESS = "in_progress", "In progress"
    BLOCKED = "blocked", "Blocked"
    DONE = "done", "Done"


class TaskPriority(models.TextChoices):
    LOW = "low", "Low"
    MEDIUM = "medium", "Medium"
    HIGH = "high", "High"

class TaskLinkType(models.TextChoices):
    DRIVE = "drive", "Google Drive"
    GITHUB = "github", "GitHub"
    CAD = "cad", "CAD file"
    REPORT = "report", "Report"
    OTHER = "other", "Other"


class Task(models.Model):
    project = models.ForeignKey(
        "projects.Project", on_delete=models.PROTECT, related_name="tasks"
    )
    # Optional: parent task. NULL = top-level task.
    parent_task = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="subtasks"
    )
    # Optional: task supports a specific Formula Student subsystem.
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="tasks",
    )
    # Optional: task is tied to a specific engineering lifecycle step.
    lifecycle_step = models.ForeignKey(
        "subsystems.LifecycleStep", null=True, blank=True,
        on_delete=models.PROTECT, related_name="tasks",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=TaskStatus.choices, default=TaskStatus.TODO)
    priority = models.CharField(max_length=10, choices=TaskPriority.choices, null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="created_tasks",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["status"], name="idx_task_status"),
            models.Index(fields=["due_date"], name="idx_task_due_date"),
        ]

    def clean(self):
        # Equivalent of the SQL's composite FK (parent_task_id, project_id):
        # a subtask must belong to the same project as its parent.
        if self.parent_task_id and self.parent_task.project_id != self.project_id:
            raise ValidationError("A subtask must belong to the same project as its parent task.")
        if self.parent_task_id == self.id and self.id is not None:
            raise ValidationError("A task cannot be its own parent.")

    def __str__(self):
        return self.title


class TaskAssignee(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="assignees")
    member = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="task_assignments"
    )
    # Marks the main task owner when multiple members are assigned.
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
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
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="task_comments"
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Comment by {self.author} on {self.task}"


class TaskLink(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="links")
    url = models.URLField(max_length=500)
    label = models.CharField(max_length=255, blank=True)
    link_type = models.CharField(max_length=20, choices=TaskLinkType.choices, default=TaskLinkType.OTHER)
    added_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="task_links"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["task"], name="idx_task_link_task_id"),
        ]

    def __str__(self):
        return self.label or self.url