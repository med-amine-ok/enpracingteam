"""
What happens to a session and its attendance (decision D-013, knowledge base: meetings_design.md §2-4).
The views check who may act and when; these functions change the data and tell the people concerned.
"""

from datetime import timedelta

from django.utils import timezone
from django.utils.translation import gettext as _

from apps.communication import notify
from apps.members.models import Member, MemberStatus, Membership
from apps.tasks import workflow as task_workflow
from apps.tasks.models import Task, TaskAssignee

from .models import Attendance, AttendanceStatus, ExcuseStatus

CHECK_IN_OPENS = timedelta(minutes=15)  # before the start
ON_TIME = timedelta(minutes=10)  # after the start (Ranking System §4)
EXCUSE_DELAY = timedelta(days=7)  # after the end


def has_started(meeting, now=None):
    return (now or timezone.now()) >= meeting.starts_at


def check_in_open(meeting, now):
    return meeting.starts_at - CHECK_IN_OPENS <= now <= meeting.ends_at


def may_ask_excuse(meeting, now):
    return now <= meeting.ends_at + EXCUSE_DELAY


# --- Invitees ---


def invitees(meeting):
    """The active members of the invited unit and of the units below it (the whole team when there is
    none), alumni excepted."""
    # A subquery, not "memberships__end_date__isnull": that outer join would let in the accounts without
    # any membership (such as a technical admin).
    active = Membership.objects.filter(end_date__isnull=True)
    if meeting.org_unit_id is not None:
        active = active.filter(org_unit_id__in=meeting.org_unit.descendant_ids())
    return (
        Member.objects.filter(is_active=True, pk__in=active.values("member_id"))
        .exclude(status=MemberStatus.ALUMNI)
        .order_by("pk")
    )


def invite(meeting, members):
    """Invites `members` not invited yet; returns those newly invited."""
    already = set(meeting.attendances.values_list("member_id", flat=True))
    new = [member for member in members if member.pk not in already]
    Attendance.objects.bulk_create(Attendance(meeting=meeting, member=member) for member in new)
    return new


def reinvite(meeting):
    """After the invited unit changed (before the start): its people invited, the others no longer —
    unless they already checked in or asked for an excuse."""
    keep = list(invitees(meeting))
    meeting.attendances.exclude(member__in=keep).filter(
        checked_in_at__isnull=True, excuse_status=ExcuseStatus.NONE, status=AttendanceStatus.PENDING
    ).delete()
    return invite(meeting, keep)


# --- Attendance ---


def check_in(attendance, now):
    """« Je suis là »: on time up to 10 minutes after the start, late after."""
    attendance.checked_in_at = now
    on_time = now <= attendance.meeting.starts_at + ON_TIME
    attendance.status = AttendanceStatus.PRESENT if on_time else AttendanceStatus.LATE
    attendance.save(update_fields=["checked_in_at", "status"])


def confirm(meeting, actor, marks, now):
    """The organiser's list: `marks` ({member id: status}) as given; whoever is not marked and did not
    check in is absent. The first confirmation is dated; later ones are corrections."""
    for attendance in meeting.attendances.select_for_update():
        if attendance.member_id in marks:
            status = marks[attendance.member_id]
        elif attendance.status == AttendanceStatus.PENDING:
            status = AttendanceStatus.ABSENT
        else:
            continue
        attendance.status = status
        attendance.marked_by = actor
        attendance.marked_at = now
        attendance.save(update_fields=["status", "marked_by", "marked_at"])
    if meeting.attendance_confirmed_at is None:
        meeting.attendance_confirmed_at = now
        meeting.attendance_confirmed_by = actor
        meeting.save(update_fields=["attendance_confirmed_at", "attendance_confirmed_by", "updated_at"])


# --- Excuses ---


def ask_excuse(attendance, actor, reason, note, now):
    attendance.excuse_status = ExcuseStatus.REQUESTED
    attendance.excuse_reason = reason
    attendance.excuse_note = note
    attendance.excuse_requested_at = now
    attendance.excuse_decided_by = None
    attendance.excuse_decided_at = None
    attendance.excuse_decision_note = ""
    attendance.save()
    notify.excuse_requested(attendance, actor)


def decide_excuse(attendance, actor, accept, note, now):
    attendance.excuse_status = ExcuseStatus.ACCEPTED if accept else ExcuseStatus.REFUSED
    attendance.excuse_decided_by = actor
    attendance.excuse_decided_at = now
    attendance.excuse_decision_note = note
    attendance.save(update_fields=[
        "excuse_status", "excuse_decided_by", "excuse_decided_at", "excuse_decision_note",
    ])
    notify.excuse_decided(attendance, actor)


# --- Actions ---


def action_to_task(action, actor, project, *, may_set_due_date):
    """The action becomes a task of `project`, assigned to its responsible. Its due date is kept only when
    `actor` may set the dates of the project's tasks (decision D-012); else a leader sets them."""
    meeting = action.meeting
    first_line = action.description.strip().splitlines()[0] if action.description.strip() else meeting.title
    origin = _("From the session “%(meeting)s” of %(date)s.") % {
        "meeting": meeting.title, "date": timezone.localtime(meeting.starts_at).date().isoformat(),
    }
    task = Task.objects.create(
        project=project, title=first_line[:255], description=f"{action.description}\n\n{origin}",
        due_date=action.due_date if may_set_due_date else None, created_by=actor,
    )
    if action.responsible is not None:
        TaskAssignee.objects.create(task=task, member=action.responsible, is_primary=True)
    task_workflow.created(task, actor)
    action.task = task
    action.save(update_fields=["task"])
    notify.task_assigned(task, [action.responsible] if action.responsible else [], actor)
    return task
