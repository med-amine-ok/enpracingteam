"""
The Team Manager's dashboard (decision D-014, knowledge base: PROJECTS/ERP/team_dashboard_design.md):
the members' status, the indicators with their colours, the early warnings and the departments.

`unit_ids`: the units of a department's view (a leader's); None: the whole team.
"""

from collections import defaultdict
from datetime import timedelta
from statistics import median

from django.db.models import Max, Q
from django.utils import timezone

from apps.meetings.models import Attendance, ExcuseStatus, MeetingStatus
from apps.meetings.scores import STATUS_VALUES
from apps.members.models import Member, MemberStatus, Membership, OrgUnit, OrgUnitType
from apps.purchasing.models import PurchaseRequest
from apps.tasks.models import (
    OPEN_STATUSES, UNRESOLVED, Blocker, BlockerStatus, Task, TaskAssignee, TaskComment, TaskEvent, TaskStatus,
)

INACTIVE_DAYS = 14  # without activity: inactive
AT_RISK_DAYS = 7  # without activity: at risk
AT_RISK_OVERDUE = 2  # overdue tasks: at risk
PERIOD_DAYS = 30  # the attendance and completion rates, the tasks validated
CRITICAL_POINTS = 4  # "Critical" and "Project-critical" (Ranking System §3)
IMPORTANT_POINTS = 3
DEADLINE_CLOSE_DAYS = 3
CONCENTRATION_TASKS = 3  # critical tasks led by one person
WORKLOAD_FACTOR = 1.5  # open points above the team's median...
WORKLOAD_MIN_POINTS = 8  # ...and above this
DEPARTMENT_TYPES = (OrgUnitType.FS_DEPARTMENT, OrgUnitType.CLUB_DEPARTMENT)

# The colours: for a count or a share, (green up to, orange up to); for a rate in %, (green from, orange
# from). One place to change them.
THRESHOLDS = {
    "inactive_share": (0, 0.25),
    "overdue_tasks": (0, 3),
    "blocked_tasks": (0, 2),
    "without_objectives_share": (0.10, 0.25),
    "unresolved_blockers": (0, 3),
    "attendance_rate": (80, 60),
    "completion_rate": (80, 60),
}
GRAVITY = {"neutral": 0, "green": 0, "orange": 1, "red": 2}
KIND_ORDER = [
    "critical_blocked", "department_overdue_critical", "member_inactive", "member_overdue", "member_at_risk",
    "knowledge_concentration", "workload", "deadline_close",
]


def at_most(value, key):
    """Lower is better (a count, a share)."""
    if value is None:
        return "neutral"
    green, orange = THRESHOLDS[key]
    return "green" if value <= green else "orange" if value <= orange else "red"


def at_least(value, key):
    """Higher is better (a rate in %)."""
    if value is None:
        return "neutral"
    green, orange = THRESHOLDS[key]
    return "green" if value >= green else "orange" if value >= orange else "red"


def worst(statuses):
    coloured = [status for status in statuses if status != "neutral"]
    return max(coloured, key=GRAVITY.__getitem__) if coloured else "neutral"


def summary(member):
    return {"id": member.pk, "first_name": member.first_name, "last_name": member.last_name}


# --- What is in the scope ---


def members_in(unit_ids=None):
    """The active members (an active account, a membership in progress, alumni excepted)."""
    active = Membership.objects.filter(end_date__isnull=True)
    if unit_ids is not None:
        active = active.filter(org_unit_id__in=unit_ids)
    return (
        Member.objects.filter(is_active=True, pk__in=active.values("member_id"))
        .exclude(status=MemberStatus.ALUMNI)
        .order_by("first_name", "last_name", "pk")
    )


def tasks_in(unit_ids=None):
    """A task belongs to the unit of its subsystem, else to the unit of its project."""
    tasks = Task.objects.all()
    if unit_ids is not None:
        tasks = tasks.filter(
            Q(subsystem__org_unit_id__in=unit_ids) | Q(subsystem__isnull=True, project__org_unit_id__in=unit_ids)
        )
    return tasks


