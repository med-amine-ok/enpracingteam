"""A unit's description, shown on its department page (the team's Figma, decision D-022)."""

from rest_framework.test import APITestCase

from .models import Member, OrgUnit, OrgUnitType


class UnitDescriptionTests(APITestCase):
    def test_every_member_reads_a_units_description(self):
        unit = OrgUnit.objects.create(
            code="t-media", name="Media", type=OrgUnitType.CLUB_DEPARTMENT,
            description="Covers the team's life: photos, videos, articles and the social networks.",
        )
        member = Member.objects.create_user(email="reader@example.invalid", first_name="Reader", last_name="Test")
        self.client.force_authenticate(member)
        rows = self.client.get("/api/org-units/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        row = next(row for row in rows if row["id"] == unit.id)
        self.assertEqual(row["description"], "Covers the team's life: photos, videos, articles and the social networks.")
