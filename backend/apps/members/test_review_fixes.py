"""Regression tests for the problems found in the review of 24/11/2026 (documentation/RAPPORT_PROBLEMES_ET_CORRECTIONS.md):
rights through the admin site, the member-creation endpoint, a membership given again the same day, the Admins
group after a governing membership is changed, and the login-code answer for unknown addresses."""

from django.contrib.admin.sites import site
from django.contrib.auth.models import Group
from django.test import RequestFactory, override_settings
from rest_framework.test import APITestCase

from apps.projects.work_fixtures import build_team, person

from .access import ADMINS_GROUP, DEPARTMENT_HEADS_GROUP
from .admin import limit_membership_choices
from .models import Member, Membership, Role
from .test_governing import governing_bodies

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


class AdminRightsTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        cls.board, cls.bureau, cls.roles = governing_bodies()
        cls.t.lead.groups.add(Group.objects.get_or_create(name=DEPARTMENT_HEADS_GROUP)[0])
        Member.objects.filter(pk=cls.t.lead.pk).update(is_staff=True)
        cls.t.lead.refresh_from_db()

    def request_as(self, user):
        request = RequestFactory().get("/admin/")
        request.user = user
        return request

    def test_a_head_gives_memberships_only_in_their_units_and_never_a_leadership_role(self):
        request = self.request_as(self.t.lead)
        units = {"queryset": None}
        limit_membership_choices(request, Membership._meta.get_field("org_unit"), units)
        self.assertEqual(list(units["queryset"]), [self.t.electronics])
        self.assertNotIn(self.board, units["queryset"])
        roles = {}
        limit_membership_choices(request, Membership._meta.get_field("role"), roles)
        self.assertFalse(roles["queryset"].filter(is_leadership=True).exists())

    def test_a_club_admin_keeps_every_choice(self):
        kwargs = {}
        limit_membership_choices(self.request_as(self.t.admin), Membership._meta.get_field("org_unit"), kwargs)
        self.assertEqual(kwargs, {})

    def test_only_a_superuser_edits_a_superuser(self):
        governor = person("governor")
        Membership.objects.create(member=governor, org_unit=self.board, role=self.roles["board-member"])
        governor.refresh_from_db()
        member_admin = site._registry[Member]
        self.assertFalse(member_admin.has_change_permission(self.request_as(governor), self.t.admin))
        self.assertTrue(member_admin.has_change_permission(self.request_as(self.t.admin), self.t.admin))

    def test_a_head_cannot_change_a_members_email_in_the_admin(self):
        member_admin = site._registry[Member]
        self.assertIn("email", member_admin.get_readonly_fields(self.request_as(self.t.lead), self.t.engineer))


class AdminsGroupTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        cls.board, cls.bureau, cls.roles = governing_bodies()

    def test_changing_the_team_managers_role_takes_their_admin_rights_away(self):
        tm = person("tm")
        membership = Membership.objects.create(member=tm, org_unit=self.t.fs_team, role=self.roles["team-manager"])
        self.assertTrue(tm.groups.filter(name=ADMINS_GROUP).exists())
        membership.role = Role.objects.get(code="t-engineer")
        membership.save()
        self.assertFalse(tm.groups.filter(name=ADMINS_GROUP).exists())

    def test_moving_a_board_membership_to_a_department_takes_their_admin_rights_away(self):
        director = person("director")
        membership = Membership.objects.create(member=director, org_unit=self.board, role=self.roles["board-member"])
        self.assertTrue(director.groups.filter(name=ADMINS_GROUP).exists())
        membership.org_unit = self.t.aero
        membership.save()
        self.assertFalse(director.groups.filter(name=ADMINS_GROUP).exists())


class MemberEndpointTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        cls.board, cls.bureau, cls.roles = governing_bodies()
        Member.objects.filter(pk=cls.t.lead.pk).update(is_staff=True)  # every leader gets is_staff (sync_group)
        cls.t.lead.refresh_from_db()

    def post(self, member, body):
        self.client.force_authenticate(member)
        return self.client.post("/api/members/", body, format="json")

    def test_a_leader_with_is_staff_does_not_create_members_here(self):
        response = self.post(self.t.lead, {"first_name": "A", "last_name": "B", "email": "a.b@example.invalid"})
        self.assertEqual(response.status_code, 403)

    def test_an_address_differing_only_by_case_is_refused(self):
        response = self.post(self.t.admin, {"first_name": "E", "last_name": "T", "email": "ENGINEER@example.invalid"})
        self.assertEqual((response.status_code, list(response.json())), (400, ["email"]))

    def test_a_membership_ended_then_given_again_the_same_day_is_reopened(self):
        self.client.force_authenticate(self.t.admin)
        membership = Membership.objects.get(member=self.t.teammate)
        ended = self.client.post(f"/api/members/{self.t.teammate.pk}/manage/memberships/{membership.pk}/end/")
        self.assertEqual(ended.status_code, 200, ended.content[:300])
        again = self.client.post(
            f"/api/members/{self.t.teammate.pk}/manage/memberships/",
            {"org_unit_id": self.t.aero.pk, "role_id": membership.role_id, "member_level": "junior"}, format="json",
        )
        self.assertEqual(again.status_code, 201, again.content[:300])
        self.assertEqual(Membership.objects.filter(member=self.t.teammate, end_date__isnull=True).count(), 1)


@override_settings(CACHES=LOCMEM)
class LoginCodeAnswerTests(APITestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        person("known")

    def ask_twice(self, email):
        url = "/api/auth/otp/request/"
        first = self.client.post(url, {"email": email}, format="json", REMOTE_ADDR="10.0.0.1")
        second = self.client.post(url, {"email": email}, format="json", REMOTE_ADDR="10.0.0.2")
        return first.status_code, second.status_code

    def test_a_registered_and_an_unknown_address_get_the_same_answers(self):
        self.assertEqual(self.ask_twice("known@example.invalid"), self.ask_twice("nobody@example.invalid"))

