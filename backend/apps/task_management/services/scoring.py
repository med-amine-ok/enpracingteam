"""Calculation runs and rankings (specification §13, guide §14). Only the scoring views call this module.

A run scores every official Deliverable of the season's active, in-progress or completed Work Orders:
- validated, with the Head's raw quality mark: E_d = B_WO × w_d × Q_f × T_d, shared equally by the members
  frozen at its first complete submission;
- no complete submission and the season's cutoff passed: T = 0, so 0 for the members assigned;
- anything else is not scorable yet and is listed with the run's warnings.
Each result is a new ScoreSnapshot; the member's previous one for that Deliverable is superseded, never edited."""

from collections import defaultdict
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Q

from ..models import (
    Assignment, CalculationRun, Deliverable, DeliverableStatus, FirstCompleteSubmissionSnapshot, FormulaVersion,
    NOT_OFFICIAL, QualityDataStatus, QualityInput, ReviewRevisionRequest, RunStatus, ScoreSnapshot, TimeInput,
    WorkOrderStatus,
)
from . import formulas
from .activity import scoring_audit
from .common import club_day, now, refuse

SCORED_WO_STATUSES = (WorkOrderStatus.ACTIVE, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED)
USABLE_QUALITY = (QualityDataStatus.COMPLETE, QualityDataStatus.SUBMITTED)


def season_deliverables(season):
    return (
        Deliverable.objects.filter(work_order__season=season, work_order__status__in=SCORED_WO_STATUSES)
        .exclude(work_order__proposal_status__in=NOT_OFFICIAL)
        .exclude(proposal_status__in=NOT_OFFICIAL)
        .exclude(status=DeliverableStatus.CANCELLED)
        .select_related("work_order", "work_order__department", "work_order__season")
        .order_by("work_order_id", "pk")
    )


def revision_rounds(deliverable):
    return [
        (row.severity, row.is_attributable)
        for row in ReviewRevisionRequest.objects.filter(review__submission__deliverable=deliverable).order_by(
            "review__submission__submission_number"
        )
    ]


def evaluate(deliverable, formula, at=None):
    """The score of one Deliverable, or why there is none. Pure reading: nothing is saved."""
    at = at or now()
    work_order = deliverable.work_order
    cutoff = work_order.season.scoring_cutoff_at
    first = FirstCompleteSubmissionSnapshot.objects.filter(deliverable=deliverable).first()
    if work_order.budget_tier is None:
        return {"level": "error", "message": "The Work Order has no point budget."}
    if deliverable.start_date is None or deliverable.original_deadline is None:
        return {"level": "error", "message": "The Deliverable has no start date or deadline."}
    submitted_on = None
    if first and (cutoff is None or first.first_submitted_at <= cutoff):
        submitted_on = club_day(first.first_submitted_at)
    cutoff_passed = bool(cutoff and at >= cutoff)
    time = formulas.time_factor(
        deliverable.start_date, deliverable.original_deadline,
        deliverable.effective_deadline or deliverable.original_deadline, submitted_on, formula,
        cutoff_passed=cutoff_passed,
    )
    base = {
        "budget_tier": work_order.budget_tier, "weight": deliverable.weight,
        "allocated_points": formulas.allocated_points(work_order.budget_tier, deliverable.weight),
        "effective_deadline": deliverable.effective_deadline, "relief_days": deliverable.relief_days,
        "first_submission_at": first.first_submitted_at if first else None, "first": first, "time": time,
    }
    if submitted_on is None:
        if time is None:
            return {"level": "info", "message": "No complete submission yet; the scoring cutoff has not passed.",
                    **base}
        members = list(Assignment.objects.filter(deliverable=deliverable, is_active=True).values_list("member_id", flat=True))
        return {**base, "level": "ok", "members": members, "raw_quality": None, "quality_factor": Decimal("0"),
                "revision_penalty": None, "rounds": [], "earned": Decimal("0")}
    if deliverable.status != DeliverableStatus.VALIDATED:
        return {"level": "info", "message": "Submitted, not validated yet.", **base}
    quality = QualityInput.objects.filter(deliverable=deliverable).first()
    if quality is None or quality.raw_quality is None or quality.data_status not in USABLE_QUALITY:
        return {"level": "warning", "message": "The Head's quality mark is missing or not confirmed.", **base}
    penalty, rounds = formulas.revision_penalty(revision_rounds(deliverable), formula)
    quality_factor = formulas.quality_factor(quality.raw_quality, penalty)
    members = list(first.members.values_list("member_id", flat=True))
    if not members:
        return {"level": "error", "message": "Nobody was assigned at the first complete submission.", **base}
    return {
        **base, "level": "ok", "members": members, "raw_quality": quality.raw_quality,
        "quality_factor": quality_factor, "revision_penalty": penalty, "rounds": rounds,
        "earned": formulas.earned_points(work_order.budget_tier, deliverable.weight, quality_factor, time.factor),
    }


