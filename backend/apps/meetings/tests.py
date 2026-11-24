"""Meetings and attendance (decision D-013, knowledge base: PROJECTS/ERP/meetings_design.md)."""

from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.communication.models import Notification, NotificationKind as Kind
from apps.members.models import MemberRoleType, MemberStatus, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.work_fixtures import build_team, person
from apps.tasks.models import Task

from .access import BUREAU_UNIT, TEAM_MANAGER_ROLE
from .models import Attendance, AttendanceStatus, ExcuseStatus, Meeting, MeetingAction
from .scores import presence_score

START = timezone.now().replace(microsecond=0) + timedelta(days=2)


def notified(kind):
    return sorted(Notification.objects.filter(kind=kind).values_list("member__first_name", flat=True))


def at(moment):
    """The clock stopped at `moment`."""
    return patch("django.utils.timezone.now", return_value=moment)


def build_meetings_team():
    t = build_team()
    bureau = OrgUnit.objects.create(code=BUREAU_UNIT, name="Executive Bureau", type=OrgUnitType.GOVERNING_BODY)
    member_role = Role.objects.create(
        code="t-bureau", name="Bureau Member", role_type=MemberRoleType.ADMIN, scope=RoleScope.CLUB, is_leadership=True
    )
    tm_role = Role.objects.create(
        code=TEAM_MANAGER_ROLE, name="Team Manager", role_type=MemberRoleType.ADMIN, scope=RoleScope.FS_TEAM,
        is_leadership=True,
    )
    t.chair = person("chair")  # in the Executive Bureau: schedules the sessions
    t.tm = person("tm")  # the Team Manager: decides the excuses
    Membership.objects.create(member=t.chair, org_unit=bureau, role=member_role)
    Membership.objects.create(member=t.tm, org_unit=t.fs_team, role=tm_role)
    t.alumnus = person("alumnus", status=MemberStatus.ALUMNI)
    Membership.objects.create(member=t.alumnus, org_unit=t.electronics, role=member_role)
    t.bureau = bureau
    return t


class MeetingsTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_meetings_team()

    def send(self, member, method, url, data=None):
        self.client.force_authenticate(member)
        with self.captureOnCommitCallbacks(execute=True):
            return getattr(self.client, method)(url, data or {}, format="json")

    def ok(self, member, method, url, data=None, status=200):
        response = self.send(member, method, url, data)
        self.assertEqual(response.status_code, status, response.content)
        return response.json() if response.content else None

    def schedule(self, member=None, *, start=START, minutes=60, unit="electronics", **fields):
        t = self.t
        body = {
            "title": "Electronics weekly", "kind": "department", "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(minutes=minutes)).isoformat(), "location": "Room B2",
            "org_unit_id": getattr(t, unit).id if unit else None, **fields,
        }
        data = self.ok(member or t.chair, "post", "/api/meetings/", body, status=201)
        return Meeting.objects.get(pk=data["id"])

    def invited(self, meeting):
        return sorted(meeting.attendances.values_list("member__first_name", flat=True))


