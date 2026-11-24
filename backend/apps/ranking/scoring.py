"""
The monthly score of the Ranking System (decision D-017, knowledge base: PROJECTS/ERP/ranking_design.md):

    Final score = 0.55 × Delivery + 0.15 × Presence + 0.15 × Reliability + 0.15 × Team contribution

Every part is out of 100, None when it is not calculable (its weight then goes to the others and the score is
"provisional"). Computed on demand from the records of the month; the Team Manager publishes it (workflow.py).
"""

import math
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from django.utils import timezone

from apps.meetings.scores import presence_score
from apps.members.models import Member, Membership, MemberStatus, OrgUnitType
from apps.tasks.models import Blocker, BlockerStatus, Task, TaskEvent, TaskEventKind, TaskStatus

from .models import Category, ContributionPoint, ContributionStatus, MonthlyAssessment, MonthlyScore

WEIGHTS = {"delivery": 0.55, "presence": 0.15, "reliability": 0.15, "team": 0.15}
DEPARTMENT_TYPES = (OrgUnitType.FS_DEPARTMENT, OrgUnitType.CLUB_DEPARTMENT)
MIN_PLANNED_DAYS = 7  # §3.2 "Short tasks": lateness is measured on 7 days at least
EARLY_SHARE = 0.15  # §3.2 early: before the deadline by 15 % of the planned duration (1 day at least)
NOT_DELIVERED_LATENESS = 0.5  # §1.1 open at month end and late by more than 50 %
SMALL_DEPARTMENT = 4  # §3.4 fewer members: the team-wide median
CONTRIBUTION_POINTS_FULL = 6  # §6 Points score = points ÷ 6 × 100
UNPROVEN_EFFORT_MAX = 2  # §6.4 effort without evidence
CATEGORY_A_LOAD = 60  # §7.2 category A needs an average Load score of 60
RANKING_MONTHS = 3  # §1.1 the last three calculable monthly scores
# §5.2 a meaningful update: the member's own action on a task.
MEANINGFUL = (
    TaskEventKind.STARTED, TaskEventKind.SUBMITTED, TaskEventKind.BLOCKER_DECLARED, TaskEventKind.BLOCKER_RESOLVED,
    TaskEventKind.COMMENTED, TaskEventKind.LINK_ADDED, TaskEventKind.PROGRESS,
)


# --- Months ---


@dataclass(frozen=True)
class Month:
    first: date
    last: date

    @property
    def start(self):
        return timezone.make_aware(datetime.combine(self.first, time.min))

    @property
    def end(self):
        """The first moment after the month."""
        return timezone.make_aware(datetime.combine(self.last + timedelta(days=1), time.min))

    @property
    def key(self):
        return self.first.strftime("%Y-%m")

    def previous(self):
        return month_of(self.first - timedelta(days=1))

    def weeks(self):
        """Its weeks, Sunday to Saturday (the Algerian working week starts on Sunday), cut to the month."""
        start = self.first - timedelta(days=(self.first.weekday() + 1) % 7)
        while start <= self.last:
            yield max(start, self.first), min(start + timedelta(days=6), self.last)
            start += timedelta(days=7)


def month_of(day):
    first = day.replace(day=1)
    following = (first + timedelta(days=32)).replace(day=1)
    return Month(first, following - timedelta(days=1))


def parse_month(text):
    """"2026-10" → Month; ValueError when malformed."""
    year, month = text.split("-")
    return month_of(date(int(year), int(month), 1))


def local_day(moment):
    return timezone.localdate(moment) if moment else None


def round1(value):
    return None if value is None else round(value, 1)


# --- Delivery (§3) ---


def frozen_at(task, moment):
    """A validated blocker froze the task's due date at this moment."""
    for blocker in task.blockers.all():
        if blocker.decided_at is None or blocker.status not in (BlockerStatus.VALIDATED, BlockerStatus.RESOLVED):
            continue
        if blocker.decided_at <= moment and (blocker.resolved_at is None or blocker.resolved_at > moment):
            return True
    return False


def planned_days(task):
    """From its start to its due date before any blocker moved it."""
    due = task.initial_due_date or task.due_date
    if task.start_date and due:
        return max(1, (due - task.start_date).days)
    return None


def timing_factor(task, quality):
    """§3.2, from its last submission."""
    submitted_at = task.submitted_at or task.validated_at
    if submitted_at is None or task.due_date is None or frozen_at(task, submitted_at):
        return 1.0
    planned = planned_days(task)
    late = (local_day(submitted_at) - task.due_date).days
    if late <= 0:
        early_by = max(1, EARLY_SHARE * (planned or MIN_PLANNED_DAYS))
        return 1.1 if -late >= early_by and quality >= 4 else 1.0
    ratio = late / max(MIN_PLANNED_DAYS, planned or 0)
    if ratio <= 0.25:
        return 0.8
    if ratio <= 0.5:
        return 0.5
    return 0.2