def record_time(deliverable, result, formula):
    time = result.get("time")
    TimeInput.objects.update_or_create(deliverable=deliverable, defaults={
        "start_date": deliverable.start_date, "original_deadline": deliverable.original_deadline,
        "effective_deadline": deliverable.effective_deadline, "first_submission_at": result.get("first_submission_at"),
        "total_relief_days": deliverable.relief_days, "delay_ratio": time.delay_ratio if time else None,
        "time_factor": time.factor if time else None, "formula_version": formula,
    })


def save_scores(run, deliverable, result, formula, actor):
    members = result["members"]
    count = len(members)
    share = formulas.member_share(result["earned"], count)
    created = []
    for member in members:
        snapshot = ScoreSnapshot.objects.create(
            deliverable=deliverable, member_id=member, formula_version=formula, calculation_run=run,
            department=deliverable.work_order.department, budget_tier=result["budget_tier"], weight=result["weight"],
            allocated_points=result["allocated_points"], raw_quality=result["raw_quality"],
            quality_factor=result["quality_factor"], time_factor=result["time"].factor,
            revision_penalty=result["revision_penalty"], revision_rounds=result["rounds"],
            delay_ratio=result["time"].delay_ratio, effective_deadline=result["effective_deadline"],
            first_submission_at=result["first_submission_at"], member_count=count, earned_points=share,
            created_by=actor,
        )
        created.append(snapshot)
    by_member = {snapshot.member_id: snapshot for snapshot in created}
    previous = ScoreSnapshot.objects.filter(deliverable=deliverable, is_superseded=False).exclude(calculation_run=run)
    for old in previous:
        old.is_superseded = True
        old.superseded_by = by_member.get(old.member_id)
        old.superseded_reason = f"Recalculated by run {run.pk}" if old.superseded_by else (
            f"Not credited any more by run {run.pk}"
        )
        old.save(update_fields=["is_superseded", "superseded_by", "superseded_reason"])
    return created


def is_scored(season):
    """Scoring starts with the 2026–2027 season (decision of 25/11/2026): earlier seasons are never scored."""
    return season.year >= settings.WORK_SCORING_FIRST_YEAR


def run(actor, season, formula=None, notes=""):
    if not is_scored(season):
        refuse(f"Scoring starts with the {settings.WORK_SCORING_FIRST_YEAR}–{settings.WORK_SCORING_FIRST_YEAR + 1} season.")
    formula = formula or FormulaVersion.objects.filter(is_current=True).first()
    if formula is None:
        refuse("No formula version is current.")
    calculation = CalculationRun.objects.create(season=season, formula_version=formula, triggered_by=actor, notes=notes or "")
    issues, processed = [], 0
    try:
        with transaction.atomic():
            for deliverable in season_deliverables(season):
                result = evaluate(deliverable, formula)
                record_time(deliverable, result, formula)
                if result["level"] != "ok":
                    issues.append({"deliverable": deliverable.pk, "code": deliverable.code or "",
                                   "title": deliverable.title, "level": result["level"], "message": result["message"]})
                    continue
                save_scores(calculation, deliverable, result, formula, actor)
                processed += 1
    except Exception as error:  # the run is recorded as failed, with why
        calculation.status = RunStatus.FAILED
        calculation.issues = [{"level": "error", "message": str(error)}]
        calculation.errors_count = 1
        calculation.completed_at = now()
        calculation.save()
        scoring_audit("calculation_failed", "calculation_run", calculation.pk, actor, new={"error": str(error)})
        return calculation
    calculation.status = RunStatus.COMPLETED
    calculation.records_processed = processed
    calculation.issues = issues
    calculation.warnings_count = sum(1 for issue in issues if issue["level"] == "warning")
    calculation.errors_count = sum(1 for issue in issues if issue["level"] == "error")
    calculation.completed_at = now()
    calculation.save()
    scoring_audit("calculation_run", "calculation_run", calculation.pk, actor, new={
        "season": season.pk, "formula": formula.code, "processed": processed,
        "warnings": calculation.warnings_count, "errors": calculation.errors_count,
    }, reason=notes)
    return calculation


