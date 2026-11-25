"""The formulas of the specification, as pure functions (no database): easy to test against its worked
examples. Every constant comes from a FormulaVersion, so that a published score can be reproduced (§15.7)."""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
ONE = Decimal("1")
HUNDRED = Decimal("100")
WEIGHT_STEP = Decimal("0.001")


def q(value, places="0.0001"):
    return Decimal(value).quantize(Decimal(places), rounding=ROUND_HALF_UP)


# --- §7.1 Work Order budget ---

TIER_THRESHOLDS = ((Decimal("1.80"), 1), (Decimal("2.60"), 2), (Decimal("3.40"), 3), (Decimal("4.20"), 4))


def budget_score(effort, complexity, uncertainty, responsibility, fv):
    """S = 0.35E + 0.30C + 0.20U + 0.15R, each rating from 1 to 5."""
    for rating in (effort, complexity, uncertainty, responsibility):
        if not 1 <= int(rating) <= 5:
            raise ValueError("Each rating goes from 1 to 5.")
    score = (
        fv.weight_effort * effort + fv.weight_complexity * complexity
        + fv.weight_uncertainty * uncertainty + fv.weight_responsibility * responsibility
    )
    return q(score, "0.01")


def suggested_tier(score):
    """1.00–1.79 → 1, 1.80–2.59 → 2, 2.60–3.39 → 3, 3.40–4.19 → 4, 4.20–5.00 → 5."""
    for threshold, tier in TIER_THRESHOLDS:
        if score < threshold:
            return tier
    return 5


# --- §7.3 weights ---

def allocated_points(budget_tier, weight):
    """B_d = B_WO × w_d / 100."""
    return q(Decimal(budget_tier) * Decimal(weight) / HUNDRED)


def redistribute(weights, removed):
    """Share `removed` percent equally between `weights` (a list of Decimals), to the thousandth, the remainder
    going one thousandth at a time to the first ones, so that nothing is lost (§4.3 rule 4, plan §2.2)."""
    count = len(weights)
    if not count:
        return []
    share = (Decimal(removed) / count).quantize(WEIGHT_STEP, rounding=ROUND_DOWN)
    remainder = int((Decimal(removed) - share * count) / WEIGHT_STEP)
    return [weight + share + (WEIGHT_STEP if index < remainder else ZERO) for index, weight in enumerate(weights)]


# --- §6 progress ---

def weighted_average(pairs):
    """Σ wᵢ·Pᵢ / Σ wᵢ over (weight, progress) pairs; the plain average when no weight is set; None if empty."""
    pairs = [(Decimal(weight or 0), Decimal(progress)) for weight, progress in pairs if progress is not None]
    if not pairs:
        return None
    total = sum(weight for weight, _ in pairs)
    if total <= 0:
        return q(sum(progress for _, progress in pairs) / len(pairs), "0.1")
    return q(sum(weight * progress for weight, progress in pairs) / total, "0.1")


def plain_average(values):
    values = [Decimal(value) for value in values if value is not None]
    return q(sum(values) / len(values), "0.1") if values else None


# --- §8 quality ---

def base_penalty(severity, fv):
    return {
        "minor": fv.penalty_minor, "moderate": fv.penalty_moderate,
        "major": fv.penalty_major, "critical": fv.penalty_critical,
    }[severity]


def revision_penalty(rounds, fv):
    """`rounds`: the revision rounds in order, as (severity, attributable). Round i (counting every round) has
    eᵢ = 1 + 0.25(i − 1) and pᵢ = aᵢ·min(0.30, bᵢ·eᵢ); P = min(0.60, 1 − Π(1 − pᵢ)). Returns P and the detail."""
    product = ONE
    detail = []
    for index, (severity, attributable) in enumerate(rounds, start=1):
        escalation = ONE + fv.escalation_base * (index - 1)
        penalty = min(fv.penalty_round_cap, base_penalty(severity, fv) * escalation) if attributable else ZERO
        product *= ONE - penalty
        detail.append({
            "round": index, "severity": severity, "attributable": attributable,
            "escalation": str(q(escalation, "0.01")), "penalty": str(q(penalty)),
        })
    return q(min(fv.revision_cap, ONE - product)), detail


def quality_factor(raw_quality, penalty):
    """Q_f = Q_raw / 5 × (1 − P_revision), between 0 and 1."""
    return q(Decimal(raw_quality) / 5 * (ONE - Decimal(penalty)))


# --- §9 time ---

def union_days(periods):
    """Whole days covered by the union of [start, end) periods (§9.4): an overlap counts once."""
    total = 0
    current_start = current_end = None
    for start, end in sorted((start, end) for start, end in periods if start < end):
        if current_end is None or start > current_end:
            if current_end is not None:
                total += (current_end - current_start).days
            current_start, current_end = start, end
        else:
            current_end = max(current_end, end)
    if current_end is not None:
        total += (current_end - current_start).days
    return total


def effective_deadline(original, relief_days):
    """D_e = D + X."""
    return original + timedelta(days=relief_days) if original else None


@dataclass
class TimeResult:
    factor: Decimal
    delay_ratio: Decimal | None
    band: str


def time_factor(start: date, deadline: date, effective: date, submitted_on: date | None, fv, *, cutoff_passed=False):
    """T from the day of the first complete submission A (§9.6–9.8), in whole calendar days.

    A < D: early (1.1). D ≤ A ≤ D_e: on time (1.0) — relief protects, it gives no early bonus. Later:
    R = (A − D_e) / (D − S), with 0.25 and 0.50 still in the lower band. No complete submission by the cutoff: 0.
    Returns None when there is no submission and the cutoff has not passed (not scorable yet)."""
    if submitted_on is None:
        return TimeResult(fv.tf_no_submit, None, "not_submitted") if cutoff_passed else None
    if submitted_on < deadline:
        return TimeResult(fv.tf_early, ZERO, "early")
    if submitted_on <= effective:
        return TimeResult(fv.tf_on_time, ZERO, "on_time")
    duration = (deadline - start).days
    late = (submitted_on - effective).days
    if duration <= 0:
        return TimeResult(fv.tf_late_over50, None, "late_over_50")
    ratio = Decimal(late) / Decimal(duration)
    if ratio <= Decimal("0.25"):
        return TimeResult(fv.tf_late_25, q(ratio), "late_25")
    if ratio <= Decimal("0.50"):
        return TimeResult(fv.tf_late_50, q(ratio), "late_50")
    return TimeResult(fv.tf_late_over50, q(ratio), "late_over_50")


# --- §13 points ---

def earned_points(budget_tier, weight, quality, time):
    """E_d = B_WO × w_d × Q_f × T_d."""
    return q(allocated_points(budget_tier, weight) * Decimal(quality) * Decimal(time))


def member_share(earned, member_count):
    """E_member,d = E_d / N_d: equal credit within the frozen assignment set."""
    return q(Decimal(earned) / member_count) if member_count else ZERO