def not_delivered_month(task):
    """The month at whose end the task was still open and late by more than 50 % (§1.1), or None."""
    if task.due_date is None:
        return None
    planned = max(MIN_PLANNED_DAYS, planned_days(task) or 0)
    threshold = task.due_date + timedelta(days=math.floor(planned * NOT_DELIVERED_LATENESS) + 1)
    month = month_of(threshold)
    validated = local_day(task.validated_at) if task.status == TaskStatus.VALIDATED else None
    if validated is not None and validated <= month.last:
        return None
    if frozen_at(task, month.end):
        return None
    return month


@dataclass
class TaskEntry:
    task: Task
    quality: int
    timing: float
    not_delivered: bool

    @property
    def score(self):
        return self.quality / 5 * self.timing

    def as_dict(self):
        return {
            "id": self.task.pk, "title": self.task.title, "points": self.task.points, "quality": self.quality,
            "timing": self.timing, "not_delivered": self.not_delivered,
        }


def task_entries(tasks, month):
    """The tasks a member is scored on in the month."""
    entries = []
    for task in tasks:
        late_month = not_delivered_month(task)
        if late_month is not None:
            if late_month == month:
                if task.status == TaskStatus.VALIDATED:  # delivered since: its real score, timing 0.2
                    entries.append(TaskEntry(task, task.quality_mark or 0, 0.2, False))
                else:
                    entries.append(TaskEntry(task, 0, 0.0, True))
            continue
        validated = local_day(task.validated_at) if task.status == TaskStatus.VALIDATED else None
        if validated is not None and month.first <= validated <= month.last:
            quality = task.quality_mark or 0
            entries.append(TaskEntry(task, quality, timing_factor(task, quality), False))
    return entries


def scored_tasks_by_member(member_ids):
    """The tasks that can be scored (scored, with points), for each of their assignees."""
    tasks = (
        Task.objects.filter(scored=True, points__isnull=False, assignees__member_id__in=member_ids)
        .prefetch_related("blockers", "assignees")
        .distinct()
    )
    by_member = {member_id: [] for member_id in member_ids}
    for task in tasks:
        for assignee in task.assignees.all():
            if assignee.member_id in by_member:
                by_member[assignee.member_id].append(task)
    return by_member


# --- Departments ---


def department_of(member):
    """The department of the member's main membership (or of any), climbing the units; None if none."""
    memberships = sorted(
        member.memberships.all(), key=lambda membership: (not membership.is_primary, membership.pk)
    )
    for membership in memberships:
        if membership.end_date is not None:
            continue
        unit = membership.org_unit
        while unit is not None:
            if unit.type in DEPARTMENT_TYPES:
                return unit
            unit = unit.parent
    return None


def ranked_members():
    """The members the ranking covers: active accounts with a membership in progress, alumni excepted."""
    active = Membership.objects.filter(end_date__isnull=True).values("member_id")
    return (
        Member.objects.filter(is_active=True, pk__in=active)
        .exclude(status=MemberStatus.ALUMNI)
        .prefetch_related("memberships__org_unit__parent__parent__parent")
        .order_by("first_name", "last_name", "pk")
    )


# --- The month of every member ---


@dataclass
class MemberMonth:
    member: Member
    month: Month
    department: object = None
    entries: list = field(default_factory=list)
    delivered_points: float = 0.0
    assigned_points: int = 0
    performance: float | None = None
    load: float | None = None
    reference_load: float | None = None
    delivery: float | None = None
    presence: float | None = None
    update_rate: float | None = None
    weeks_in_progress: int = 0
    weeks_updated: int = 0
    communication_mark: int | None = None
    communication_cap: int = 5
    late_blockers: int = 0
    reliability: float | None = None
    contribution_points: int = 0
    workshop: dict = field(default_factory=dict)
    events: dict = field(default_factory=dict)
    logistics_mark: int | None = None
    effort_mark: int | None = None
    team: float | None = None
    final: float | None = None
    provisional: bool = True
    assessment: MonthlyAssessment | None = None

    def details(self):
        return {
            "tasks": [entry.as_dict() for entry in self.entries],
            "delivered_points": round(self.delivered_points, 2),
            "reference_load": round1(self.reference_load),
            "weeks_in_progress": self.weeks_in_progress,
            "weeks_updated": self.weeks_updated,
            "update_rate": round1(self.update_rate),
            "communication_mark": self.communication_mark,
            "communication_cap": self.communication_cap,
            "late_blockers": self.late_blockers,
            "contribution_points": self.contribution_points,
            "workshop": self.workshop,
            "events": self.events,
            "logistics_mark": self.logistics_mark,
            "effort_mark": self.effort_mark,
        }


