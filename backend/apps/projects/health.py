"""
The state of a project, as in the team's Figma (decision D-022): in preparation, on track, at risk, on hold or
completed. An active project is at risk once one of its tasks is late or blocked, or when its validated tasks lag
more than BEHIND_POINTS behind the share of its calendar gone.
"""

from django.db.models import Count, IntegerField, OuterRef, Subquery, TextChoices
from django.db.models.functions import Coalesce
from django.utils.translation import pgettext_lazy

from apps.tasks.models import OPEN_STATUSES, BlockerStatus, Task

from .models import ProjectStatus

BEHIND_POINTS = 15


class ProjectHealth(TextChoices):
    # Context: the state of a project (French le projet: masculine; Arabic المشروع: masculine).
    PLANNING = "planning", pgettext_lazy("project health", "In preparation")
    ON_TRACK = "on_track", pgettext_lazy("project health", "On track")
    AT_RISK = "at_risk", pgettext_lazy("project health", "At risk")
    ON_HOLD = "on_hold", pgettext_lazy("project health", "On hold")
    COMPLETED = "completed", pgettext_lazy("project health", "Completed")


def overdue_count(today):
    """An annotation: the project's open tasks past their due date, except those a validated blocker freezes."""
    late = (
        Task.objects.filter(project=OuterRef("pk"), status__in=OPEN_STATUSES, due_date__lt=today)
        .exclude(blockers__status=BlockerStatus.VALIDATED)
        .order_by().values("project").annotate(count=Count("pk", distinct=True)).values("count")
    )
    return Coalesce(Subquery(late, output_field=IntegerField()), 0)


def project_health(project, today):
    """`project` annotated by the list (tasks_total, tasks_done, tasks_blocked, tasks_overdue)."""
    if project.status == ProjectStatus.PLANNED:
        return ProjectHealth.PLANNING
    if project.status == ProjectStatus.ON_HOLD:
        return ProjectHealth.ON_HOLD
    if project.status == ProjectStatus.COMPLETED:
        return ProjectHealth.COMPLETED
    if getattr(project, "tasks_overdue", 0) or getattr(project, "tasks_blocked", 0):
        return ProjectHealth.AT_RISK
    total, done = getattr(project, "tasks_total", 0), getattr(project, "tasks_done", 0)
    start, end = project.start_date, project.end_date
    if total and start and end and start < today and start < end:
        gone = min(100, (today - start).days * 100 / (end - start).days)
        if done * 100 / total + BEHIND_POINTS < gone:
            return ProjectHealth.AT_RISK
    return ProjectHealth.ON_TRACK
