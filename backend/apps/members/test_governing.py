"""Who governs (decision D-025): the Board of Directors and the Team Manager are club admins, the Executive Bureau
no longer; they give positions in the club, put members in projects, edit the members and create the projects."""

from rest_framework.test import APITestCase

from apps.projects.models import Project, ProjectCategory, ProjectMember, ProjectStatus
from apps.projects.work_fixtures import build_team, person

from .access import ADMINS_GROUP, DEPARTMENT_HEADS_GROUP, is_club_admin
from .models import Member, MemberRoleType, MemberStatus, Membership, OrgUnit, OrgUnitType, Role, RoleScope


def governing_bodies():
    """The Board and the Executive Bureau, with the positions in them and the Team Manager's role."""
    board = OrgUnit.objects.create(code="board", name="Board of Directors", type=OrgUnitType.GOVERNING_BODY)
    bureau = OrgUnit.objects.create(code="executive-bureau", name="Executive Bureau", type=OrgUnitType.GOVERNING_BODY)
    roles = {}
    for code, name, scope in (
        ("president", "President", RoleScope.CLUB),
        ("vice-president", "Vice-President", RoleScope.CLUB),
        ("board-member", "Board Member", RoleScope.CLUB),
        ("treasurer", "Treasurer", RoleScope.CLUB),
        ("executive-bureau-member", "Executive Bureau Member", RoleScope.CLUB),
        ("team-manager", "Team Manager", RoleScope.FS_TEAM),
    ):
        roles[code] = Role.objects.create(
            code=code, name=name, role_type=MemberRoleType.ADMIN, scope=scope, is_leadership=True
        )
    return board, bureau, roles


class GoverningTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        cls.board, cls.bureau, cls.roles = governing_bodies()
        cls.director = person("director")
        Membership.objects.create(member=cls.director, org_unit=cls.board, role=cls.roles["board-member"])
        cls.tm = person("tm")
        Membership.objects.create(member=cls.tm, org_unit=cls.t.fs_team, role=cls.roles["team-manager"])
        cls.engineer_role = Role.objects.get(code="t-engineer")
        cls.club_role = Role.objects.create(
            code="t-club-member", name="Club Member", role_type=MemberRoleType.MEMBER, scope=RoleScope.CLUB
        )
        cls.club_project = Project.objects.create(
            name="Club Fair", category=ProjectCategory.CLUB, org_unit=cls.t.office, status=ProjectStatus.ACTIVE
        )

    def call(self, member, method, url, body=None):
        self.client.force_authenticate(member)
        with self.captureOnCommitCallbacks(execute=True):
            return getattr(self.client, method)(url, body, format="json")

    def ok(self, member, method, url, body=None, status=200):
        response = self.call(member, method, url, body)
        self.assertEqual(response.status_code, status, response.content[:400])
        return response.json()


class WhoGovernsTests(GoverningTestCase):
    def test_the_board_and_the_team_manager_are_club_admins_the_bureau_no_longer(self):
        t = self.t
        self.assertTrue(is_club_admin(self.director))
        self.assertTrue(is_club_admin(self.tm))
        # Every leader joins the Executive Bureau (services.sync_executive_bureau): it does not make them admins.
        self.assertTrue(Membership.objects.filter(member=t.lead, org_unit=self.bureau, end_date__isnull=True).exists())
        self.assertFalse(is_club_admin(t.lead))
        self.assertFalse(is_club_admin(t.engineer))

    def test_the_admins_group_follows_who_governs(self):
        director = Member.objects.get(pk=self.director.pk)
        self.assertTrue(director.groups.filter(name=ADMINS_GROUP).exists())
        self.assertTrue(director.is_staff)
        membership = Membership.objects.get(member=director, org_unit=self.board)
        membership.end_date = membership.start_date or membership.created_at.date()
        membership.save()
        director.refresh_from_db()
        self.assertFalse(director.groups.filter(name=ADMINS_GROUP).exists())
        self.assertFalse(director.is_staff)
        self.assertFalse(is_club_admin(director))

    def test_who_leaves_the_board_but_still_leads_keeps_the_heads_rights_in_the_admin_site(self):
        lead = Member.objects.get(pk=self.t.lead.pk)
        Membership.objects.create(member=lead, org_unit=self.board, role=self.roles["vice-president"], is_primary=False)
        self.assertTrue(lead.groups.filter(name=ADMINS_GROUP).exists())
        Membership.objects.filter(member=lead, org_unit=self.board).first().delete()
        lead.refresh_from_db()
        self.assertEqual(list(lead.groups.values_list("name", flat=True)), [DEPARTMENT_HEADS_GROUP])
        self.assertTrue(lead.is_staff)


