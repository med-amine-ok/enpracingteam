from datetime import date, timedelta
from io import StringIO

from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.communication import notify
from apps.communication.models import Notification, NotificationKind as Kind
from apps.discipline.models import season_of
from apps.meetings.access import TEAM_MANAGER_ROLE
from apps.meetings.models import Meeting, MeetingKind
from apps.members.models import MemberRoleType, Membership, Role, RoleScope
from apps.projects.work_fixtures import build_team, person

from .models import Objective, ObjectiveStatus, Training, TrainingStatus, VolunteeringActivity, VolunteeringStatus


def build_engagement_team():
    """build_team() (apps/projects/work_fixtures.py) plus `tm`, the Team Manager (in the FS team).

    `lead` leads Electronics, where `engineer` works; Aerodynamics (`teammate`, `outsider`) has no leader.
    """
    t = build_team()
    role = Role.objects.create(code=TEAM_MANAGER_ROLE, name="Team Manager",
                               role_type=MemberRoleType.HEAD_OF_DEPARTMENT, scope=RoleScope.FS_TEAM)
    t.tm = person("tm")
    Membership.objects.create(member=t.tm, org_unit=t.fs_team, role=role)
    return t


def notified(kind):
    return sorted(Notification.objects.filter(kind=kind).values_list("member__first_name", flat=True))


class EngagementTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_engagement_team()

    def send(self, member, method, url, data=None):
        self.client.force_authenticate(member)
        with self.captureOnCommitCallbacks(execute=True):
            return getattr(self.client, method)(url, data or {}, format="json")

    def ok(self, member, method, url, data=None, status=200):
        response = self.send(member, method, url, data)
        self.assertEqual(response.status_code, status, response.content[:500])
        return response.json() if response.content else None

    def rows(self, member, url):
        data = self.ok(member, "get", url)
        return data["results"] if isinstance(data, dict) else data


class ObjectiveTests(EngagementTestCase):
    def test_the_department_head_sets_goals_and_the_member_moves_them_forward(self):
        t = self.t
        body = {"member_id": t.engineer.id, "title": "Wire the BMS harness", "measure": "Harness tested on the bench",
                "due_date": "2026-12-15"}
        for member in (t.teammate, t.engineer):
            self.assertEqual(self.send(member, "post", "/api/objectives/", body).status_code, 403)
        self.assertEqual(self.send(t.lead, "post", "/api/objectives/", {**body, "member_id": t.lead.id}).status_code,
                         403)  # never for oneself
        goal = self.ok(t.lead, "post", "/api/objectives/", body, status=201)
        self.assertEqual((goal["season"], goal["status"]), (season_of(timezone.localdate()), "in_progress"))
        self.assertEqual(notified(Kind.OBJECTIVE_SET), ["Engineer"])
        url = f"/api/objectives/{goal['id']}/"
        self.ok(t.engineer, "patch", url, {"progress": 60, "member_note": "Connectors crimped"})
        self.assertEqual(self.send(t.engineer, "patch", url, {"status": "achieved"}).status_code, 403)
        self.ok(t.lead, "patch", url, {"status": "achieved", "assessment_note": "Bench test passed"})
        saved = Objective.objects.get(pk=goal["id"])
        self.assertEqual((saved.progress, saved.status, saved.assessed_by), (60, ObjectiveStatus.ACHIEVED, t.lead))
        self.assertEqual(self.rows(t.outsider, "/api/objectives/"), [])
        for member in (t.engineer, t.lead, t.tm):
            self.assertEqual(len(self.rows(member, "/api/objectives/")), 1, member.first_name)

    def test_the_dashboard_counts_the_members_without_a_goal_in_progress(self):
        t = self.t
        Objective.objects.create(member=t.engineer, season=season_of(timezone.localdate()), title="BMS")
        Objective.objects.create(member=t.lead, season=season_of(timezone.localdate()) - 1, title="Last season")
        data = self.ok(t.tm, "get", "/api/reporting/dashboard/")
        self.assertEqual(data["indicators"]["members_without_objectives"]["value"], 5)  # 6 members, 1 with a goal


