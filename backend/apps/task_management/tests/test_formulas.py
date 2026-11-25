"""The formulas against the specification's own worked examples (§7.1, §7.3.1, §8, §9.9, §9.10, §13.1)."""

from datetime import date
from decimal import Decimal as D

from django.test import SimpleTestCase

from ..models import FormulaVersion
from ..services import formulas as f

V1 = FormulaVersion(code="v1.0")  # the defaults are the specification's constants


def june(day):
    return date(2026, 6, day)


def july(day):
    return date(2026, 7, day)


class BudgetTests(SimpleTestCase):
    def test_the_suspension_example_scores_4_10_and_suggests_4_points(self):
        score = f.budget_score(4, 5, 3, 4, V1)
        self.assertEqual((score, f.suggested_tier(score)), (D("4.10"), 4))

    def test_the_tier_boundaries(self):
        cases = {"1.00": 1, "1.79": 1, "1.80": 2, "2.59": 2, "2.60": 3, "3.39": 3, "3.40": 4, "4.19": 4, "4.20": 5,
                 "5.00": 5}
        for score, tier in cases.items():
            self.assertEqual(f.suggested_tier(D(score)), tier, score)

    def test_a_rating_outside_1_to_5_is_refused(self):
        with self.assertRaises(ValueError):
            f.budget_score(0, 3, 3, 3, V1)


class WeightTests(SimpleTestCase):
    def test_a_4_point_budget_is_shared_by_the_weights(self):
        shares = [f.allocated_points(4, weight) for weight in ("25", "35", "25", "15")]
        self.assertEqual(shares, [D("1.0000"), D("1.4000"), D("1.0000"), D("0.6000")])
        self.assertEqual(sum(shares), D("4"))

    def test_a_cancelled_weight_is_shared_equally_without_losing_a_thousandth(self):
        result = f.redistribute([D("30"), D("30"), D("30")], D("10"))
        self.assertEqual(result, [D("33.334"), D("33.333"), D("33.333")])
        self.assertEqual(sum(result), D("100"))
        self.assertEqual(f.redistribute([], D("10")), [])


class QualityTests(SimpleTestCase):
    def test_one_round_per_revision_escalates_and_is_capped(self):
        self.assertEqual(f.revision_penalty([("major", True)], V1)[0], D("0.1000"))
        # Round 2: 0.10 × 1.25 = 0.125; P = 1 − 0.9 × 0.875 = 0.2125.
        self.assertEqual(f.revision_penalty([("major", True), ("major", True)], V1)[0], D("0.2125"))
        # A round is capped at 0.30: critical in round 6 is 0.15 × 2.25 = 0.3375 → 0.30.
        detail = f.revision_penalty([("minor", False)] * 5 + [("critical", True)], V1)[1]
        self.assertEqual(detail[-1]["penalty"], "0.3000")
        # The whole penalty is capped at 0.60.
        self.assertEqual(f.revision_penalty([("critical", True)] * 8, V1)[0], D("0.6000"))

    def test_a_round_not_attributable_costs_nothing_but_still_counts_as_a_round(self):
        penalty, detail = f.revision_penalty([("critical", False), ("minor", True)], V1)
        self.assertEqual(detail[0]["penalty"], "0.0000")
        self.assertEqual(penalty, D("0.0250"))  # minor × e₂ = 0.02 × 1.25

    def test_the_quality_factor(self):
        self.assertEqual(f.quality_factor(D("4.5"), D("0")), D("0.9000"))
        self.assertEqual(f.quality_factor(D("5"), D("0.2125")), D("0.7875"))


JUNE_1, JUNE_20 = date(2026, 6, 1), date(2026, 6, 20)


class TimeTests(SimpleTestCase):
    """§9.9: S = 1 June, D = 20 June, L = 19 days, X = 6 days, D_e = 26 June."""

    def factor(self, submitted, relief=6, start=JUNE_1, deadline=JUNE_20, cutoff_passed=False):
        return f.time_factor(start, deadline, f.effective_deadline(deadline, relief), submitted, V1,
                             cutoff_passed=cutoff_passed)

    def test_the_ten_cases(self):
        self.assertEqual(self.factor(june(18), relief=0).factor, D("1.1"))
        self.assertEqual(self.factor(june(20), relief=0).factor, D("1.0"))
        self.assertEqual(self.factor(june(25)).factor, D("1.0"))  # within relief: on time, no early bonus
        self.assertEqual(self.factor(june(26)).factor, D("1.0"))
        late = self.factor(june(28))
        self.assertEqual((late.factor, late.delay_ratio), (D("0.8"), D("0.1053")))  # 2/19
        self.assertEqual(self.factor(july(5)).factor, D("0.5"))  # 9/19
        self.assertEqual(self.factor(july(7)).factor, D("0.2"))  # 11/19
        self.assertEqual(self.factor(None, cutoff_passed=True).factor, D("0"))
        self.assertIsNone(self.factor(None))  # not scorable yet

    def test_exactly_25_and_50_percent_stay_in_the_lower_band(self):
        # S = 1 June, D = 21 June: L = 20 days; no relief.
        self.assertEqual(self.factor(june(26), relief=0, deadline=june(21)).factor, D("0.8"))  # 5/20
        self.assertEqual(self.factor(july(1), relief=0, deadline=june(21)).factor, D("0.5"))  # 10/20
        self.assertEqual(self.factor(july(2), relief=0, deadline=june(21)).factor, D("0.2"))  # 11/20

    def test_overlapping_relief_counts_once(self):
        # §9.10 case D: 10–16 June and 13–18 June give 8 days, not 11.
        self.assertEqual(f.union_days([(june(10), june(16)), (june(13), june(18))]), 8)
        self.assertEqual(f.union_days([(june(10), june(16))]), 6)  # case A
        self.assertEqual(f.union_days([(june(1), june(3)), (june(5), june(6))]), 3)
        self.assertEqual(f.union_days([]), 0)


class PointsTests(SimpleTestCase):
    def test_the_full_worked_example(self):
        # §13.1: budget 5, weight 40 %, Q_raw 4.5, no penalty, T = 1.0, three members: 0.60 each.
        earned = f.earned_points(5, D("40"), f.quality_factor(D("4.5"), D("0")), D("1.0"))
        self.assertEqual(earned, D("1.8000"))
        self.assertEqual(f.member_share(earned, 3), D("0.6000"))


class ProgressTests(SimpleTestCase):
    def test_weighted_then_plain_averages(self):
        self.assertEqual(f.weighted_average([(D("25"), 100), (D("75"), 0)]), D("25.0"))
        self.assertEqual(f.weighted_average([(0, 50), (0, 100)]), D("75.0"))  # no weights yet: plain average
        self.assertIsNone(f.weighted_average([]))
        self.assertEqual(f.plain_average([D("40"), None, D("60")]), D("50.0"))
