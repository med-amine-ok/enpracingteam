"""
The weekly team report and the monthly performance report (decision D-014, "Team Manager – ERP
Requirements" §11), as data: the screens show it, exports.py turns it into a PDF or an Excel workbook.
They cover the whole team; their texts are in French or English only (the user's choice).
"""

from datetime import datetime, timedelta

from django.db.models import Count, Q
from django.utils import timezone, translation
from django.utils.translation import gettext as _

from apps.meetings.scores import presence_score
from apps.projects.models import Project
from apps.tasks.models import UNRESOLVED, Blocker, BlockerSeverity, Task, TaskStatus

from . import health

LANGUAGES = ("fr", "en")
WEEK_DAYS = 7


def task_row(task, today=None):
    people = [f"{row.member.first_name} {row.member.last_name}" for row in task.assignees.all()]
    unit = task.subsystem.org_unit if task.subsystem_id else task.project.org_unit
    row = {
        "id": task.pk, "title": task.title, "project": task.project.name, "department": unit.name if unit else "",
        "points": task.points, "quality_mark": task.quality_mark, "due_date": task.due_date, "people": people,
    }
    if today is not None and task.due_date is not None:
        row["days_late"] = (today - task.due_date).days
    return row


def with_people(tasks):
    return tasks.select_related("project__org_unit", "subsystem__org_unit").prefetch_related("assignees__member")


def blocker_row(blocker):
    return {
        "task": {"id": blocker.task_id, "title": blocker.task.title},
        "description": blocker.description, "severity": blocker.severity, "status": blocker.status,
        "reported_at": blocker.reported_at, "resolved_at": blocker.resolved_at,
    }


def is_major(blocker):
    """High or critical, or on a critical task."""
    return blocker.severity in (BlockerSeverity.HIGH, BlockerSeverity.CRITICAL) or (
        (blocker.task.points or 0) >= health.CRITICAL_POINTS
    )


def weekly(now, lang="fr"):
    """The last 7 days, and the priorities of the next 7."""
    today = timezone.localdate(now)
    start = now - timedelta(days=WEEK_DAYS)
    board = health.dashboard(now)
    tasks = Task.objects.all()
    risks = [row for row in board["warnings"] if row["severity"] == "red"]
    with translation.override(lang):
        title = _("Weekly team report")
    return {
        "kind": "weekly", "title": title, "language": lang,
        "start": timezone.localdate(start), "end": today, "generated_at": now,
        "overall": board["overall"], "indicators": board["indicators"],
        "achievements": [
            task_row(task) for task in with_people(
                tasks.filter(status=TaskStatus.VALIDATED, validated_at__gte=start)
            ).order_by("-validated_at", "pk")
        ],
        "delayed": [
            task_row(task, today) for task in with_people(health.overdue(tasks, today)).order_by("due_date", "pk")
        ],
        "critical_blockers": [
            blocker_row(blocker)
            for blocker in Blocker.objects.filter(status__in=UNRESOLVED).select_related("task").order_by("reported_at")
            if is_major(blocker)
        ],
        "attention": [
            row for row in board["members"] if row["status"] != "active" or row["overdue"] >= health.AT_RISK_OVERDUE
        ],
        "departments": board["departments"],
        "workload": [row for row in board["warnings"] if row["kind"] in ("workload", "knowledge_concentration")],
        "risks": risks,
        "priorities": [
            task_row(task) for task in with_people(
                health.not_done(tasks).filter(due_date__gt=today, due_date__lte=today + timedelta(days=WEEK_DAYS))
            ).order_by("-points", "due_date", "pk")
        ],
    }


def month_bounds(year, month):
    start = timezone.make_aware(datetime(year, month, 1))
    following = datetime(year + month // 12, month % 12 + 1, 1)
    return start, timezone.make_aware(following)


def monthly(year, month, now, lang="fr"):
    """One calendar month: what each member and department delivered, the trends week by week, the
    major blockers, the projects' progress and the risks of today."""
    start, end = month_bounds(year, month)
    until = min(end, now)
    validated = Task.objects.filter(status=TaskStatus.VALIDATED, validated_at__gte=start, validated_at__lt=end)
    members = []
    for row in health.member_statuses(now):
        member = row["member"]
        mine = validated.filter(assignees__member=member).distinct()
        delivered = sum((task.points or 0) * (task.quality_mark or 0) / 5 for task in mine)
        members.append({
            "member": health.summary(member), "units": row["units"], "status": row["status"],
            "validated": mine.count(), "delivered_points": round(delivered, 1),
            "presence": presence_score(member, start, end), "open_tasks": row["open_tasks"],
        })
    departments = []
    for unit in health.departments_in():
        ids = unit.descendant_ids()
        tasks = health.tasks_in(ids)
        done = validated.filter(pk__in=tasks.values("pk"))
        departments.append({
            "unit": {"id": unit.pk, "name": unit.name, "type": unit.type},
            "validated": done.count(),
            "delivered_points": round(sum((task.points or 0) * (task.quality_mark or 0) / 5 for task in done), 1),
            "overdue": health.overdue(tasks, timezone.localdate(now)).count(),
            "attendance_rate": health.attendance_rate(list(health.members_in(ids).values_list("pk", flat=True)),
                                                      start, end),
        })
    trends = []
    week = start
    team = list(health.members_in().values_list("pk", flat=True))
    while week < until:
        following = min(week + timedelta(days=WEEK_DAYS), end)
        trends.append({
            "start": timezone.localdate(week),
            "attendance_rate": health.attendance_rate(team, week, following),
            "validated": validated.filter(validated_at__gte=week, validated_at__lt=following).count(),
            "created": Task.objects.filter(created_at__gte=week, created_at__lt=following).count(),
        })
        week = following
    blockers = Blocker.objects.filter(
        Q(reported_at__gte=start, reported_at__lt=end) | Q(resolved_at__gte=start, resolved_at__lt=end)
        | Q(status__in=UNRESOLVED, reported_at__lt=end)
    ).select_related("task").order_by("reported_at")
    projects = []
    for project in Project.objects.annotate(
        total=Count("tasks"), done=Count("tasks", filter=Q(tasks__status=TaskStatus.VALIDATED))
    ).order_by("name"):
        if project.total:
            projects.append({
                "project": {"id": project.pk, "name": project.name}, "tasks": project.total,
                "validated": project.done, "progress": round(project.done / project.total * 100, 1),
            })
    with translation.override(lang):
        title = _("Monthly performance report")
    return {
        "kind": "monthly", "title": title, "language": lang, "month": f"{year:04d}-{month:02d}",
        "start": timezone.localdate(start), "end": timezone.localdate(end - timedelta(seconds=1)),
        "generated_at": now,
        "members": members, "departments": departments, "trends": trends,
        "major_blockers": [blocker_row(blocker) for blocker in blockers if is_major(blocker)],
        "projects": projects,
        "risks": [row for row in health.warnings(now, None, health.member_statuses(now)) if row["severity"] == "red"],
    }