def weighted(parts, weights):
    """Σ (weight × score) ÷ Σ weights of the parts that are not None; None when none is."""
    present = [(weights[name], value) for name, value in parts.items() if value is not None]
    total = sum(weight for weight, _value in present)
    return sum(weight * value for weight, value in present) / total if total else None


def mark_or_na(mark, reason):
    """A Team Contribution criterion: its score, "N/A" with its reason, or not given yet."""
    if mark is not None:
        return {"mark": mark, "score": mark * 20}
    if reason:
        return {"mark": None, "na": reason, "score": None}
    return {"mark": None, "score": None, "missing": True}


def compute_month(month, members=None):
    """Every member's month (the medians need the whole team): {member id: MemberMonth}."""
    everyone = list(ranked_members())
    results = {member.pk: MemberMonth(member, month, department_of(member)) for member in everyone}
    ids = list(results)
    assessments = {a.member_id: a for a in MonthlyAssessment.objects.filter(member_id__in=ids, month=month.first)}
    tasks = scored_tasks_by_member(ids)

    # Delivery: the tasks of the month, then the load against the department's median.
    for member_id, result in results.items():
        result.assessment = assessments.get(member_id)
        result.entries = task_entries(tasks[member_id], month)
        result.assigned_points = sum(entry.task.points for entry in result.entries)
        result.delivered_points = sum(entry.task.points * entry.quality / 5 for entry in result.entries)
        if result.assigned_points:
            score = sum(entry.task.points * entry.score for entry in result.entries) / result.assigned_points
            result.performance = min(100.0, score * 100)
    team_median = statistics.median([r.delivered_points for r in results.values()]) if results else 0
    by_department = {}
    for result in results.values():
        if result.department is not None:
            by_department.setdefault(result.department.pk, []).append(result.delivered_points)
    weeks_in_month = ((month.last - month.first).days + 1) / 7
    for result in results.values():
        if result.performance is None:
            continue
        points = by_department.get(result.department.pk, []) if result.department else []
        reference = statistics.median(points) if len(points) >= SMALL_DEPARTMENT else team_median
        assessment = result.assessment
        if assessment is not None and assessment.no_work_available:
            reference = result.assigned_points
        elif assessment is not None and assessment.excused_weeks:
            reference *= max(0.0, 1 - float(assessment.excused_weeks) / weeks_in_month)
        result.reference_load = reference
        if reference > 0:
            result.load = min(100.0, result.delivered_points / reference * 100)
        else:
            result.load = 100.0 if result.delivered_points > 0 else 0.0
        result.delivery = 0.70 * result.performance + 0.30 * result.load

    wanted = results if members is None else {pk: results[pk] for pk in members if pk in results}
    for result in wanted.values():
        result.presence = presence_score(result.member, month.start, month.end)
        reliability(result, month)
        team_contribution(result, month)
        parts = {"delivery": result.delivery, "presence": result.presence, "reliability": result.reliability,
                 "team": result.team}
        result.final = weighted(parts, WEIGHTS)
        assessment = result.assessment
        result.provisional = (
            any(value is None for value in parts.values())
            or assessment is None
            or assessment.communication_mark is None
            or bool(result.workshop.get("missing"))
            or bool(result.events.get("missing"))
        )
    return wanted


def reliability(result, month):
    """§5: the share of the weeks with a task in progress that had a meaningful update, and the communication
    mark capped by the blockers declared late in the month."""
    member = result.member
    started = Task.objects.filter(assignees__member=member, started_at__isnull=False, started_at__lt=month.end)
    spans = [
        (local_day(task.started_at), local_day(task.validated_at) if task.status == TaskStatus.VALIDATED else None)
        for task in started.distinct()
    ]
    update_days = {
        local_day(moment)
        for moment in TaskEvent.objects.filter(
            actor=member, kind__in=MEANINGFUL, created_at__gte=month.start, created_at__lt=month.end
        ).values_list("created_at", flat=True)
    }
    for first, last in month.weeks():
        if any(start <= last and (end is None or end >= first) for start, end in spans):
            result.weeks_in_progress += 1
            if any(first <= day <= last for day in update_days):
                result.weeks_updated += 1
    if result.weeks_in_progress:
        result.update_rate = result.weeks_updated / result.weeks_in_progress * 100

    declared = Blocker.objects.filter(reported_by=member, reported_at__gte=month.start, reported_at__lt=month.end)
    total = declared.count()
    result.late_blockers = declared.filter(is_late=True).count()
    if result.late_blockers >= 2 or (total and result.late_blockers > total / 2):
        result.communication_cap = 2
    elif result.late_blockers == 1:
        result.communication_cap = 4
    assessment = result.assessment
    if assessment is not None and assessment.communication_mark is not None:
        result.communication_mark = min(assessment.communication_mark, result.communication_cap)
    if result.update_rate is None:
        return
    if result.communication_mark is None:
        result.reliability = result.update_rate
    else:
        result.reliability = 0.5 * result.update_rate + 0.5 * result.communication_mark * 20


