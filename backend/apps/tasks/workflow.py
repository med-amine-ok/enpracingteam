"""
The steps of a task and its blockers (knowledge base: PROJECTS/ERP/tasks_v2_design.md, decision D-012):

    Planned → In progress → Submitted → Validated, or Needs revision → Submitted again

Each function changes the task, writes its history (TaskEvent: the task's page, and the update rate
of the monthly ranking) and tells the people concerned (apps/communication/notify.py). The views call
them inside a transaction, after checking the rights (apps/projects/access.py) and the status.
"""

from datetime import timedelta

from django.utils import timezone

from apps.communication import notify

from .models import Blocker, BlockerStatus, TaskComment, TaskEvent, TaskEventKind as Event, TaskLink, TaskStatus

# Friday and Saturday (date.weekday(): Monday is 0): the working week runs from Sunday to Thursday in
# Algeria.
WEEKEND = {4, 5}
# A blocker is late when declared more than this many working days after it became known.
LATE_AFTER_WORKING_DAYS = 2
ESTIMATE_FIELDS = ("points", "start_date", "due_date")


def working_days_between(start, end):
    """The working days after `start`, up to `end` included."""
    days, day = 0, start
    while day < end:
        day += timedelta(days=1)
        if day.weekday() not in WEEKEND:
            days += 1
    return days


def record(task, kind, actor, **data):
    return TaskEvent.objects.create(task=task, kind=kind, actor=actor, data=data)


def estimate_data(task):
    return {field: None if getattr(task, field) is None else str(getattr(task, field)) for field in ESTIMATE_FIELDS}


def is_ready(task):
    """A scored task starts with its points, its start date and its due date set by a leader."""
    return not task.scored or all(getattr(task, field) is not None for field in ESTIMATE_FIELDS)


def created(task, actor):
    record(task, Event.CREATED, actor)
    if any(getattr(task, field) is not None for field in ESTIMATE_FIELDS):
        record(task, Event.ESTIMATED, actor, **estimate_data(task))


def start(task, actor):
    task.status = TaskStatus.IN_PROGRESS
    task.started_at = timezone.now()
    task.initial_due_date = task.due_date
    task.save(update_fields=["status", "started_at", "initial_due_date", "updated_at"])
    record(task, Event.STARTED, actor)


def add_link(task, actor, url, label="", link_type="other"):
    link = TaskLink.objects.create(task=task, added_by=actor, url=url, label=label, link_type=link_type)
    record(task, Event.LINK_ADDED, actor, url=url, label=label)
    return link


def submit(task, actor, actual_deliverable, evidence=None):
    """`evidence`: a link to add as its proof ({url, label, link_type}), if the task has none yet."""
    if evidence:
        add_link(task, actor, **evidence)
    task.actual_deliverable = actual_deliverable
    task.status = TaskStatus.SUBMITTED
    task.submitted_at = timezone.now()
    task.save(update_fields=["actual_deliverable", "status", "submitted_at", "updated_at"])
    record(task, Event.SUBMITTED, actor)
    notify.task_submitted(task, actor)


def validate(task, actor, quality_mark):
    task.status = TaskStatus.VALIDATED
    task.quality_mark = quality_mark
    task.validated_by = actor
    task.validated_at = timezone.now()
    task.save(update_fields=["status", "quality_mark", "validated_by", "validated_at", "updated_at"])
    record(task, Event.VALIDATED, actor, quality_mark=quality_mark)
    notify.task_validated(task, actor)


def revise(task, actor, comment):
    """Sent back for revision: what to rework is written as a comment of the task."""
    TaskComment.objects.create(task=task, author=actor, content=comment)
    task.status = TaskStatus.NEEDS_REVISION
    task.quality_mark = None
    task.save(update_fields=["status", "quality_mark", "updated_at"])
    record(task, Event.REVISION, actor, comment=notify.excerpt(comment))
    notify.task_revision(task, actor, comment)


def declare_blocker(task, actor, data):
    today = timezone.localdate()
    known_since = data.pop("known_since", None) or today
    blocker = Blocker.objects.create(
        task=task, reported_by=actor, known_since=known_since,
        is_late=working_days_between(known_since, today) > LATE_AFTER_WORKING_DAYS, **data,
    )
    record(task, Event.BLOCKER_DECLARED, actor, blocker=blocker.pk, severity=blocker.severity)
    notify.blocker_declared(blocker, actor)
    return blocker


def decide_blocker(blocker, actor, accept, note=""):
    """Validated: the task's due date is frozen until the blocker is resolved. Rejected: nothing moves."""
    blocker.status = BlockerStatus.VALIDATED if accept else BlockerStatus.REJECTED
    blocker.decided_by = actor
    blocker.decided_at = timezone.now()
    blocker.decision_note = note
    blocker.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
    record(
        blocker.task, Event.BLOCKER_VALIDATED if accept else Event.BLOCKER_REJECTED, actor, blocker=blocker.pk,
    )
    notify.blocker_updated(blocker, actor)


def resolve_blocker(blocker, actor, resolution):
    """Resolved. A validated blocker moves the task's due date by the days it lasted, so that the delay
    is not counted against its people."""
    was_validated = blocker.status == BlockerStatus.VALIDATED
    blocker.status = BlockerStatus.RESOLVED
    blocker.resolved_at = timezone.now()
    blocker.resolution = resolution
    blocker.save(update_fields=["status", "resolved_at", "resolution"])
    task = blocker.task
    record(task, Event.BLOCKER_RESOLVED, actor, blocker=blocker.pk)
    if was_validated and task.due_date is not None and blocker.decided_at is not None:
        days = (timezone.localdate() - timezone.localtime(blocker.decided_at).date()).days
        if days > 0:
            before = task.due_date
            task.due_date = before + timedelta(days=days)
            task.initial_due_date = task.initial_due_date or before
            task.save(update_fields=["due_date", "initial_due_date", "updated_at"])
            record(task, Event.DEADLINE_MOVED, actor, before=str(before), after=str(task.due_date), days=days)
    notify.blocker_updated(blocker, actor)