class MeetingScheduleTests(MeetingsTestCase):
    def test_the_bureau_schedules_a_session_and_its_unit_is_invited(self):
        t = self.t
        meeting = self.schedule(is_mandatory=True)
        self.assertEqual(meeting.organiser, t.chair)  # by default, who scheduled it
        self.assertEqual(self.invited(meeting), ["Engineer", "Lead"])  # active members, not the alumnus
        self.assertEqual(notified(Kind.MEETING_SCHEDULED), ["Engineer", "Lead"])
        self.assertEqual(len(mail.outbox), 2)  # a mandatory session is e-mailed

        self.schedule(title="Optional talk")  # not mandatory: told in the ERP only
        self.assertEqual(len(mail.outbox), 2)

    def test_only_the_bureau_and_the_admins_schedule(self):
        t = self.t
        for member in (t.lead, t.manager, t.engineer):
            body = {"title": "x", "kind": "general", "starts_at": START.isoformat(),
                    "ends_at": (START + timedelta(hours=1)).isoformat()}
            self.assertEqual(self.send(member, "post", "/api/meetings/", body).status_code, 403, member.first_name)
        self.schedule(t.admin)
        self.schedule(t.tm, title="TM's own")  # the Team Manager is in the bureau of the real team; here by role

    def test_a_general_meeting_invites_every_active_member(self):
        meeting = self.schedule(unit=None, kind="general", title="General assembly")
        self.assertEqual(
            self.invited(meeting), ["Chair", "Engineer", "Lead", "Manager", "Outsider", "Teammate", "Tm"]
        )

    def test_a_session_is_made_mandatory_before_it_starts_never_after(self):
        t = self.t
        past = timezone.now() - timedelta(hours=1)
        body = {"title": "Late", "kind": "general", "starts_at": past.isoformat(),
                "ends_at": (past + timedelta(hours=2)).isoformat(), "is_mandatory": True}
        self.assertEqual(self.send(t.chair, "post", "/api/meetings/", body).status_code, 400)

        optional = self.schedule()
        mandatory = self.schedule(is_mandatory=True)
        with at(START + timedelta(minutes=5)):  # started
            response = self.send(t.chair, "patch", f"/api/meetings/{optional.id}/", {"is_mandatory": True})
            self.assertEqual(response.status_code, 400)
            response = self.send(t.chair, "patch", f"/api/meetings/{mandatory.id}/", {"is_mandatory": False})
            self.assertEqual(response.status_code, 400)
            moved = (START + timedelta(days=1)).isoformat()
            response = self.send(t.chair, "patch", f"/api/meetings/{mandatory.id}/", {"starts_at": moved})
            self.assertEqual(response.status_code, 400)
            self.ok(t.chair, "patch", f"/api/meetings/{mandatory.id}/", {"agenda": "1. Budget"})  # still free
        self.ok(t.chair, "patch", f"/api/meetings/{optional.id}/", {"is_mandatory": True})  # before: fine

    def test_cancelling_tells_the_invitees(self):
        t = self.t
        meeting = self.schedule()
        mail.outbox.clear()
        self.ok(t.chair, "post", f"/api/meetings/{meeting.id}/cancel/", {"reason": "Exams week"})
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, "cancelled")
        self.assertEqual(notified(Kind.MEETING_UPDATED), ["Engineer", "Lead"])
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.send(t.engineer, "post", f"/api/meetings/{meeting.id}/check-in/").status_code, 400)

    def test_changing_the_unit_before_it_starts_changes_the_invitees(self):
        t = self.t
        meeting = self.schedule()
        self.ok(t.chair, "patch", f"/api/meetings/{meeting.id}/", {"org_unit_id": t.aero.id})
        self.assertEqual(self.invited(meeting), ["Outsider", "Teammate"])

    def test_the_organiser_adds_or_removes_a_guest(self):
        t = self.t
        meeting = self.schedule()
        self.ok(t.chair, "post", f"/api/meetings/{meeting.id}/invitees/", {"member_id": t.manager.id}, status=201)
        self.assertIn("Manager", self.invited(meeting))
        self.ok(t.chair, "delete", f"/api/meetings/{meeting.id}/invitees/{t.manager.id}/", status=204)
        self.assertNotIn("Manager", self.invited(meeting))
        self.assertEqual(
            self.send(t.engineer, "post", f"/api/meetings/{meeting.id}/invitees/", {"member_id": t.manager.id})
            .status_code, 403,
        )

    def test_the_screens_know_who_schedules_and_who_decides_the_excuses(self):
        t = self.t
        meeting = self.schedule()
        self.ok(t.engineer, "post", f"/api/meetings/{meeting.id}/excuse/", {"reason": "exam"})
        rights = lambda member: self.ok(member, "get", "/api/meetings/rights/")  # noqa: E731
        self.assertEqual(rights(t.engineer), {"schedule": False, "decide_excuses": False, "pending_excuses": 0})
        self.assertEqual(rights(t.chair), {"schedule": True, "decide_excuses": False, "pending_excuses": 0})
        self.assertEqual(rights(t.tm), {"schedule": True, "decide_excuses": True, "pending_excuses": 1})

    def test_each_one_sees_their_sessions_the_bureau_sees_all(self):
        t = self.t
        self.schedule(title="Electronics weekly")
        self.schedule(title="Aero weekly", unit="aero")
        titles = lambda member: [row["title"] for row in self.ok(member, "get", "/api/meetings/")["results"]]  # noqa: E731
        self.assertEqual(titles(t.engineer), ["Electronics weekly"])
        self.assertEqual(sorted(titles(t.chair)), ["Aero weekly", "Electronics weekly"])
        self.assertEqual(sorted(titles(t.admin)), ["Aero weekly", "Electronics weekly"])
        aero = Meeting.objects.get(title="Aero weekly")
        self.assertEqual(self.send(t.engineer, "get", f"/api/meetings/{aero.id}/").status_code, 404)


