"""The member's race number and the alumni profile, as in the team's Figma (decision D-022)."""

from django.contrib.auth.models import Group
from django.db import IntegrityError, transaction
from unittest.mock import patch

from django.utils import timezone
from rest_framework.test import APITestCase

from .access import ADMINS_GROUP
from .models import AlumniProfile, Member, MemberStatus
from .serializers import MemberPreferencesSerializer


def make_member(email, **extra):
    return Member.objects.create_user(email=email, first_name="Test", last_name=email.split("@")[0], **extra)


class RaceNumberTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.driver = make_member("driver@example.invalid")
        cls.rival = make_member("rival@example.invalid", race_number=7)

    def choose(self, number, member=None):
        self.client.force_authenticate(member or self.driver)
        return self.client.patch("/api/auth/me/", {"race_number": number}, format="json")

    def test_a_member_chooses_their_number_and_everyone_sees_it(self):
        response = self.choose(16)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["race_number"], 16)
        self.client.force_authenticate(self.rival)
        self.assertEqual(self.client.get(f"/api/members/{self.driver.pk}/").json()["race_number"], 16)

    def test_the_number_goes_from_1_to_99(self):
        for number in (0, 100, -3):
            self.assertEqual(self.choose(number).status_code, 400, number)
        self.assertEqual(self.choose(1).status_code, 200)
        self.assertEqual(self.choose(99).status_code, 200)

    def test_a_number_already_taken_by_a_member_is_refused(self):
        response = self.choose(7)
        self.assertEqual(response.status_code, 400)
        self.assertIn("race_number", response.json())
        self.rival.status = MemberStatus.ON_LEAVE  # on leave: still in the team, the number stays theirs
        self.rival.save()
        self.assertEqual(self.choose(7).status_code, 400)

    def test_the_number_of_an_alumni_is_free_again(self):
        self.rival.status = MemberStatus.ALUMNI
        self.rival.save()
        self.assertEqual(self.choose(7).status_code, 200)

    def test_a_member_keeps_their_number_when_they_change_something_else(self):
        self.client.force_authenticate(self.rival)
        response = self.client.patch("/api/auth/me/", {"race_number": 7, "study_field": "Génie civil"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_a_member_may_give_up_their_number(self):
        response = self.choose(None, member=self.rival)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["race_number"])

    def test_two_members_taking_one_number_at_the_same_moment_get_a_clear_refusal(self):
        # The check passes for both (as when they send at the same moment); the database refuses the second.
        with patch.object(MemberPreferencesSerializer, "validate_race_number", lambda serializer, number: number):
            response = self.choose(7)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("race_number", response.json())
        self.driver.refresh_from_db()
        self.assertIsNone(self.driver.race_number)

    def test_the_database_refuses_two_members_with_one_number(self):
        with transaction.atomic(), self.assertRaises(IntegrityError):
            make_member("twin@example.invalid", race_number=7)
        make_member("alum@example.invalid", race_number=7, status=MemberStatus.ALUMNI)  # fine
        with transaction.atomic(), self.assertRaises(IntegrityError):
            make_member("fast@example.invalid", race_number=120)


class AlumniProfileTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alumni = make_member("alumni@example.invalid", status=MemberStatus.ALUMNI)
        AlumniProfile.objects.create(
            member=cls.alumni, graduation_year=2024, current_position="Ingénieure calcul",
            current_company="Atelier Demo", linkedin_url="https://www.linkedin.com/in/demo-alumni",
            willing_to_mentor=True,
        )
        cls.member = make_member("member@example.invalid")
        cls.admin = make_member("admin@example.invalid")
        cls.admin.groups.add(Group.objects.get_or_create(name=ADMINS_GROUP)[0])

    def sheet(self, viewer, member):
        self.client.force_authenticate(viewer)
        return self.client.get(f"/api/members/{member.pk}/").json()

    def test_the_sheet_of_an_alumni_shows_their_profile(self):
        profile = self.sheet(self.admin, self.alumni)["alumni_profile"]
        self.assertEqual(profile, {
            "graduation_year": 2024, "current_position": "Ingénieure calcul", "current_company": "Atelier Demo",
            "linkedin_url": "https://www.linkedin.com/in/demo-alumni", "willing_to_mentor": True,
        })

    def test_the_linkedin_link_is_a_contact_detail(self):
        profile = self.sheet(self.member, self.alumni)["alumni_profile"]
        self.assertIsNone(profile["linkedin_url"])
        self.assertEqual(profile["current_company"], "Atelier Demo")  # the rest is the team's network

    def test_a_member_still_in_the_team_has_no_alumni_profile(self):
        self.assertIsNone(self.sheet(self.admin, self.member)["alumni_profile"])
        AlumniProfile.objects.create(member=self.member, current_company="Old")  # back in the team
        self.assertIsNone(self.sheet(self.admin, self.member)["alumni_profile"])

    def test_the_directory_lists_them_with_their_profile(self):
        self.client.force_authenticate(self.member)
        rows = {row["email"]: row for row in self.client.get("/api/members/").json()["results"]}
        self.assertEqual(rows[self.alumni.email]["alumni_profile"]["current_company"], "Atelier Demo")

    def test_an_alumni_writes_their_profile(self):
        newcomer = make_member("new.alumni@example.invalid", status=MemberStatus.ALUMNI)
        self.client.force_authenticate(newcomer)
        self.assertEqual(self.client.get("/api/auth/me/alumni/").json()["current_company"], "")
        response = self.client.patch("/api/auth/me/alumni/", {
            "graduation_year": 2025, "current_company": "Bureau Demo", "willing_to_mentor": True,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["current_company"], "Bureau Demo")
        self.assertTrue(AlumniProfile.objects.get(member=newcomer).willing_to_mentor)
        self.assertEqual(self.client.get("/api/auth/me/").json()["alumni_profile"]["graduation_year"], 2025)

    def test_the_graduation_year_is_a_real_year(self):
        self.client.force_authenticate(self.alumni)
        for year in (1900, timezone.now().year + 10):
            response = self.client.patch("/api/auth/me/alumni/", {"graduation_year": year}, format="json")
            self.assertEqual(response.status_code, 400, year)

    def test_only_an_alumni_has_an_alumni_profile_to_write(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.patch("/api/auth/me/alumni/", {"current_company": "X"}, format="json").status_code,
                         403)
        self.assertFalse(AlumniProfile.objects.filter(member=self.member).exists())
