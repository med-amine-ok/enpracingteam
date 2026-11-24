"""Adding members from the web app (decision D-024): club admins to any unit, department heads to theirs
and the units below them, never with a leadership role; the new member is e-mailed how to sign in."""

from django.core import mail
from rest_framework.test import APITestCase

from apps.projects.work_fixtures import build_team

from .models import Member, MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope


class MemberAddTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        cls.engineer_role = Role.objects.get(code="t-engineer")
        cls.lead_role = Role.objects.get(code="t-lead")
        cls.club_role = Role.objects.create(
            code="t-club-member", name="Club Member", role_type=MemberRoleType.MEMBER, scope=RoleScope.CLUB
        )
        # A unit below Electronics, which its head may also add to.
        cls.bms = OrgUnit.objects.create(
            code="t-bms", name="BMS cell", type=OrgUnitType.FS_DEPARTMENT, parent=cls.t.electronics
        )

    def add(self, member, **data):
        self.client.force_authenticate(member)
        body = {
            "first_name": "  Nadia ", "last_name": "New", "email": "nadia.new@example.invalid",
            "org_unit_id": self.t.electronics.id, "role_id": self.engineer_role.id, "member_level": "junior",
            **data,
        }
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post("/api/members/add/", body, format="json")

    def rights(self, member):
        self.client.force_authenticate(member)
        return self.client.get("/api/members/add/").json()

    def test_a_club_admin_adds_a_member_who_is_emailed_how_to_sign_in(self):
        response = self.add(self.t.admin, email="nadia.new@gmail.com")
        self.assertEqual(response.status_code, 201, response.content)
        member = Member.objects.get(email="nadia.new@gmail.com")
        self.assertEqual((member.first_name, member.has_usable_password()), ("Nadia", False))
        membership = Membership.objects.get(member=member)
        self.assertEqual(
            (membership.org_unit, membership.role, membership.member_level, membership.is_primary, membership.end_date),
            (self.t.electronics, self.engineer_role, "junior", True, None),
        )
        self.assertEqual(response.json()["memberships"][0]["org_unit"]["name"], "Electronics")
        self.assertEqual([message.to for message in mail.outbox], [["nadia.new@gmail.com"]])
        self.assertIn("/fr/login", mail.outbox[0].body)
        self.assertIn("Admin Test", mail.outbox[0].body)

    def test_a_department_head_adds_to_their_units_only_and_never_a_head(self):
        self.assertEqual(sorted(self.rights(self.t.lead)["unit_ids"]), sorted([self.t.electronics.id, self.bms.id]))
        self.assertNotIn(self.lead_role.id, [role["id"] for role in self.rights(self.t.lead)["roles"]])
        self.assertEqual(self.add(self.t.lead, org_unit_id=self.bms.id).status_code, 201)
        elsewhere = self.add(self.t.lead, email="other@example.invalid", org_unit_id=self.t.aero.id)
        self.assertEqual((elsewhere.status_code, list(elsewhere.json())), (400, ["org_unit_id"]))
        head = self.add(self.t.lead, email="head@example.invalid", role_id=self.lead_role.id)
        self.assertEqual((head.status_code, list(head.json())), (400, ["role_id"]))

    def test_members_without_a_unit_to_head_cannot_add(self):
        rights = self.rights(self.t.engineer)
        self.assertEqual((rights["can_add"], rights["unit_ids"]), (False, []))
        self.assertEqual(self.add(self.t.engineer).status_code, 403)
        self.assertFalse(Member.objects.filter(email="nadia.new@example.invalid").exists())

    def test_what_is_refused(self):
        twice = self.add(self.t.admin, email="ENGINEER@example.invalid")
        self.assertEqual((twice.status_code, list(twice.json())), (400, ["email"]))
        club_role = self.add(self.t.admin, role_id=self.club_role.id)  # a club role in an FS unit
        self.assertEqual((club_role.status_code, list(club_role.json())), (400, ["role_id"]))
        no_level = self.add(self.t.admin, member_level=None)
        self.assertEqual((no_level.status_code, list(no_level.json())), (400, ["member_level"]))
        # Art. 13 of the charter: a student of the preparatory classes only in the Media department.
        prep = self.add(self.t.admin, study_level="prep_1")
        self.assertEqual((prep.status_code, list(prep.json())), (400, ["org_unit_id"]))
        self.assertFalse(Member.objects.filter(email="nadia.new@example.invalid").exists())  # nothing half-made
        self.assertEqual(mail.outbox, [])

    def test_a_leadership_role_takes_no_level(self):
        response = self.add(self.t.admin, role_id=self.lead_role.id, member_level="main")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(Membership.objects.get(member__email="nadia.new@example.invalid").member_level)