class AttendanceTests(MeetingsTestCase):
    def check_in(self, member, meeting, moment):
        with at(moment):
            return self.send(member, "post", f"/api/meetings/{meeting.id}/check-in/")

    def test_check_in_is_on_time_up_to_10_minutes_after_the_start(self):
        t = self.t
        meeting = self.schedule()
        self.assertEqual(self.check_in(t.engineer, meeting, START - timedelta(minutes=20)).status_code, 400)
        self.assertEqual(self.check_in(t.engineer, meeting, START - timedelta(minutes=5)).status_code, 200)
        self.assertEqual(self.check_in(t.lead, meeting, START + timedelta(minutes=15)).status_code, 200)
        self.assertEqual(self.check_in(t.outsider, meeting, START).status_code, 403)  # not invited
        statuses = dict(meeting.attendances.values_list("member__first_name", "status"))
        self.assertEqual(statuses, {"Engineer": AttendanceStatus.PRESENT, "Lead": AttendanceStatus.LATE})
        later = self.schedule(title="Later")
        self.assertEqual(self.check_in(t.engineer, later, START + timedelta(minutes=61)).status_code, 400)  # over

    def test_the_organiser_confirms_and_who_did_not_check_in_is_absent(self):
        t = self.t
        meeting = self.schedule(unit="fs_team")
        self.check_in(t.engineer, meeting, START + timedelta(minutes=12))  # late
        url = f"/api/meetings/{meeting.id}/attendance/"
        entries = {"entries": [{"member_id": t.lead.id, "status": "present"}]}
        with at(START - timedelta(minutes=1)):
            self.assertEqual(self.send(t.chair, "post", url, entries).status_code, 400)  # not started
        with at(START + timedelta(minutes=30)):
            self.assertEqual(self.send(t.lead, "post", url, entries).status_code, 403)  # not the organiser
            self.ok(t.chair, "post", url, entries)
        statuses = dict(meeting.attendances.values_list("member__first_name", "status"))
        self.assertEqual(statuses["Lead"], AttendanceStatus.PRESENT)
        self.assertEqual(statuses["Engineer"], AttendanceStatus.LATE)  # kept from the check-in
        self.assertEqual(statuses["Teammate"], AttendanceStatus.ABSENT)
        meeting.refresh_from_db()
        self.assertIsNotNone(meeting.attendance_confirmed_at)
        self.assertEqual(self.check_in(t.teammate, meeting, START + timedelta(minutes=40)).status_code, 400)

        with at(START + timedelta(hours=2)):  # a correction, later
            self.ok(t.chair, "post", url, {"entries": [{"member_id": t.teammate.id, "status": "late"}]})
        row = meeting.attendances.get(member=t.teammate)
        self.assertEqual((row.status, row.marked_by), (AttendanceStatus.LATE, t.chair))

    def test_invitees_see_their_own_attendance_the_organiser_sees_everyone(self):
        t = self.t
        meeting = self.schedule()
        mine = self.ok(t.engineer, "get", f"/api/meetings/{meeting.id}/")
        self.assertEqual([row["member"]["first_name"] for row in mine["attendances"]], ["Engineer"])
        self.assertEqual(mine["counts"]["invited"], 2)
        everyone = self.ok(t.chair, "get", f"/api/meetings/{meeting.id}/")
        self.assertEqual(sorted(row["member"]["first_name"] for row in everyone["attendances"]), ["Engineer", "Lead"])
        self.assertEqual(everyone["counts"]["invited"], 2)
        organised = self.schedule(organiser_id=t.lead.id, title="Run by the lead")  # its organiser, invited too
        listed = {row["title"]: row for row in self.ok(t.lead, "get", "/api/meetings/")["results"]}
        self.assertEqual(listed["Run by the lead"]["counts"]["invited"], 2)
        self.assertTrue(listed["Run by the lead"]["permissions"]["run"])
        self.assertFalse(listed["Electronics weekly"]["permissions"]["run"])
        self.assertEqual(organised.organiser, t.lead)


