"""The workflows through the API: proposals, credit plan, Deliverable lifecycle, Milestones, submissions and
reviews, dependencies, relief and blockers (specification §3–12)."""

from datetime import date, timedelta
from decimal import Decimal

from rest_framework.test import APITestCase

from ..models import ActivityLog, Deliverable, DependencyLink, FirstCompleteSubmissionSnapshot, WorkOrder
from .fixtures import build

START, DEADLINE = date(2026, 6, 1), date(2026, 6, 20)
EVIDENCE = [{"url": "https://drive.example.invalid/report", "label": "Report", "link_type": "report"}]


class Api:
    def call(self, member, method, url, data=None, expect=None):
        self.client.force_authenticate(member)
        response = getattr(self.client, method)(f"/api/work/{url}", data, format="json")
        if expect is not None:
            self.assertEqual(response.status_code, expect, response.content[:800])
        return response

    def work_order(self, member=None, **data):
        body = {"season": self.t.season.pk, "department": self.t.electronics.pk, "title": "Suspension upright",
                **data}
        return self.call(member or self.t.lead, "post", "work-orders/", body, 201).json()

    def deliverable(self, work_order, member=None, **data):
        body = {"work_order": work_order["id"], "title": "Upright CAD", "acceptance_criteria": "CAD reviewed",
                "start_date": str(START), "original_deadline": str(DEADLINE), **data}
        return self.call(member or self.t.lead, "post", "deliverables/", body, 201).json()

    def active_plan(self, weights=(Decimal("100"),), members=None, budget=4):
        """An active Work Order with Deliverables assigned to `engineer`, ready to start."""
        work_order = self.work_order()
        self.call(self.t.lead, "patch", f"work-orders/{work_order['id']}/", {"budget_tier": budget}, 200)
        items = []
        for index, weight in enumerate(weights):
            item = self.deliverable(work_order, title=f"Deliverable {index}",
                                    member_ids=[m.pk for m in (members or [self.t.engineer])])
            self.call(self.t.lead, "post", f"work-orders/{work_order['id']}/weights/",
                      {"weights": {str(item["id"]): str(weight)}}, 200)
            items.append(item)
        self.call(self.t.lead, "post", f"work-orders/{work_order['id']}/activate/", None, 200)
        for item in items:
            self.call(self.t.lead, "post", f"deliverables/{item['id']}/mark-ready/", None, 200)
        return work_order, items