def not_done(tasks):
    return tasks.exclude(status=TaskStatus.VALIDATED)


def overdue(tasks, today):
    """Past their due date, not submitted nor validated, and no validated blocker freezing them."""
    frozen = Blocker.objects.filter(status=BlockerStatus.VALIDATED).values("task_id")
    return tasks.filter(status__in=OPEN_STATUSES, due_date__lt=today).exclude(pk__in=frozen)


def blocked(tasks):
    return tasks.filter(pk__in=Blocker.objects.filter(status__in=UNRESOLVED).values("task_id"))


def critical(tasks):
    return not_done(tasks).filter(points__gte=CRITICAL_POINTS)


def attendance_rate(member_ids, start, end):
    """The presence of these members at the mandatory, confirmed sessions starting in [start, end), as
    the presence score counts it (Ranking System §4); None when there was none."""
    rows = (
        Attendance.objects.filter(
            member_id__in=member_ids, meeting__is_mandatory=True, meeting__status=MeetingStatus.PLANNED,
            meeting__attendance_confirmed_at__isnull=False, meeting__starts_at__gte=start,
            meeting__starts_at__lt=end, status__in=list(STATUS_VALUES),
        )
        .exclude(excuse_status=ExcuseStatus.ACCEPTED)
        .select_related("meeting")
    )
    total = earned = 0.0
    for row in rows:
        total += row.meeting.weight
        earned += row.meeting.weight * STATUS_VALUES[row.status]
    return round(earned / total * 100, 1) if total else None


def completion_rate(tasks, today):
    """The share of the tasks due in the last 30 days that are validated; None when none was due."""
    due = tasks.filter(due_date__gt=today - timedelta(days=PERIOD_DAYS), due_date__lte=today)
    count = due.count()
    return round(due.filter(status=TaskStatus.VALIDATED).count() / count * 100, 1) if count else None


# --- Members ---


def last_activities(member_ids):
    """Each member's latest action: a task event, a comment, a check-in, a purchase request."""
    found = {}
    sources = [
        (TaskEvent.objects.filter(actor_id__in=member_ids), "actor_id", "created_at"),
        (TaskComment.objects.filter(author_id__in=member_ids), "author_id", "created_at"),
        (Attendance.objects.filter(member_id__in=member_ids, checked_in_at__isnull=False), "member_id",
         "checked_in_at"),
        (PurchaseRequest.objects.filter(requested_by_id__in=member_ids), "requested_by_id", "created_at"),
    ]
    for rows, key, moment in sources:
        for row in rows.values(key).annotate(last=Max(moment)):
            current = found.get(row[key])
            if current is None or row["last"] > current:
                found[row[key]] = row["last"]
    return found


def member_statuses(now, unit_ids=None):
    """Each member: inactive (no activity for 14 days), at risk (for 7 days, or 2 overdue tasks or more) or
    active, with their open work. A member who arrived less than 14 days ago is never inactive."""
    today = timezone.localdate(now)
    members = list(members_in(unit_ids))
    ids = [member.pk for member in members]
    activity = last_activities(ids)
    late = set(overdue(Task.objects.all(), today).values_list("pk", flat=True))
    work = defaultdict(lambda: {"open_tasks": 0, "open_points": 0, "overdue": 0, "critical_main": 0})
    rows = TaskAssignee.objects.filter(member_id__in=ids).exclude(task__status=TaskStatus.VALIDATED)
    for row in rows.select_related("task"):
        mine = work[row.member_id]
        mine["open_tasks"] += 1
        mine["open_points"] += row.task.points or 0
        mine["overdue"] += row.task_id in late
        mine["critical_main"] += row.is_primary and (row.task.points or 0) >= CRITICAL_POINTS
    units = defaultdict(list)
    for member_id, name in (
        Membership.objects.filter(member_id__in=ids, end_date__isnull=True)
        .order_by("org_unit__name").values_list("member_id", "org_unit__name")
    ):
        if name not in units[member_id]:
            units[member_id].append(name)

    result = []
    for member in members:
        last = activity.get(member.pk)
        idle = (now - last) if last else None
        new = member.join_date is not None and (today - member.join_date).days < INACTIVE_DAYS
        figures = work[member.pk]
        if not new and (idle is None or idle >= timedelta(days=INACTIVE_DAYS)):
            status = "inactive"
        elif figures["overdue"] >= AT_RISK_OVERDUE or (idle is not None and idle >= timedelta(days=AT_RISK_DAYS)):
            status = "at_risk"
        else:
            status = "active"
        result.append({
            "member": member, "status": status, "last_activity": last, "units": units[member.pk],
            "idle_days": idle.days if idle else None, **figures,
        })
    return result