def ranked(totals):
    """Standard competition ranking (1, 2, 2, 4) by total, highest first."""
    rows = sorted(totals, key=lambda row: (-row["total"], row["name"]))
    previous, rank = None, 0
    for index, row in enumerate(rows, start=1):
        if row["total"] != previous:
            rank, previous = index, row["total"]
        row["rank"] = rank
    return rows


def run_rankings(calculation, department_id=None):
    """Members' totals in a run (and per department), ranked."""
    snapshots = ScoreSnapshot.objects.filter(calculation_run=calculation).select_related("member", "department")
    if department_id:
        snapshots = snapshots.filter(department_id=department_id)
    members = defaultdict(lambda: {"total": Decimal("0"), "deliverables": 0})
    departments = defaultdict(lambda: {"total": Decimal("0"), "members": set()})
    for snapshot in snapshots:
        row = members[snapshot.member_id]
        row["member_id"] = snapshot.member_id
        row["name"] = str(snapshot.member)
        row["total"] += snapshot.earned_points
        row["deliverables"] += 1
        unit = departments[snapshot.department_id]
        unit["department_id"] = snapshot.department_id
        unit["name"] = snapshot.department.name if snapshot.department else ""
        unit["total"] += snapshot.earned_points
        unit["members"].add(snapshot.member_id)
    for unit in departments.values():
        unit["member_count"] = len(unit.pop("members"))
    return ranked(list(members.values())), ranked(list(departments.values()))


def validation_issues(season):
    """What is missing or inconsistent before a calculation or a publication (guide §14, screen 29)."""
    issues = []
    for deliverable in season_deliverables(season).filter(
        Q(status=DeliverableStatus.VALIDATED)
    ).select_related("quality_input"):
        quality = getattr(deliverable, "quality_input", None)
        if quality is None or quality.raw_quality is None:
            issues.append({"kind": "quality_missing", "deliverable": deliverable.pk, "code": deliverable.code,
                           "title": deliverable.title, "department": deliverable.work_order.department.name})
        elif quality.data_status == QualityDataStatus.REQUIRES_CORRECTION:
            issues.append({"kind": "quality_correction", "deliverable": deliverable.pk, "code": deliverable.code,
                           "title": deliverable.title, "department": deliverable.work_order.department.name})
        elif quality.data_status == QualityDataStatus.INCOMPLETE:
            issues.append({"kind": "quality_unconfirmed", "deliverable": deliverable.pk, "code": deliverable.code,
                           "title": deliverable.title, "department": deliverable.work_order.department.name})
    seen = set()
    for deliverable in season_deliverables(season):
        work_order = deliverable.work_order
        if work_order.pk in seen:
            continue
        seen.add(work_order.pk)
        total = sum(
            (item.weight for item in work_order.deliverables.all() if item.is_active), Decimal("0")
        )
        if total != formulas.HUNDRED:
            issues.append({"kind": "weights", "work_order": work_order.pk, "code": work_order.code,
                           "title": work_order.title, "total": str(total)})
    if season.scoring_cutoff_at is None:
        issues.append({"kind": "no_cutoff", "season": season.pk})
    return issues


@transaction.atomic
def publish(actor, calculation, reason=""):
    calculation = CalculationRun.objects.select_for_update().get(pk=calculation.pk)
    if calculation.status != RunStatus.COMPLETED:
        refuse("Only a completed calculation is published.")
    if calculation.is_published:
        refuse("This calculation is already published.")
    calculation.is_published = True
    calculation.published_at = now()
    calculation.published_by = actor
    calculation.save()
    scoring_audit("published", "calculation_run", calculation.pk, actor, reason=reason)
    return calculation


@transaction.atomic
def new_formula(actor, data, reason):
    """A new version: the previous ones stay, so every score keeps the version that produced it (guide §14.5)."""
    make_current = data.pop("is_current", False)
    formula = FormulaVersion.objects.create(created_by=actor, **data)
    scoring_audit("formula_created", "formula_version", formula.pk, actor, new=data, reason=reason)
    if make_current:
        set_current(actor, formula, reason)
    return formula


@transaction.atomic
def set_current(actor, formula, reason):
    previous = FormulaVersion.objects.select_for_update().filter(is_current=True).exclude(pk=formula.pk).first()
    if previous:
        previous.is_current = False
        previous.save(update_fields=["is_current"])
    formula.is_current = True
    formula.save(update_fields=["is_current"])
    scoring_audit("formula_set_current", "formula_version", formula.pk, actor,
                  old={"current": previous.code if previous else None}, new={"current": formula.code}, reason=reason)
    return formula