class WorkOrderTests(Api, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build()

    def test_a_member_proposal_is_not_official_until_a_head_approves_it(self):
        proposal = self.work_order(self.t.engineer, title="Cooling study", budget_tier=5)
        self.assertEqual((proposal["proposal_status"], proposal["code"]), ("pending_review", None))
        listed = self.call(self.t.teammate, "get", "work-orders/", expect=200).json()["results"]
        self.assertNotIn(proposal["id"], [row["id"] for row in listed])
        self.call(self.t.teammate, "get", f"work-orders/{proposal['id']}/", expect=404)
        self.call(self.t.engineer, "post", f"work-orders/{proposal['id']}/approve/", {}, 403)
        self.call(self.t.lead, "post", f"work-orders/{proposal['id']}/reject/", {}, 400)  # a reason is needed
        approved = self.call(self.t.lead, "post", f"work-orders/{proposal['id']}/approve/", {"note": "ok"}, 200).json()
        self.assertEqual(approved["proposal_status"], "approved")
        self.assertTrue(approved["code"].startswith("WO-"))
        self.assertIsNone(WorkOrder.objects.get(pk=proposal["id"]).budget_tier)  # a member never sets the budget

    def test_the_head_edits_before_deciding_and_the_original_is_kept(self):
        proposal = self.work_order(self.t.engineer, title="Cooling study")
        self.call(self.t.lead, "patch", f"work-orders/{proposal['id']}/", {"title": "Cooling study (scoped)"}, 200)
        detail = self.call(self.t.lead, "get", f"work-orders/{proposal['id']}/", expect=200).json()
        self.assertEqual((detail["title"], detail["proposal_original"]["title"]),
                         ("Cooling study (scoped)", "Cooling study"))

    def test_activation_needs_a_budget_dates_and_weights_totalling_100(self):
        work_order = self.work_order()
        first = self.deliverable(work_order)
        second = self.deliverable(work_order, title="Simulation")
        url = f"work-orders/{work_order['id']}/"
        response = self.call(self.t.lead, "post", url + "activate/", None, 400).json()
        self.assertIn("point budget", str(response))
        self.call(self.t.lead, "patch", url, {"budget_tier": 4}, 200)
        self.call(self.t.lead, "post", url + "weights/", {"weights": {first["id"]: "60", second["id"]: "30"}}, 200)
        self.assertIn("90", str(self.call(self.t.lead, "post", url + "activate/", None, 400).json()))
        self.call(self.t.lead, "post", url + "weights/", {"weights": {second["id"]: "40"}}, 200)
        self.assertEqual(self.call(self.t.lead, "post", url + "activate/", None, 200).json()["status"], "active")
        # Frozen now: no silent change (§7.2).
        self.call(self.t.lead, "patch", url, {"budget_tier": 5}, 400)
        self.call(self.t.lead, "patch", url, {"budget_tier": 5, "reason": "scope change approved"}, 200)
        self.call(self.t.lead, "post", url + "weights/", {"weights": {first["id"]: "50", second["id"]: "50"}}, 400)

    def test_only_the_head_of_the_department_plans(self):
        work_order = self.work_order()
        self.call(self.t.aero_lead, "patch", f"work-orders/{work_order['id']}/", {"budget_tier": 3}, 403)
        self.call(self.t.engineer, "post", f"work-orders/{work_order['id']}/activate/", None, 403)
        self.call(self.t.engineer, "post", f"work-orders/{work_order['id']}/rubric/",
                  {"effort": 4, "complexity": 5, "uncertainty": 3, "responsibility": 4}, 403)
        rubric = self.call(self.t.lead, "post", f"work-orders/{work_order['id']}/rubric/",
                           {"effort": 4, "complexity": 5, "uncertainty": 3, "responsibility": 4}, 200).json()["rubric"]
        self.assertEqual((rubric["score"], rubric["suggested_tier"]), ("4.10", 4))

    def test_a_cancelled_deliverable_shares_its_weight_equally(self):
        work_order, items = self.active_plan(weights=(Decimal("40"), Decimal("30"), Decimal("30")))
        self.call(self.t.lead, "post", f"deliverables/{items[0]['id']}/cancel/", {}, 400)  # reason required
        self.call(self.t.lead, "post", f"deliverables/{items[0]['id']}/cancel/", {"reason": "dropped"}, 200)
        weights = sorted(Deliverable.objects.filter(pk__in=[i["id"] for i in items[1:]]).values_list("weight", flat=True))
        self.assertEqual(weights, [Decimal("50"), Decimal("50")])
        self.assertTrue(ActivityLog.objects.filter(action="weight_changed", reason="dropped").exists())


class DeliverableTests(Api, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build()

    def setUp(self):
        self.wo, (self.item,) = self.active_plan()
        self.url = f"deliverables/{self.item['id']}/"

    def test_the_lifecycle_from_ready_to_validated(self):
        t = self.t
        self.call(t.outsider, "post", self.url + "start/", None, 403)
        self.call(t.engineer, "post", self.url + "start/", None, 200)
        self.assertEqual(WorkOrder.objects.get(pk=self.wo["id"]).status, "in_progress")
        self.call(t.engineer, "post", self.url + "progress/", {"progress": 65}, 200)
        self.call(t.outsider, "post", self.url + "progress/", {"progress": 70}, 403)
        milestone = self.call(t.engineer, "post", self.url + "milestones/", {"title": "Mesh"}, 201).json()
        self.call(t.engineer, "post", f"milestones/{milestone['id']}/complete/", {"is_completed": True}, 200)
        self.assertEqual(Deliverable.objects.get(pk=self.item["id"]).progress, 65)  # a Milestone never moves it
        # An incomplete submission is reviewed but does not set A (§4.3 rule 5).
        self.call(t.lead, "post", self.url + "submit/", {"evidence": EVIDENCE}, 403)  # not assigned
        detail = self.call(t.engineer, "post", self.url + "submit/", {"submission_note": "draft"}, 201).json()
        self.assertFalse(detail["submissions"][0]["is_complete"])
        self.assertFalse(FirstCompleteSubmissionSnapshot.objects.exists())
        first = detail["submissions"][0]["id"]
        self.call(t.lead, "post", f"submissions/{first}/review/", {"decision": "validated"}, 400)
        self.call(t.lead, "post", f"submissions/{first}/review/", {"decision": "revision_requested"}, 400)
        self.call(t.lead, "post", f"submissions/{first}/review/", {
            "decision": "revision_requested", "severity": "minor", "issues_summary": "No evidence",
            "is_attributable": False,
        }, 400)  # not attributable: say why
        self.call(t.lead, "post", f"submissions/{first}/review/", {
            "decision": "revision_requested", "severity": "minor", "issues_summary": "No evidence",
        }, 201)
        self.call(t.lead, "post", f"submissions/{first}/review/", {"decision": "validated"}, 400)  # one review
        detail = self.call(t.engineer, "post", self.url + "submit/", {"evidence": EVIDENCE}, 201).json()
        second = detail["submissions"][1]
        self.assertTrue(second["is_complete"] and second["is_first_complete"])
        self.assertEqual(list(FirstCompleteSubmissionSnapshot.objects.get().members.values_list("member", flat=True)),
                         [t.engineer.pk])
        # Only the club admins give the quality mark (decision of 25/11/2026); the Head validates without it.
        self.call(t.lead, "post", f"submissions/{second['id']}/review/", {"decision": "validated", "raw_quality": "4.5"}, 403)
        self.call(t.lead, "post", f"submissions/{second['id']}/review/", {"decision": "validated"}, 201)
        self.assertEqual(Deliverable.objects.get(pk=self.item["id"]).status, "validated")
        self.assertEqual(WorkOrder.objects.get(pk=self.wo["id"]).status, "completed")
        # Reopening is explicit and audited.
        self.call(t.lead, "post", self.url + "reopen/", {}, 400)
        self.call(t.lead, "post", self.url + "reopen/", {"reason": "test failed on the car"}, 200)
        self.assertEqual(WorkOrder.objects.get(pk=self.wo["id"]).status, "in_progress")

    def test_a_head_who_contributed_does_not_review(self):
        self.call(self.t.lead, "post", self.url + "assign/", {"member": self.t.lead.pk}, 200)
        self.call(self.t.lead, "post", self.url + "start/", None, 200)
        detail = self.call(self.t.lead, "post", self.url + "submit/", {"evidence": EVIDENCE}, 201).json()
        submission = detail["submissions"][0]["id"]
        response = self.call(self.t.lead, "post", f"submissions/{submission}/review/", {"decision": "validated"}, 403)
        self.assertIn("another Head", str(response.json()))
        self.call(self.t.admin, "post", f"submissions/{submission}/review/", {"decision": "validated"}, 201)

    def test_a_milestone_used_by_a_dependency_is_kept(self):
        other_wo, (dependent,) = self.active_plan()
        milestone = self.call(self.t.engineer, "post", self.url + "milestones/", {"title": "Interface frozen"}, 201).json()
        self.call(self.t.lead, "post", "dependencies/", {
            "prerequisite": self.item["id"], "dependent": dependent["id"], "release_condition": "milestone_completed",
            "release_milestone": milestone["id"],
        }, 201)
        self.call(self.t.lead, "post", f"milestones/{milestone['id']}/cancel/", {"reason": "not needed"}, 400)
        self.call(self.t.lead, "delete", f"milestones/{milestone['id']}/", None, 400)
        self.assertEqual(Deliverable.objects.get(pk=dependent["id"]).dep_state, "waiting")
        self.call(self.t.engineer, "post", f"milestones/{milestone['id']}/complete/", {"is_completed": True}, 200)
        self.assertEqual(Deliverable.objects.get(pk=dependent["id"]).dep_state, "released")


class DependencyTests(Api, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build()

    def setUp(self):
        _, (self.a, self.b, self.c) = self.active_plan(weights=(Decimal("40"), Decimal("30"), Decimal("30")))

    def link(self, prerequisite, dependent, expect=201, member=None, **data):
        return self.call(member or self.t.lead, "post", "dependencies/",
                         {"prerequisite": prerequisite["id"], "dependent": dependent["id"], **data}, expect)

    def test_and_logic_and_release_on_validation(self):
        self.link(self.a, self.c)
        self.link(self.b, self.c, release_condition="submitted")
        self.assertEqual(Deliverable.objects.get(pk=self.c["id"]).dep_state, "waiting")
        Deliverable.objects.filter(pk=self.b["id"]).update(status="in_progress")
        self.call(self.t.engineer, "post", f"deliverables/{self.b['id']}/submit/", {"evidence": EVIDENCE}, 201)
        self.assertEqual(Deliverable.objects.get(pk=self.c["id"]).dep_state, "waiting")  # A still awaited
        Deliverable.objects.filter(pk=self.a["id"]).update(status="in_progress")
        detail = self.call(self.t.engineer, "post", f"deliverables/{self.a['id']}/submit/", {"evidence": EVIDENCE}, 201)
        self.call(self.t.admin, "post", f"submissions/{detail.json()['submissions'][0]['id']}/review/",
                  {"decision": "validated"}, 201)
        self.assertEqual(Deliverable.objects.get(pk=self.c["id"]).dep_state, "released")

    def test_cycles_and_duplicates_are_refused(self):
        self.link(self.a, self.b)
        self.link(self.b, self.c)
        self.assertIn("cycle", str(self.link(self.c, self.a, expect=400).json()))
        self.link(self.a, self.b, expect=400)
        self.link(self.a, self.a, expect=400)

    def test_members_propose_and_one_involved_head_approves(self):
        self.link(self.a, self.b, expect=403, member=self.t.engineer)
        response = self.call(self.t.engineer, "post", "dependency-proposals/",
                             {"prerequisite": self.a["id"], "dependent": self.b["id"], "reason": "needs the CAD"}, 201)
        proposal = response.json()["id"]
        self.call(self.t.engineer, "post", f"dependency-proposals/{proposal}/approve/", {}, 403)
        self.call(self.t.aero_lead, "post", f"dependency-proposals/{proposal}/approve/", {}, 404)  # not involved
        self.call(self.t.lead, "post", f"dependency-proposals/{proposal}/approve/", {}, 200)
        self.assertEqual(DependencyLink.objects.get().created_by, self.t.engineer)

    def test_a_manual_release_is_permanent_and_needs_a_reason(self):
        link = self.link(self.a, self.b).json()
        self.call(self.t.engineer, "post", f"dependencies/{link['id']}/manual-release/", {"reason": "x"}, 403)
        self.call(self.t.lead, "post", f"dependencies/{link['id']}/manual-release/", {}, 400)
        released = self.call(self.t.lead, "post", f"dependencies/{link['id']}/manual-release/",
                             {"reason": "drawings sent by mail"}, 200).json()
        self.assertTrue(released["manually_released"])
        self.call(self.t.lead, "post", f"dependencies/{link['id']}/manual-release/", {"reason": "again"}, 400)
        self.assertEqual(Deliverable.objects.get(pk=self.b["id"]).dep_state, "released")

    def test_overlapping_relief_counts_once_and_only_the_head_approves(self):
        """§9.10 case D: A blocks 10–16 June, B blocks 13–18 June: 8 days, D_e = 28 June."""
        first = self.link(self.a, self.c).json()
        second = self.link(self.b, self.c).json()
        claim = {"needed_at": "2026-06-10", "waiting_started_at": "2026-06-10", "impact_description": "no CAD",
                 "team_ready": True, "directly_prevented": True}
        url = f"deliverables/{self.c['id']}/relief/"
        self.call(self.t.engineer, "post", url, {**claim, "dependency_link": first["id"]}, 201)
        self.call(self.t.engineer, "post", url, {**claim, "dependency_link": second["id"], "needed_at": "2026-06-13",
                                                  "waiting_started_at": "2026-06-13"}, 201)
        ids = list(self.c_relief_ids())
        self.call(self.t.engineer, "post", f"relief/{ids[0]}/decide/",
                  {"approve": True, "approved_start": "2026-06-10", "approved_end": "2026-06-16"}, 403)
        self.call(self.t.lead, "post", f"relief/{ids[0]}/decide/",
                  {"approve": True, "approved_start": "2026-06-10", "approved_end": "2026-06-16"}, 200)
        self.call(self.t.lead, "post", f"relief/{ids[1]}/decide/",
                  {"approve": True, "approved_start": "2026-06-13", "approved_end": "2026-06-18"}, 200)
        item = Deliverable.objects.get(pk=self.c["id"])
        self.assertEqual((item.relief_days, item.effective_deadline), (8, DEADLINE + timedelta(days=8)))

    def c_relief_ids(self):
        return Deliverable.objects.get(pk=self.c["id"]).relief_intervals.order_by("pk").values_list("pk", flat=True)

    def test_no_relief_unless_the_work_was_genuinely_prevented(self):
        link = self.link(self.a, self.c).json()
        self.call(self.t.engineer, "post", f"deliverables/{self.c['id']}/relief/", {
            "dependency_link": link["id"], "needed_at": "2026-06-10", "waiting_started_at": "2026-06-10",
            "impact_description": "we were not ready", "team_ready": False, "directly_prevented": True,
        }, 201)
        interval = self.c_relief_ids()[0]
        self.call(self.t.lead, "post", f"relief/{interval}/decide/",
                  {"approve": True, "approved_start": "2026-06-10", "approved_end": "2026-06-16"}, 400)
        self.call(self.t.lead, "post", f"relief/{interval}/decide/", {"approve": False, "note": "case E"}, 200)
        self.assertEqual(Deliverable.objects.get(pk=self.c["id"]).relief_days, 0)
        # A non-blocking link never gives relief (§9.2).
        informational = self.link(self.a, self.b, link_type="relates_to").json()
        self.call(self.t.engineer, "post", f"deliverables/{self.b['id']}/relief/", {
            "dependency_link": informational["id"], "needed_at": "2026-06-10", "waiting_started_at": "2026-06-10",
            "impact_description": "x", "team_ready": True, "directly_prevented": True,
        }, 400)


class BlockerTests(Api, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build()

    def test_blockers_set_the_execution_state_and_resolving_is_terminal(self):
        _, (item,) = self.active_plan()
        report = {"deliverable": item["id"], "severity": "high", "description": "Supplier late", "impact": "partial"}
        blocker = self.call(self.t.engineer, "post", "blockers/", report, 201).json()
        self.assertEqual(Deliverable.objects.get(pk=item["id"]).execution_state, "partially_blocked")
        self.call(self.t.lead, "patch", f"blockers/{blocker['id']}/", {"impact": "full"}, 200)
        self.assertEqual(Deliverable.objects.get(pk=item["id"]).execution_state, "fully_blocked")
        self.assertEqual(Deliverable.objects.get(pk=item["id"]).status, "ready")  # never a workflow status
        self.call(self.t.outsider, "post", f"blockers/{blocker['id']}/resolve/", {"note": "x"}, 403)
        self.call(self.t.lead, "post", f"blockers/{blocker['id']}/resolve/", {}, 400)
        self.call(self.t.lead, "post", f"blockers/{blocker['id']}/resolve/", {"note": "parts arrived"}, 200)
        self.assertEqual(Deliverable.objects.get(pk=item["id"]).execution_state, "normal")
        self.call(self.t.lead, "patch", f"blockers/{blocker['id']}/", {"impact": "full"}, 400)  # not reopened
        again = self.call(self.t.engineer, "post", "blockers/", {**report, "previous": blocker["id"]}, 201).json()
        self.assertEqual(again["previous"], blocker["id"])
