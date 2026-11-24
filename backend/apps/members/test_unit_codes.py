from rest_framework.test import APITestCase

from apps.projects.work_fixtures import build_team


class UnitCodeTests(APITestCase):
    """The units' stable code reaches the pages, which choose each department's colours from it (decision D-022)."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()

    def test_the_units_and_the_memberships_carry_their_code(self):
        self.client.force_authenticate(self.t.engineer)
        units = {row["name"]: row["code"] for row in self.client.get("/api/org-units/").json()["results"]}
        self.assertEqual(units["Electronics"], "t-electronics")
        me = self.client.get("/api/auth/me/").json()
        self.assertEqual(me["memberships"][0]["org_unit"]["code"], "t-electronics")