class ExcuseTests(MeetingsTestCase):
    def test_an_excuse_goes_to_the_team_manager_who_decides_it(self):
        t = self.t
        meeting = self.schedule(is_mandatory=True)
        url = f"/api/meetings/{meeting.id}/excuse/"
        self.ok(t.engineer, "post", url, {"reason": "exam", "note": "Analysis exam"})
        self.assertEqual(notified(Kind.EXCUSE_REQUESTED), ["Tm"])

        pending = self.ok(t.tm, "get", "/api/meetings/excuses/")["results"]
        self.assertEqual([(row["member"]["first_name"], row["excuse_reason"]) for row in pending], [("Engineer", "exam")])
        self.assertEqual(self.send(t.lead, "get", "/api/meetings/excuses/").status_code, 403)

        decide = f"/api/meetings/excuses/{pending[0]['id']}/decide/"
        self.assertEqual(self.send(t.lead, "post", decide, {"accept": True}).status_code, 403)
        self.assertEqual(self.send(t.tm, "post", decide, {"accept": False}).status_code, 400)  # say why
        self.ok(t.tm, "post", decide, {"accept": True})
        row = Attendance.objects.get(meeting=meeting, member=t.engineer)
        self.assertEqual((row.excuse_status, row.excuse_decided_by), (ExcuseStatus.ACCEPTED, t.tm))
        self.assertEqual(notified(Kind.EXCUSE_DECIDED), ["Engineer"])
        self.assertEqual(self.ok(t.tm, "get", "/api/meetings/excuses/")["results"], [])

    def test_an_excuse_is_asked_up_to_7_days_after_the_session(self):
        t = self.t
        meeting = self.schedule()
        url = f"/api/meetings/{meeting.id}/excuse/"
        with at(START + timedelta(days=8)):
            self.assertEqual(self.send(t.engineer, "post", url, {"reason": "illness"}).status_code, 400)
        with at(START + timedelta(days=6)):
            self.ok(t.engineer, "post", url, {"reason": "illness"})
        self.assertEqual(self.send(t.outsider, "post", url, {"reason": "illness"}).status_code, 403)

    def test_the_team_manager_does_not_decide_their_own_excuse(self):
        t = self.t
        meeting = self.schedule(unit="fs_team")
        self.ok(t.tm, "post", f"/api/meetings/{meeting.id}/excuse/", {"reason": "mission"})
        self.assertEqual(notified(Kind.EXCUSE_REQUESTED), ["Admin"])  # the admins, then
        row = Attendance.objects.get(meeting=meeting, member=t.tm)
        self.assertEqual(self.send(t.tm, "post", f"/api/meetings/excuses/{row.id}/decide/", {"accept": True})
                         .status_code, 403)
        self.ok(t.admin, "post", f"/api/meetings/excuses/{row.id}/decide/", {"accept": True})


class PresenceScoreTests(MeetingsTestCase):
    def held(self, *, mandatory=True, critical=False, status="present", excuse=None, confirmed=True,
             cancelled=False, days=0):
        start = timezone.now() - timedelta(days=10 - days)
        meeting = Meeting.objects.create(
            title="Session", kind="department", starts_at=start, ends_at=start + timedelta(hours=1),
            is_mandatory=mandatory, is_critical=critical, organiser=self.t.chair,
            status="cancelled" if cancelled else "planned",
            attendance_confirmed_at=start + timedelta(hours=1) if confirmed else None,
        )
        Attendance.objects.create(
            meeting=meeting, member=self.t.engineer, status=status,
            excuse_status=excuse or ExcuseStatus.NONE,
        )
        return meeting

    def test_the_presence_score_follows_the_ranking_system(self):
        period = (timezone.now() - timedelta(days=30), timezone.now())
        self.assertIsNone(presence_score(self.t.engineer, *period))  # no mandatory session: not calculable
        self.held(status="present")  # 1 × 1
        self.held(critical=True, status="late", days=1)  # 2 × 0.5
        self.held(status="absent", days=2)  # 1 × 0
        self.held(status="absent", excuse=ExcuseStatus.ACCEPTED, days=3)  # removed
        self.held(status="absent", excuse=ExcuseStatus.REFUSED, days=4)  # 1 × 0
        self.held(mandatory=False, status="absent", days=5)  # not mandatory: ignored
        self.held(status="absent", confirmed=False, days=6)  # not confirmed yet: ignored
        self.held(status="absent", cancelled=True, days=7)  # cancelled: ignored
        self.assertEqual(presence_score(self.t.engineer, *period), 40.0)  # (1 + 1 + 0 + 0) / 5 × 100

    def test_each_one_sees_their_presence_the_bureau_sees_everyone(self):
        t = self.t
        self.held(status="present")
        mine = self.ok(t.engineer, "get", "/api/meetings/presence/")
        self.assertEqual(mine["score"], 100.0)
        self.assertEqual(len(mine["history"]), 1)
        self.assertEqual(self.ok(t.chair, "get", f"/api/meetings/presence/?member={t.engineer.id}")["score"], 100.0)
        self.assertEqual(self.send(t.lead, "get", f"/api/meetings/presence/?member={t.engineer.id}").status_code, 403)