class AddWithPositionAndProjectsTests(GoverningTestCase):
    def body(self, **data):
        return {
            "first_name": "Nadia", "last_name": "New", "email": "nadia.new@example.invalid",
            "org_unit_id": self.t.electronics.id, "role_id": self.engineer_role.id, "member_level": "junior", **data,
        }

    def test_the_board_gives_a_position_and_projects(self):
        t = self.t
        rights = self.ok(self.director, "get", "/api/members/add/")
        self.assertTrue(rights["can_manage"])
        self.assertEqual(
            [(position["name"], position["unit"]["name"]) for position in rights["positions"]],
            [("President", "Board of Directors"), ("Vice-President", "Board of Directors"),
             ("Board Member", "Board of Directors"), ("Treasurer", "Executive Bureau")],
        )
        self.assertEqual([project["name"] for project in rights["projects"]], ["Club Fair", "EV Test", "IC Test"])

        body = self.body(position_id=self.roles["president"].id, project_ids=[t.ev.id, t.ic.id])
        self.ok(self.director, "post", "/api/members/add/", body, status=201)
        nadia = Member.objects.get(email="nadia.new@example.invalid")
        units = Membership.objects.filter(member=nadia, end_date__isnull=True)
        self.assertEqual(units.get(org_unit=t.electronics).is_primary, True)
        self.assertEqual(units.get(org_unit=self.board).role, self.roles["president"])
        self.assertEqual(
            sorted(ProjectMember.objects.filter(member=nadia).values_list("project__name", flat=True)),
            ["EV Test", "IC Test"],
        )
        self.assertTrue(is_club_admin(nadia))  # the President governs

    def test_a_head_gives_no_position_and_puts_in_the_projects_of_their_units_only(self):
        t = self.t
        rights = self.ok(t.lead, "get", "/api/members/add/")
        self.assertEqual((rights["can_manage"], rights["positions"]), (False, []))
        # Electronics is in the FS team, which owns both cars' projects; not the club's fair.
        self.assertEqual([project["name"] for project in rights["projects"]], ["EV Test", "IC Test"])
        position = self.call(t.lead, "post", "/api/members/add/", self.body(position_id=self.roles["president"].id))
        self.assertEqual((position.status_code, list(position.json())), (400, ["position_id"]))
        fair = self.call(t.lead, "post", "/api/members/add/", self.body(project_ids=[self.club_project.id]))
        self.assertEqual((fair.status_code, list(fair.json())), (400, ["project_ids"]))
        self.assertFalse(Member.objects.filter(email="nadia.new@example.invalid").exists())
        self.ok(t.lead, "post", "/api/members/add/", self.body(project_ids=[t.ev.id]), status=201)

    def test_a_finished_project_is_not_offered(self):
        Project.objects.filter(pk=self.t.ic.pk).update(status=ProjectStatus.COMPLETED)
        names = [project["name"] for project in self.ok(self.tm, "get", "/api/members/add/")["projects"]]
        self.assertEqual(names, ["Club Fair", "EV Test"])
        done = self.call(self.tm, "post", "/api/members/add/", self.body(project_ids=[self.t.ic.id]))
        self.assertEqual((done.status_code, list(done.json())), (400, ["project_ids"]))


