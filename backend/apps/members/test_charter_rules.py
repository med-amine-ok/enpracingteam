"""The charter's rules on memberships (art. 13 and 14, decision D-019) and the member's year of study."""

from datetime import date

from django.core.exceptions import ValidationError
from rest_framework.test import APITestCase

from .models import Member, MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope, StudyLevel
from .rules import BUSINESS_UNIT, MEDIA_UNIT, PROJECT_UNIT, charter_issues


class CharterRulesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        root = OrgUnit.objects.create(code="enp-racing-team", name="ENP Racing Team", type=OrgUnitType.ROOT)
        cls.media = OrgUnit.objects.create(code=MEDIA_UNIT, name="Media", type=OrgUnitType.CLUB_DEPARTMENT,
                                           parent=root)
        cls.project = OrgUnit.objects.create(code=PROJECT_UNIT, name="Project", type=OrgUnitType.CLUB_DEPARTMENT,
                                             parent=root)
        fs_team = OrgUnit.objects.create(code="fs-team", name="FS Team", type=OrgUnitType.FS_TEAM, parent=cls.project)
        cls.electronics = OrgUnit.objects.create(code="fs-electronics", name="Electronics",
                                                 type=OrgUnitType.FS_DEPARTMENT, parent=fs_team)
        cls.business = OrgUnit.objects.create(code=BUSINESS_UNIT, name="Business", type=OrgUnitType.CLUB_DEPARTMENT,
                                              parent=root)
        cls.role = Role.objects.create(code="t-member", name="Member", role_type=MemberRoleType.MEMBER,
                                       scope=RoleScope.CLUB)
        cls.student = Member.objects.create_user(email="prep@example.invalid", first_name="Prep", last_name="Test",
                                                 study_level=StudyLevel.PREP_1)
        cls.engineer = Member.objects.create_user(email="eng@example.invalid", first_name="Eng", last_name="Test",
                                                  study_level=StudyLevel.YEAR_4)

    def membership(self, member, unit, **extra):
        return Membership(member=member, org_unit=unit, role=self.role, member_level="main", **extra)

    def test_a_student_of_the_preparatory_classes_joins_only_the_media_department(self):
        with self.assertRaisesMessage(ValidationError, "Art. 13"):
            self.membership(self.student, self.electronics).full_clean()
        self.membership(self.student, self.media).full_clean()  # fine
        self.membership(self.student, self.electronics, charter_exception="Needed for the CAD, Bureau 20/10").full_clean()
        self.membership(self.engineer, self.electronics).full_clean()  # not in the preparatory classes

    def test_nobody_is_in_the_project_and_business_departments_at_once(self):
        current = self.membership(self.engineer, self.electronics, is_primary=True)
        current.save()
        with self.assertRaisesMessage(ValidationError, "Art. 14"):
            self.membership(self.engineer, self.business, is_primary=False).full_clean()
        current.end_date = date(2026, 10, 1)
        current.save()
        self.membership(self.engineer, self.business, is_primary=False).full_clean()  # left the other first

    def test_the_bureau_sees_the_memberships_that_break_the_rules(self):
        Membership.objects.create(member=self.student, org_unit=self.electronics, role=self.role, member_level="main")
        rows = charter_issues()
        self.assertEqual([row["membership"].member for row in rows], [self.student])
        self.assertIn("Art. 13", rows[0]["problems"][0])

    def test_members_give_their_year_and_field_of_study(self):
        self.client.force_authenticate(self.engineer)
        response = self.client.patch("/api/auth/me/", {"study_level": "year_5", "study_field": "Génie mécanique"},
                                     format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["study_level"], response.json()["study_field"]), ("year_5", "Génie mécanique"))