# --- Indicators, warnings, departments ---


def without_goals(member_ids, today):
    """The members without a goal in progress this season (decision D-019)."""
    from apps.discipline.models import season_of
    from apps.engagement.models import Objective, ObjectiveStatus

    with_goal = set(Objective.objects.filter(
        member_id__in=member_ids, season=season_of(today), status=ObjectiveStatus.IN_PROGRESS
    ).values_list("member_id", flat=True))
    return [member_id for member_id in member_ids if member_id not in with_goal]


def indicators(now, unit_ids, statuses):
    today = timezone.localdate(now)
    tasks = tasks_in(unit_ids)
    members = len(statuses)
    flagged = sum(1 for row in statuses if row["status"] != "active")
    without = len(without_goals([row["member"].pk for row in statuses], today))
    share = lambda count: count / members if members else None  # noqa: E731
    attendance = attendance_rate([row["member"].pk for row in statuses], now - timedelta(days=PERIOD_DAYS), now)
    completion = completion_rate(tasks, today)
    late = overdue(tasks, today).count()
    stuck = blocked(not_done(tasks)).count()
    blockers = Blocker.objects.filter(task__in=tasks, status__in=UNRESOLVED).count()
    return {
        "active_members": {"value": members, "total": None, "status": "neutral"},
        "inactive_members": {
            "value": flagged, "total": members, "status": at_most(share(flagged), "inactive_share"),
        },
        "attendance_rate": {"value": attendance, "total": None, "status": at_least(attendance, "attendance_rate")},
        "completion_rate": {"value": completion, "total": None, "status": at_least(completion, "completion_rate")},
        "overdue_tasks": {"value": late, "total": None, "status": at_most(late, "overdue_tasks")},
        "blocked_tasks": {"value": stuck, "total": None, "status": at_most(stuck, "blocked_tasks")},
        "critical_tasks": {"value": critical(tasks).count(), "total": None, "status": "neutral"},
        "members_without_objectives": {
            "value": without, "total": members, "status": at_most(share(without), "without_objectives_share"),
        },
        "unresolved_blockers": {"value": blockers, "total": None, "status": at_most(blockers, "unresolved_blockers")},
    }


def warning(kind, severity, *, member=None, task=None, department=None, count=None, days=None):
    return {
        "kind": kind, "severity": severity,
        "member": summary(member) if member is not None else None,
        "task": {"id": task.pk, "title": task.title} if task is not None else None,
        "department": {"id": department.pk, "name": department.name} if department is not None else None,
        "count": count, "days": days,
    }


def departments_in(unit_ids=None):
    units = OrgUnit.objects.filter(type__in=DEPARTMENT_TYPES, is_active=True)
    if unit_ids is not None:
        units = units.filter(pk__in=unit_ids)
    return list(units.order_by("name"))


