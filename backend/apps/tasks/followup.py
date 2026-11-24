"""
The follow-up of a task as a work order (the team's Figma, decision D-022): how far it is, and its health.

- The progress: 100 once delivered (submitted or validated); with subtasks, the share of them validated;
  else the figure its people give (Task.progress).
- The health, from the most urgent: delivered on time or late; overdue; at risk (a blocker not resolved
  yet); due within a week; at risk (more than 15 points behind the share of its time gone); on track.
"""

import re

from django.db.models import Q, TextChoices
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy

from .models import TaskStatus

DELIVERED = (TaskStatus.SUBMITTED, TaskStatus.VALIDATED)
DUE_SOON_DAYS = 7
BEHIND_POINTS = 15


class Health(TextChoices):
    ON_TRACK = "on_track", _("On track")
    AT_RISK = "at_risk", _("At risk")
    DUE_SOON = "due_soon", _("Due soon")
    OVERDUE = "overdue", pgettext_lazy("task health", "Overdue")
    DONE_ON_TIME = "done_on_time", _("Delivered on time")
    DONE_LATE = "done_late", _("Delivered late")


class ProgressMode(TextChoices):
    MANUAL = "manual", _("Given by its people")
    AUTOMATIC = "automatic", _("From its subtasks")


def subtasks_of(task):
    """(total, validated): the view's annotations, or counted."""
    total = getattr(task, "subtasks_total", None)
    if total is None:
        total = task.subtasks.count()
        return total, task.subtasks.filter(status=TaskStatus.VALIDATED).count()
    return total, task.subtasks_done


def progress_mode(task):
    return ProgressMode.AUTOMATIC if subtasks_of(task)[0] else ProgressMode.MANUAL


def progress(task):
    if task.status in DELIVERED:
        return 100
    total, done = subtasks_of(task)
    if total:
        return round(done * 100 / total)
    return task.progress


def health(task, today, overdue, blocked):
    """`overdue` and `blocked` as the task's list says them (is_overdue, is_blocked)."""
    if task.status in DELIVERED:
        delivered = task.submitted_at or task.validated_at
        late = task.due_date and delivered and timezone.localtime(delivered).date() > task.due_date
        return Health.DONE_LATE if late else Health.DONE_ON_TIME
    if overdue:
        return Health.OVERDUE
    if blocked:
        return Health.AT_RISK
    due = task.due_date
    if due and (due - today).days <= DUE_SOON_DAYS:
        return Health.DUE_SOON
    start = task.start_date or (timezone.localtime(task.started_at).date() if task.started_at else None)
    if start and due and start < today and start < due:
        expected = min(100, (today - start).days * 100 / (due - start).days)
        if progress(task) + BEHIND_POINTS < expected:
            return Health.AT_RISK
    return Health.ON_TRACK


REFERENCE = re.compile(r"^\s*([A-Za-z0-9]+)-0*(\d+)\s*$")


def reference_filter(text):
    """The filter of the task a reference names ("EV27-007", or "P12-7" for a project without its key), or
    None when the text is not a reference."""
    match = REFERENCE.match(text)
    if not match:
        return None
    prefix, number = match.group(1).upper(), int(match.group(2))
    project = Q(project__key=prefix)
    if (generic := re.fullmatch(r"P(\d+)", prefix)) is not None:  # kept once the project has its key
        project |= Q(project_id=int(generic.group(1)))
    return project & Q(number=number)