class TrainingTests(EngagementTestCase):
    def test_a_member_wishes_a_training_a_head_plans_it_then_marks_it_followed(self):
        t = self.t
        wish = self.ok(t.engineer, "post", "/api/trainings/", {"topic": "SolidWorks surfacing", "reason": "Pack"},
                       status=201)
        self.assertEqual((wish["status"], wish["member"]["id"]), ("wished", t.engineer.id))
        self.assertEqual(self.send(t.engineer, "post", "/api/trainings/", {"topic": "x", "member_id": t.teammate.id})
                         .status_code, 403)
        self.assertEqual([row["topic"] for row in self.rows(t.lead, "/api/trainings/?status=wished")],
                         ["SolidWorks surfacing"])
        start = timezone.now() + timedelta(days=4)
        session = Meeting.objects.create(title="SolidWorks", kind=MeetingKind.TRAINING, starts_at=start,
                                         ends_at=start + timedelta(hours=2), organiser=t.lead, created_by=t.lead)
        url = f"/api/trainings/{wish['id']}"
        self.assertEqual(self.send(t.teammate, "post", f"{url}/plan/", {"session_id": session.id}).status_code, 404)
        self.assertEqual(self.ok(t.lead, "post", f"{url}/plan/", {"session_id": session.id})["status"], "planned")
        self.assertEqual(notified(Kind.TRAINING_PLANNED), ["Engineer"])
        followed = self.ok(t.lead, "post", f"{url}/follow/", {"followed_on": "2026-10-20"})
        self.assertEqual((followed["status"], followed["followed_on"]), ("followed", "2026-10-20"))
        recorded = self.ok(t.lead, "post", "/api/trainings/", {"member_id": t.engineer.id, "topic": "Soldering",
                                                               "status": "followed", "followed_on": "2026-09-30"},
                           status=201)
        self.assertEqual(recorded["status"], "followed")
        self.assertEqual(self.send(t.engineer, "delete", f"/api/trainings/{recorded['id']}/").status_code, 400)
        other = self.ok(t.engineer, "post", "/api/trainings/", {"topic": "Composite layup"}, status=201)
        self.ok(t.engineer, "delete", f"/api/trainings/{other['id']}/", status=204)
        self.assertEqual(Training.objects.filter(member=t.engineer).count(), 2)
        self.assertEqual(Training.objects.get(pk=wish["id"]).status, TrainingStatus.FOLLOWED)


class VolunteeringTests(EngagementTestCase):
    def test_the_organiser_records_the_task_a_head_validates_it_and_the_months_are_covered(self):
        t = self.t
        today = timezone.localdate()
        body = {"title": "Tidy the workshop", "kind": "workshop", "date": str(today),
                "participant_ids": [t.outsider.id, t.engineer.id]}
        activity = self.ok(t.teammate, "post", "/api/volunteering/", body, status=201)
        self.assertEqual(sorted(p["first_name"] for p in activity["participants"]), ["Engineer", "Outsider", "Teammate"])
        self.assertEqual(notified(Kind.VOLUNTEERING_TO_VALIDATE), ["Tm"])  # Aerodynamics has no leader
        url = f"/api/volunteering/{activity['id']}"
        self.assertEqual(self.send(t.teammate, "post", f"{url}/validate/").status_code, 403)  # never one's own
        self.assertEqual(self.send(t.lead, "post", f"{url}/validate/").status_code, 403)  # not the organiser's head
        self.assertEqual(self.ok(t.tm, "post", f"{url}/validate/")["status"], VolunteeringStatus.VALIDATED)
        self.assertEqual(notified(Kind.VOLUNTEERING_DECIDED), ["Engineer", "Outsider", "Teammate"])
        month = today.strftime("%Y-%m")
        missing = [row["first_name"] for row in self.ok(t.tm, "get", f"/api/volunteering/missing/?month={month}")]
        self.assertEqual(missing, ["Lead", "Manager", "Tm"])
        missing = [row["first_name"] for row in self.ok(t.lead, "get", f"/api/volunteering/missing/?month={month}")]
        self.assertEqual(missing, ["Lead"])  # Electronics: the lead, the engineer (covered)
        self.assertEqual(self.send(t.engineer, "get", "/api/volunteering/missing/").status_code, 403)
        self.assertEqual(len(self.rows(t.outsider, "/api/volunteering/")), 1)  # a participant sees it

    def test_a_refusal_says_why(self):
        t = self.t
        body = {"title": "Clean the car", "kind": "team_works", "date": str(timezone.localdate()), "participant_ids": []}
        activity = self.ok(t.engineer, "post", "/api/volunteering/", body, status=201)
        self.assertEqual(notified(Kind.VOLUNTEERING_TO_VALIDATE), ["Lead"])  # the head of Electronics
        url = f"/api/volunteering/{activity['id']}/refuse/"
        self.assertEqual(self.send(t.lead, "post", url, {"note": ""}).status_code, 400)
        self.assertEqual(self.ok(t.lead, "post", url, {"note": "Already counted"})["status"], VolunteeringStatus.REFUSED)
        future = {**body, "date": str(timezone.localdate() + timedelta(days=3))}
        self.assertEqual(self.send(t.engineer, "post", "/api/volunteering/", future).status_code, 400)

    def test_the_members_without_volunteering_are_reminded_once_from_the_20th(self):
        t = self.t
        activity = VolunteeringActivity.objects.create(title="Tidy", kind="workshop", date=date(2026, 10, 5),
                                                       organiser=t.engineer, status=VolunteeringStatus.VALIDATED)
        activity.participants.add(t.engineer)
        self.assertEqual(notify.volunteering_reminders(date(2026, 10, 19)), 0)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(notify.volunteering_reminders(date(2026, 10, 20)), 5)
        self.assertEqual(notified(Kind.VOLUNTEERING_REMINDER), ["Lead", "Manager", "Outsider", "Teammate", "Tm"])
        self.assertEqual(len(mail.outbox), 5)
        self.assertEqual(notify.volunteering_reminders(date(2026, 10, 21)), 0)  # once a month
        out = StringIO()
        call_command("send_deadline_reminders", stdout=out)
        self.assertIn("Volunteering reminders:", out.getvalue())