class MinutesTests(MeetingsTestCase):
    def test_the_organiser_writes_the_minutes_decisions_and_actions(self):
        t = self.t
        meeting = self.schedule()
        base = f"/api/meetings/{meeting.id}"
        self.assertEqual(self.send(t.engineer, "post", f"{base}/decisions/", {"text": "x"}).status_code, 403)
        self.ok(t.chair, "post", f"{base}/decisions/", {"text": "Order the BMS from supplier A"}, status=201)
        mail.outbox.clear()
        action = self.ok(t.chair, "post", f"{base}/actions/", {
            "description": "Ask two quotes", "responsible_id": t.engineer.id, "due_date": "2026-11-30",
        }, status=201)
        self.assertEqual(notified(Kind.ACTION_ASSIGNED), ["Engineer"])
        self.assertEqual(len(mail.outbox), 1)

        self.ok(t.engineer, "patch", f"{base}/actions/{action['id']}/", {"is_done": True})  # its responsible
        self.assertTrue(MeetingAction.objects.get(pk=action["id"]).is_done)
        self.assertEqual(self.send(t.lead, "patch", f"{base}/actions/{action['id']}/", {"is_done": False})
                         .status_code, 403)

        self.ok(t.chair, "post", f"{base}/minutes/", {"minutes": "We chose supplier A.", "publish": True})
        self.assertEqual(notified(Kind.MINUTES_PUBLISHED), ["Engineer", "Lead"])
        detail = self.ok(t.lead, "get", f"{base}/")
        self.assertEqual(detail["minutes"], "We chose supplier A.")
        self.assertEqual([row["text"] for row in detail["decisions"]], ["Order the BMS from supplier A"])

    def test_an_action_becomes_a_task_of_a_project(self):
        t = self.t
        meeting = self.schedule(organiser_id=t.manager.id)  # the EV project manager runs it
        base = f"/api/meetings/{meeting.id}"
        action = self.ok(t.manager, "post", f"{base}/actions/", {
            "description": "Wire the BMS harness", "responsible_id": t.engineer.id,
        }, status=201)
        self.assertEqual(
            self.send(t.chair, "post", f"{base}/actions/{action['id']}/task/", {"project_id": t.ev.id}).status_code,
            403,  # the chair is not involved in the project
        )
        created = self.ok(t.manager, "post", f"{base}/actions/{action['id']}/task/", {"project_id": t.ev.id},
                          status=201)
        task = Task.objects.get(pk=created["task"]["id"])
        self.assertEqual(task.title, "Wire the BMS harness")
        self.assertEqual([row.member for row in task.assignees.all()], [t.engineer])
        self.assertEqual(
            self.send(t.manager, "post", f"{base}/actions/{action['id']}/task/", {"project_id": t.ev.id}).status_code,
            400,  # already a task
        )


class ReminderTests(MeetingsTestCase):
    def test_mandatory_sessions_are_recalled_the_day_before_once(self):
        t = self.t
        tomorrow = timezone.now() + timedelta(days=1)
        self.schedule(start=tomorrow, is_mandatory=True, title="Mandatory")
        self.schedule(start=tomorrow, title="Optional")
        Notification.objects.all().delete()
        call_command("send_deadline_reminders", stdout=StringIO())
        call_command("send_deadline_reminders", stdout=StringIO())
        self.assertEqual(notified(Kind.MEETING_REMINDER), ["Engineer", "Lead"])
        self.assertEqual(
            set(Notification.objects.filter(kind=Kind.MEETING_REMINDER).values_list("data__meeting", flat=True)),
            {"Mandatory"},
        )
        self.assertEqual(Notification.objects.filter(member=t.engineer, kind=Kind.MEETING_REMINDER).count(), 1)