class ManageMemberTests(GoverningTestCase):
    def url(self, member, tail=""):
        return f"/api/members/{member.pk}/manage/{tail}"

    def test_the_board_changes_who_a_member_is_their_status_and_their_projects(self):
        t = self.t
        data = self.ok(self.director, "get", self.url(t.teammate))
        self.assertEqual(data["projects"], [t.ev.id])
        self.assertEqual([row["org_unit"]["name"] for row in data["memberships"]], ["Aerodynamics"])

        body = {"first_name": " Tea  Mate ", "email": "TEA@example.invalid", "status": MemberStatus.ON_LEAVE,
                "project_ids": [t.ic.id]}
        data = self.ok(self.director, "patch", self.url(t.teammate), body)
        self.assertEqual((data["first_name"], data["email"], data["status"]), ("Tea Mate", "TEA@example.invalid", "on_leave"))
        self.assertEqual(data["projects"], [t.ic.id])
        ended = ProjectMember.objects.get(member=t.teammate, project=t.ev)
        self.assertEqual((ended.is_active, ended.end_date is not None), (False, True))

        taken = self.call(self.director, "patch", self.url(t.teammate), {"email": "engineer@example.invalid"})
        self.assertEqual((taken.status_code, list(taken.json())), (400, ["email"]))

    def test_the_team_manager_gives_and_ends_memberships_and_positions(self):
        t = self.t
        body = {"org_unit_id": t.aero.id, "role_id": self.engineer_role.id, "member_level": "junior"}
        data = self.ok(self.tm, "post", self.url(t.engineer, "memberships/"), body, status=201)
        self.assertEqual(sorted(row["org_unit"]["name"] for row in data["memberships"]), ["Aerodynamics", "Electronics"])
        twice = self.call(self.tm, "post", self.url(t.engineer, "memberships/"), body)
        self.assertEqual((twice.status_code, list(twice.json())), (400, ["role_id"]))
        scope = self.call(self.tm, "post", self.url(t.engineer, "memberships/"),
                          {**body, "role_id": self.club_role.id})
        self.assertEqual((scope.status_code, list(scope.json())), (400, ["role_id"]))
        neither = self.call(self.tm, "post", self.url(t.engineer, "memberships/"), {})
        self.assertEqual((neither.status_code, list(neither.json())), (400, ["org_unit_id"]))

        self.ok(self.tm, "post", self.url(t.engineer, "memberships/"), {"position_id": self.roles["treasurer"].id},
                status=201)
        treasurer = Membership.objects.get(member=t.engineer, role=self.roles["treasurer"])
        self.assertEqual((treasurer.org_unit, treasurer.is_primary, treasurer.member_level), (self.bureau, False, None))

        # Ending the main membership makes the next one the main.
        main = Membership.objects.get(member=t.engineer, org_unit=t.electronics)
        data = self.ok(self.tm, "post", self.url(t.engineer, f"memberships/{main.pk}/end/"))
        self.assertNotIn("Electronics", [row["org_unit"]["name"] for row in data["memberships"]])
        main.refresh_from_db()
        self.assertIsNotNone(main.end_date)
        self.assertTrue(Membership.objects.get(member=t.engineer, org_unit=t.aero).is_primary)
        over = self.call(self.tm, "post", self.url(t.engineer, f"memberships/{main.pk}/end/"))
        self.assertEqual(over.status_code, 404)  # already over

    def test_only_the_board_and_the_team_manager_edit_members(self):
        t = self.t
        for member in (t.lead, t.engineer, t.manager):
            self.assertEqual(self.call(member, "get", self.url(t.teammate)).status_code, 403, member.first_name)
            self.assertEqual(self.call(member, "patch", self.url(t.teammate), {"first_name": "X"}).status_code, 403)
        self.assertFalse(self.ok(t.lead, "get", "/api/members/add/")["can_manage"])
        self.assertEqual(self.call(self.director, "get", "/api/members/999999/manage/").status_code, 404)


class ProjectCreationTests(GoverningTestCase):
    def test_only_the_board_and_the_team_manager_create_projects_and_name_their_manager(self):
        t = self.t
        for member, allowed in ((self.director, True), (self.tm, True), (t.lead, False), (t.manager, False)):
            self.assertEqual(self.ok(member, "get", "/api/projects/creating/"), {"can_create": allowed})
        body = {
            "name": "MATE ROV 2027", "category": ProjectCategory.COMPLEMENTARY, "status": ProjectStatus.PLANNED,
            "org_unit_id": t.office.id, "project_manager_id": t.manager.id, "key": "rov27",
        }
        self.assertEqual(self.call(t.lead, "post", "/api/projects/", body).status_code, 403)
        data = self.ok(self.director, "post", "/api/projects/", body, status=201)
        self.assertEqual((data["key"], data["project_manager"]["first_name"]), ("ROV27", "Manager"))
        # A same manager leads several projects: here the IC car's too, besides the EV's and the ROV.
        self.ok(self.tm, "patch", f"/api/projects/{t.ic.id}/", {"project_manager_id": t.manager.id})
        self.assertEqual(Project.objects.filter(project_manager=t.manager).count(), 3)
        # Named without a role that allows it, a manager gets the Project Manager role in the project's unit.
        self.ok(self.director, "post", "/api/projects/", {**body, "key": "", "project_manager_id": t.lead.id}, status=201)
        given = Membership.objects.get(member=t.lead, org_unit=t.office, end_date__isnull=True)
        self.assertTrue(given.role.can_be_project_manager)


class VisibleProjectsTests(GoverningTestCase):
    def test_each_member_shows_the_projects_they_work_on_or_manage(self):
        t = self.t
        data = self.ok(t.engineer, "get", "/api/members/")
        rows = {row["first_name"]: row["projects"] for row in (data["results"] if isinstance(data, dict) else data)}
        self.assertEqual(rows["Teammate"], [{"id": t.ev.id, "name": "EV Test", "category": "ev", "manages": False}])
        self.assertEqual(rows["Manager"], [{"id": t.ev.id, "name": "EV Test", "category": "ev", "manages": True}])
        self.assertEqual(rows["Engineer"], [])
        # A finished project is no longer shown.
        Project.objects.filter(pk=t.ev.pk).update(status=ProjectStatus.COMPLETED)
        self.assertEqual(self.ok(t.engineer, "get", f"/api/members/{t.teammate.pk}/")["projects"], [])