class SheetAndRightsTests(EngagementTestCase):
    def test_the_member_and_their_heads_see_the_full_sheet(self):
        t = self.t
        season = season_of(timezone.localdate())
        Objective.objects.create(member=t.engineer, season=season, title="Wire the BMS", progress=40)
        Training.objects.create(member=t.engineer, topic="SolidWorks")
        activity = VolunteeringActivity.objects.create(title="Tidy", kind="workshop", date=timezone.localdate(),
                                                       organiser=t.engineer, status=VolunteeringStatus.VALIDATED)
        activity.participants.add(t.engineer)
        url = f"/api/engagement/sheet/{t.engineer.id}/"
        for member in (t.teammate, t.outsider):
            self.assertEqual(self.send(member, "get", url).status_code, 403, member.first_name)
        for member in (t.engineer, t.lead, t.tm):
            sheet = self.ok(member, "get", url)
            self.assertEqual(sheet["member"]["id"], t.engineer.id)
        self.assertEqual([row["title"] for row in sheet["objectives"]], ["Wire the BMS"])
        self.assertEqual([row["topic"] for row in sheet["trainings"]], ["SolidWorks"])
        self.assertEqual(sheet["volunteering"]["months_covered"], [timezone.localdate().strftime("%Y-%m")])
        self.assertIn(sheet["health"]["status"], ("active", "at_risk", "inactive"))
        for key in ("tasks", "presence", "contributions", "warnings"):
            self.assertIn(key, sheet)

    def test_the_rights_and_the_members_each_one_follows(self):
        t = self.t
        for member, rights in ((t.engineer, (False, False)), (t.lead, (True, False)), (t.tm, (True, True))):
            data = self.ok(member, "get", "/api/engagement/rights/")
            self.assertEqual((data["leads"], data["sees_all"]), rights, member.first_name)
        self.assertEqual([row["first_name"] for row in self.ok(t.lead, "get", "/api/engagement/members/")],
                         ["Engineer"])
        self.assertEqual(len(self.ok(t.tm, "get", "/api/engagement/members/")), 5)  # everyone but the TM
        self.assertEqual(self.send(t.engineer, "get", "/api/engagement/charter-issues/").status_code, 403)
        self.assertEqual(self.ok(t.tm, "get", "/api/engagement/charter-issues/"), [])

