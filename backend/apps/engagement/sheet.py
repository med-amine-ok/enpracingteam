"""
The full member sheet (Team Manager – ERP Requirements §2, decision D-019): who the member is, how active they are,
their goals, tasks, attendance, contributions, warnings, trainings and volunteering of the season. Read from the
other modules; seen by the member, their heads, the Team Manager and the Bureau (access.py).
"""

from datetime import date, datetime, time, timedelta

from django.utils import timezone

from apps.discipline.models import MemberWarning, season_of
from apps.meetings.scores import counted_attendances, presence_score
from apps.ranking.models import ContributionPoint, ContributionStatus, MonthlyScore
from apps.reporting.health import member_statuses, overdue
from apps.tasks.models import Task, TaskStatus

from . import workflow
from .models import Objective

CURRENT_TASKS = 10
RECENT_SESSIONS = 5
PUBLISHED_MONTHS = 6
VALIDATED_DAYS = 30


def aware(day):
    return timezone.make_aware(datetime.combine(day, time.min))


def member_sheet(member, now=None):
    now = now or timezone.now()
    today = timezone.localdate(now)
    season = season_of(today)
    season_start = date(season, 9, 1)

    unit_ids = list(member.memberships.filter(end_date__isnull=True).values_list("org_unit_id", flat=True))
    health = next((row for row in member_statuses(now, unit_ids) if row["member"].pk == member.pk), None) if unit_ids \
        else None

    tasks = Task.objects.filter(assignees__member=member).distinct()
    open_tasks = tasks.exclude(status=TaskStatus.VALIDATED)
    late = set(overdue(open_tasks, today).values_list("pk", flat=True))
    current = [
        {"id": task.pk, "title": task.title, "status": task.status, "due_date": task.due_date,
         "overdue": task.pk in late}
        for task in open_tasks.order_by("due_date", "pk")[:CURRENT_TASKS]
    ]

    recent = sorted(
        counted_attendances(member, aware(season_start), now), key=lambda row: row.meeting.starts_at, reverse=True
    )[:RECENT_SESSIONS]

    points = ContributionPoint.objects.filter(
        member=member, status=ContributionStatus.VALIDATED, occurred_on__gte=season_start
    ).values_list("points", flat=True)
    scores = MonthlyScore.objects.filter(member=member).select_related("publication").order_by(
        "-publication__month"
    )[:PUBLISHED_MONTHS]

    activities = member.volunteering.filter(date__gte=season_start).select_related("organiser")
    return {
        "member": member,
        "season": season,
        "health": {
            "status": health["status"] if health else None,
            "last_activity": health["last_activity"] if health else None,
            "idle_days": health["idle_days"] if health else None,
        },
        "objectives": Objective.objects.filter(member=member, season=season).select_related(
            "member", "set_by", "assessed_by"
        ),
        "tasks": {
            "open": open_tasks.count(),
            "overdue": len(late),
            "validated_recently": tasks.filter(
                status=TaskStatus.VALIDATED, validated_at__gte=now - timedelta(days=VALIDATED_DAYS)
            ).count(),
            "current": current,
        },
        "presence": {
            "month": presence_score(member, aware(today.replace(day=1)), now),
            "season": presence_score(member, aware(season_start), now),
            "recent": [
                {"id": row.meeting.pk, "title": row.meeting.title, "starts_at": row.meeting.starts_at,
                 "status": row.status}
                for row in recent
            ],
        },
        "contributions": {
            "season_points": sum(points),
            "scores": [
                {"month": score.publication.month.strftime("%Y-%m"), "final": score.final, "category": score.category,
                 "rank": score.rank}
                for score in scores
            ],
        },
        "warnings": [
            {"id": warning.pk, "level": warning.level, "ground": warning.ground, "issued_at": warning.issued_at,
             "status": warning.status}
            for warning in MemberWarning.objects.filter(member=member, season=season)
        ],
        "trainings": member.trainings.select_related("member", "session", "updated_by"),
        "volunteering": {
            "activities": [
                {"id": activity.pk, "title": activity.title, "kind": activity.kind, "date": activity.date,
                 "status": activity.status}
                for activity in activities
            ],
            "months_covered": workflow.months_covered(member, season),
        },
    }