def team_contribution(result, month):
    """§6: the contribution points of the month, the workshop and event marks (or N/A), and the bonuses."""
    points = ContributionPoint.objects.filter(
        member=result.member, status=ContributionStatus.VALIDATED, occurred_on__gte=month.first,
        occurred_on__lte=month.last,
    ).values_list("points", flat=True)
    result.contribution_points = sum(points)
    points_score = min(100.0, result.contribution_points / CONTRIBUTION_POINTS_FULL * 100)
    assessment = result.assessment
    result.workshop = mark_or_na(
        assessment.workshop_mark if assessment else None, assessment.workshop_na_reason if assessment else ""
    )
    result.events = mark_or_na(
        assessment.events_mark if assessment else None, assessment.events_na_reason if assessment else ""
    )
    base = weighted(
        {"points": points_score, "workshop": result.workshop["score"], "events": result.events["score"]},
        {"points": 0.55, "workshop": 0.25, "events": 0.20},
    )
    bonus = 0
    if assessment is not None:
        result.logistics_mark = assessment.logistics_mark
        effort = assessment.effort_mark
        if effort is not None and not assessment.effort_evidence.strip():
            effort = min(effort, UNPROVEN_EFFORT_MAX)
        result.effort_mark = effort
        bonus = 2 * (result.logistics_mark or 0) + 2 * (effort or 0)
    result.team = min(100.0, base + bonus)


# --- Ranking (§1.1 and §7) ---


def category(score, load):
    if score is None:
        return ""
    if score >= 85:
        return Category.A if load is not None and load >= CATEGORY_A_LOAD else Category.B
    if score >= 70:
        return Category.B
    if score >= 55:
        return Category.C
    if score >= 40:
        return Category.D
    return Category.E


def ranking_score(member_id, month, final, load):
    """The average of the last three calculable monthly scores (this one, then the published months before it),
    with the average load of the same months (for category A)."""
    finals = [] if final is None else [(final, load)]
    earlier = MonthlyScore.objects.filter(
        member_id=member_id, publication__month__lt=month.first, final__isnull=False
    ).order_by("-publication__month").values_list("final", "load")[: RANKING_MONTHS - len(finals)]
    finals.extend(earlier)
    if not finals:
        return None, None
    loads = [value for _final, value in finals if value is not None]
    return (
        sum(value for value, _load in finals) / len(finals),
        sum(loads) / len(loads) if loads else None,
    )


def rank(rows):
    """Rows with "ranking_score", "delivery" and "team": their rank, highest first; equal rows share it."""
    def key(row):
        return tuple(-1 if row[name] is None else row[name] for name in ("ranking_score", "delivery", "team"))

    ordered = sorted((row for row in rows if row["ranking_score"] is not None), key=key, reverse=True)
    previous, position = None, 0
    for index, row in enumerate(ordered, start=1):
        if key(row) != previous:
            position, previous = index, key(row)
        row["rank"] = position
    for row in rows:
        row.setdefault("rank", None)
    return rows


def row_of(result, month):
    score, load = ranking_score(result.member.pk, month, round1(result.final), round1(result.load))
    return {
        "member": result.member, "department": result.department, "delivery": round1(result.delivery),
        "performance": round1(result.performance), "load": round1(result.load),
        "presence": round1(result.presence), "reliability": round1(result.reliability),
        "team": round1(result.team), "final": round1(result.final), "provisional": result.provisional,
        "ranking_score": round1(score), "category": category(round1(score), load), "result": result,
    }


def member_row(month, member_id):
    """One member's month, without computing the others' (their rank is the published one, if any); None when
    the member is not ranked."""
    result = compute_month(month, members=[member_id]).get(member_id)
    if result is None:
        return None
    row = row_of(result, month)
    published = MonthlyScore.objects.filter(publication__month=month.first, member_id=member_id).first()
    row["rank"] = published.rank if published else None
    return row


def month_rows(month, member_ids=None):
    """The table of a month: every member's parts, final, ranking score, category and rank (rank among the whole
    team, then cut to `member_ids`)."""
    computed = compute_month(month)
    rows = [row_of(result, month) for result in computed.values()]
    rank(rows)
    if member_ids is not None:
        rows = [row for row in rows if row["member"].pk in member_ids]
    return rows

