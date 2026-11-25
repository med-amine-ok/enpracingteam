"""The confidential scoring: invisible to members (guide §2.1, plan §4.4), the Heads' quality inputs, and a full
calculation run reproducing the specification's worked example (§13.1)."""

from datetime import datetime, timedelta
from decimal import Decimal

from rest_framework.test import APITestCase

from ..models import FirstCompleteSubmissionSnapshot, ScoreSnapshot, Season, Submission
from .fixtures import ALGIERS, build
from .test_workflows import DEADLINE, EVIDENCE, Api

SCORING = ["quality-inputs/", "formula-versions/", "runs/", "scores/", "dashboard/", "audit/"]
FORBIDDEN = ("score", "ranking", "points", "quality_factor", "time_factor", "penalty", "formula", "budget", "weight")


class ConfidentialityTests(Api, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build()

    def setUp(self):
        self.wo, (self.item,) = self.active_plan()

    def scoring(self, member, url, method="get", data=None):
        self.client.force_authenticate(member)
        return getattr(self.client, method)(f"/api/scoring/{url}", data, format="json")

    def test_a_member_meets_404_everywhere_in_scoring(self):
        for url in SCORING:
            self.assertEqual(self.scoring(self.t.engineer, url).status_code, 404, url)
        self.assertEqual(self.scoring(self.t.engineer, "runs/", "post", {"season": self.t.season.pk}).status_code, 404)

    def test_a_head_meets_404_too(self):
        """The scoring and the ranking data belong to the club admins only (decision of 25/11/2026)."""
        for url in SCORING:
            self.assertEqual(self.scoring(self.t.lead, url).status_code, 404, url)
        for url in SCORING:
            self.assertEqual(self.scoring(self.t.scorer, url).status_code, 200, url)

    def test_member_responses_carry_no_scoring_data(self):
        for url in ("me/", f"work-orders/{self.wo['id']}/", f"deliverables/{self.item['id']}/",
                    "work-orders/", "deliverables/", "dashboard/", "reports/"):
            body = self.call(self.t.engineer, "get", url, expect=200).content.decode().lower()
            for word in FORBIDDEN:
                self.assertNotIn(f'"{word}', body, f"{url}: {word}")
        detail = self.call(self.t.engineer, "get", f"work-orders/{self.wo['id']}/", expect=200).json()
        self.assertIsNone(detail["credit_plan"])
        # The Head who plans sees the budget and the weights.
        detail = self.call(self.t.lead, "get", f"work-orders/{self.wo['id']}/", expect=200).json()
        self.assertEqual((detail["budget_tier"], detail["credit_plan"][0]["weight"]), (4, "100.000"))

    def test_the_capabilities_mention_scoring_only_to_its_admins(self):
        self.assertNotIn("scoring", self.call(self.t.engineer, "get", "me/", expect=200).json())
        self.assertNotIn("scoring", self.call(self.t.lead, "get", "me/", expect=200).json())
        self.assertEqual(self.call(self.t.scorer, "get", "me/", expect=200).json()["scoring"]["publish"], True)

    def test_the_quality_mark_is_entered_by_an_admin_and_never_reaches_the_team(self):
        url = f"deliverables/{self.item['id']}/"
        self.call(self.t.engineer, "post", url + "start/", None, 200)
        detail = self.call(self.t.engineer, "post", url + "submit/", {"evidence": EVIDENCE}, 201).json()
        self.assertFalse(detail["rights"]["enter_quality"])
        self.call(self.t.lead, "post", f"submissions/{detail['submissions'][0]['id']}/review/",
                  {"decision": "validated"}, 201)
        self.assertEqual(self.scoring(self.t.lead, f"quality-inputs/{self.item['id']}/", "put",
                                      {"raw_quality": "4.5", "data_status": "complete"}).status_code, 404)
        response = self.scoring(self.t.scorer, f"quality-inputs/{self.item['id']}/", "put",
                                {"raw_quality": "4.5", "data_status": "complete"})
        self.assertEqual((response.status_code, response.json()["raw_quality"]), (200, "4.5"))
        body = self.call(self.t.engineer, "get", url, expect=200).content.decode()
        self.assertNotIn("4.5", body)


class RunTests(Api, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build()

    def scoring(self, member, url, method="get", data=None, expect=200):
        self.client.force_authenticate(member)
        response = getattr(self.client, method)(f"/api/scoring/{url}", data, format="json")
        self.assertEqual(response.status_code, expect, response.content[:600])
        return response.json()

    def test_the_worked_example_of_the_specification(self):
        """Budget 5, weight 40 %, Q_raw 4.5, 6 days of relief, first complete submission on 25 June (T = 1.0),
        three members: 0.60 each (§13.1)."""
        t = self.t
        members = [t.engineer, t.engineer2, t.teammate]
        work_order, (item, other) = self.active_plan(weights=(Decimal("40"), Decimal("60")), members=members, budget=5)
        prerequisite = other
        link = self.call(t.lead, "post", "dependencies/", {"prerequisite": prerequisite["id"], "dependent": item["id"]},
                         201).json()
        self.call(t.engineer, "post", f"deliverables/{item['id']}/relief/", {
            "dependency_link": link["id"], "needed_at": "2026-06-10", "waiting_started_at": "2026-06-10",
            "impact_description": "no design", "team_ready": True, "directly_prevented": True,
        }, 201)
        interval = self.call(t.lead, "get", f"deliverables/{item['id']}/", expect=200).json()["relief"][0]["id"]
        self.call(t.lead, "post", f"relief/{interval}/decide/",
                  {"approve": True, "approved_start": "2026-06-10", "approved_end": "2026-06-16"}, 200)
        self.call(t.engineer, "post", f"deliverables/{item['id']}/start/", None, 200)
        detail = self.call(t.engineer, "post", f"deliverables/{item['id']}/submit/", {"evidence": EVIDENCE}, 201).json()
        submission = detail["submissions"][0]["id"]
        on_25_june = datetime(2026, 6, 25, 15, 0, tzinfo=ALGIERS)
        Submission.objects.filter(pk=submission).update(submitted_at=on_25_june)
        FirstCompleteSubmissionSnapshot.objects.filter(submission_id=submission).update(first_submitted_at=on_25_june)
        self.call(t.lead, "post", f"submissions/{submission}/review/", {"decision": "validated"}, 201)
        self.scoring(t.scorer, f"quality-inputs/{item['id']}/", "put", {"raw_quality": "4.5", "data_status": "complete"})

        self.scoring(t.lead, "runs/", "post", {"season": t.season.pk}, expect=404)  # a Head never calculates
        earlier = Season.objects.create(year=2025, label="2025–2026")
        self.assertIn("2026", str(self.scoring(t.scorer, "runs/", "post", {"season": earlier.pk}, expect=400)))
        run = self.scoring(t.scorer, "runs/", "post", {"season": t.season.pk}, expect=201)
        self.assertEqual((run["status"], run["records_processed"]), ("completed", 1))
        self.assertIn("No complete submission yet", str(run["issues"]))  # the other Deliverable
        scores = ScoreSnapshot.objects.filter(calculation_run_id=run["id"])
        self.assertEqual(sorted(scores.values_list("member_id", flat=True)), sorted(m.pk for m in members))
        score = scores.first()
        self.assertEqual(
            (score.allocated_points, score.quality_factor, score.time_factor, score.earned_points,
             score.effective_deadline),
            (Decimal("2.0000"), Decimal("0.9000"), Decimal("1.000"), Decimal("0.6000"), DEADLINE + timedelta(days=6)),
        )
        rankings = self.scoring(t.scorer, f"runs/{run['id']}/rankings/")
        self.assertEqual([row["rank"] for row in rankings["members"]], [1, 1, 1])

        # A second run supersedes the first snapshots instead of editing them.
        second = self.scoring(t.scorer, "runs/", "post", {"season": t.season.pk}, expect=201)
        self.assertTrue(all(ScoreSnapshot.objects.filter(calculation_run_id=run["id"]).values_list("is_superseded", flat=True)))
        self.assertFalse(ScoreSnapshot.objects.filter(calculation_run_id=second["id"], is_superseded=True).exists())
        published = self.scoring(t.scorer, f"runs/{second['id']}/publish/", "post", {})
        self.assertTrue(published["is_published"])
        self.assertTrue(self.scoring(t.scorer, "audit/"))

    def test_a_new_formula_version_keeps_the_old_one(self):
        t = self.t
        self.scoring(t.scorer, "formula-versions/", "post", {
            "code": "v1.1", "reason": "calibration", "weight_effort": "0.4", "weight_complexity": "0.3",
            "weight_uncertainty": "0.2", "weight_responsibility": "0.2",
        }, expect=400)  # the weights must total 1
        created = self.scoring(t.scorer, "formula-versions/", "post", {
            "code": "v1.1", "reason": "calibration", "weight_effort": "0.4", "weight_complexity": "0.3",
            "weight_uncertainty": "0.15", "weight_responsibility": "0.15",
        }, expect=201)
        self.scoring(t.scorer, f"formula-versions/{created['id']}/set-current/", "post", {"reason": "season 2"})
        versions = {row["code"]: row["is_current"] for row in self.scoring(t.scorer, "formula-versions/")}
        self.assertEqual(versions, {"v1.0": False, "v1.1": True})