def warnings(now, unit_ids, statuses):
    """The early warnings (§5), the reds first."""
    today = timezone.localdate(now)
    tasks = tasks_in(unit_ids)
    found = []
    for row in statuses:
        member = row["member"]
        if row["status"] == "inactive":
            found.append(warning("member_inactive", "red", member=member, days=row["idle_days"]))
        elif row["status"] == "at_risk":
            found.append(warning("member_at_risk", "orange", member=member, days=row["idle_days"]))
        if row["overdue"] >= AT_RISK_OVERDUE:
            severity = "red" if row["overdue"] > AT_RISK_OVERDUE else "orange"
            found.append(warning("member_overdue", severity, member=member, count=row["overdue"]))
        if row["critical_main"] >= CONCENTRATION_TASKS:
            found.append(warning("knowledge_concentration", "orange", member=member, count=row["critical_main"]))
    loads = [row["open_points"] for row in statuses]
    middle = median(loads) if loads else 0
    for row in statuses:
        if row["open_points"] > WORKLOAD_MIN_POINTS and row["open_points"] > WORKLOAD_FACTOR * middle:
            found.append(warning("workload", "orange", member=row["member"], count=row["open_points"]))
    for task in blocked(critical(tasks)).order_by("due_date", "pk"):
        found.append(warning("critical_blocked", "red", task=task))
    for unit in departments_in(unit_ids):
        count = overdue(critical(tasks_in(unit.descendant_ids())), today).count()
        if count >= 2:
            found.append(warning("department_overdue_critical", "red", department=unit, count=count))
    close = tasks.filter(
        status__in=OPEN_STATUSES, points__gte=IMPORTANT_POINTS, due_date__gte=today,
        due_date__lte=today + timedelta(days=DEADLINE_CLOSE_DAYS),
    )
    for task in close.order_by("due_date", "pk"):
        found.append(warning("deadline_close", "orange", task=task, days=(task.due_date - today).days))

    def label(row):
        return (row["member"] or {}).get("first_name") or (row["task"] or {}).get("title") or ""

    return sorted(found, key=lambda row: (-GRAVITY[row["severity"]], KIND_ORDER.index(row["kind"]), label(row)))


def department_rows(now, unit_ids=None):
    """Each department (§7), with the units below it."""
    today = timezone.localdate(now)
    rows = []
    for unit in departments_in(unit_ids):
        ids = unit.descendant_ids()
        tasks = tasks_in(ids)
        late = overdue(tasks, today).count()
        blockers = Blocker.objects.filter(task__in=tasks, status__in=UNRESOLVED).count()
        members = list(members_in(ids).values_list("pk", flat=True))
        attendance = attendance_rate(members, now - timedelta(days=PERIOD_DAYS), now)
        rows.append({
            "unit": {"id": unit.pk, "name": unit.name, "type": unit.type},
            "members": len(members),
            "validated": tasks.filter(
                status=TaskStatus.VALIDATED, validated_at__gte=now - timedelta(days=PERIOD_DAYS)
            ).count(),
            "in_progress": not_done(tasks).count(),
            "overdue": late,
            "critical": critical(tasks).count(),
            "blockers": blockers,
            "attendance_rate": attendance,
            "status": worst([
                at_most(late, "overdue_tasks"), at_most(blockers, "blocked_tasks"),
                at_least(attendance, "attendance_rate"),
            ]),
        })
    return rows


def dashboard(now, unit_ids=None):
    statuses = member_statuses(now, unit_ids)
    figures = indicators(now, unit_ids, statuses)
    return {
        "scope": "team" if unit_ids is None else "department",
        "generated_at": now,
        "overall": worst([indicator["status"] for indicator in figures.values()]),
        "indicators": figures,
        "warnings": warnings(now, unit_ids, statuses),
        "departments": department_rows(now, unit_ids),
        "members": [
            {
                "member": summary(row["member"]), "status": row["status"], "last_activity": row["last_activity"],
                "units": row["units"], "overdue": row["overdue"], "open_tasks": row["open_tasks"],
                "open_points": row["open_points"],
            }
            for row in statuses
        ],
    }
