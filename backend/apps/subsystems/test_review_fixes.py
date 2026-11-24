"""Regression tests for the review of 24/11/2026: hand-edited or out-of-range query values answer 400, not 500."""

from rest_framework.test import APITestCase

from apps.projects.work_fixtures import build_team


class BadQueryValuesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()

    def get(self, url):
        self.client.force_authenticate(self.t.admin)
        return self.client.get(url)

    def test_a_non_numeric_subsystem_filter(self):
        self.assertEqual(self.get("/api/subsystems/?project=abc").status_code, 400)
        self.assertEqual(self.get("/api/subsystems/?org_unit=1x").status_code, 400)

    def test_out_of_range_months_and_days(self):
        self.assertEqual(self.get("/api/ranking/months/9999-12/").status_code, 400)
        self.assertEqual(self.get("/api/reporting/reports/monthly/?month=9999-12").status_code, 400)
        self.assertEqual(self.get("/api/equipment-reservations/week/?start=9999-12-31").status_code, 400)
        self.assertEqual(self.get("/api/meetings/presence/?start=2026-02-30T10:00").status_code, 400)
