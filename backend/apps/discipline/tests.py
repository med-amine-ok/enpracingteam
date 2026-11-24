from datetime import date, timedelta

from django.core import mail
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.communication.models import Notification, NotificationKind as Kind
from apps.meetings.access import BUREAU_UNIT, TEAM_MANAGER_ROLE
from apps.meetings.models import Meeting, MeetingKind
from apps.members.models import MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.models import ProjectMember
from apps.projects.work_fixtures import build_team, person

from .models import Exclusion, ExclusionStatus, MemberWarning, Report, ReportStatus, WarningStatus, season_of


def build_discipline_team():
    """build_team() (apps/projects/work_fixtures.py) plus the Executive Bureau (`chair`) and the Team Manager (`tm`).

    `manager` manages the EV project, whose members are `teammate` and `engineer`; `lead` leads Electronics
    (`engineer`'s department). Aerodynamics (`teammate`, `outsider`) has no leader.
    """
    t = build_team()
    bureau = OrgUnit.objects.create(code=BUREAU_UNIT, name="Executive Bureau", type=OrgUnitType.GOVERNING_BODY)
    chair_role = Role.objects.create(code="t-bureau", name="Bureau member", role_type=MemberRoleType.ADMIN,
                                     scope=RoleScope.CLUB)
    tm_role = Role.objects.create(code=TEAM_MANAGER_ROLE, name="Team Manager",
                                  role_type=MemberRoleType.HEAD_OF_DEPARTMENT, scope=RoleScope.FS_TEAM)
    t.chair, t.tm = person("chair"), person("tm")
    Membership.objects.create(member=t.chair, org_unit=bureau, role=chair_role)
    Membership.objects.create(member=t.tm, org_unit=t.fs_team, role=tm_role)
    ProjectMember.objects.create(project=t.ev, member=t.engineer, role="Member")
    return t


def notified(kind):
    return sorted(Notification.objects.filter(kind=kind).values_list("member__first_name", flat=True))


class DisciplineTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_discipline_team()

    def send(self, member, method, url, data=None):
        self.client.force_authenticate(member)
        with self.captureOnCommitCallbacks(execute=True):
            return getattr(self.client, method)(url, data or {}, format="json")

    def ok(self, member, method, url, data=None, status=200):
        response = self.send(member, method, url, data)
        self.assertEqual(response.status_code, status, response.content[:500])
        return response.json() if response.content else None

    def warn(self, issuer, member, status=201, **extra):
        body = {"member_id": member.id, "ground": "commitments", "rule": "Art. 26 — Réunions",
                "facts": "Absent from three sessions without warning", "expected": "Warn before any absence", **extra}
        return self.ok(issuer, "post", "/api/discipline/warnings/", body, status=status)

    def council(self, days=3):
        start = timezone.now().replace(microsecond=0) + timedelta(days=days)
        return {"council_starts_at": start.isoformat(), "council_ends_at": (start + timedelta(hours=1)).isoformat(),
                "council_location": "Salle du club"}


class ReportAndWarningTests(DisciplineTestCase):
    def test_a_department_head_reports_and_the_project_manager_warns(self):
        t = self.t
        body = {"member_id": t.engineer.id, "ground": "commitments", "facts": "BMS wiring not done for 3 weeks"}
        self.assertEqual(self.send(t.teammate, "post", "/api/discipline/reports/", body).status_code, 403)
        report = self.ok(t.lead, "post", "/api/discipline/reports/", body, status=201)
        self.assertEqual(notified(Kind.WARNING_REPORTED), ["Manager"])  # the manager of the member's project
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.ok(t.engineer, "get", "/api/discipline/reports/")["results"], [])  # never the member's
        self.assertEqual(len(self.ok(t.manager, "get", "/api/discipline/reports/")["results"]), 1)
        self.warn(t.lead, t.engineer, status=403)  # a department head never warns (art. 27.1)
        warning = self.warn(t.manager, t.engineer, report_id=report["id"])
        self.assertEqual((warning["level"], warning["project"]["id"]), (1, t.ev.id))
        self.assertEqual(Report.objects.get(pk=report["id"]).status, ReportStatus.WARNED)
        self.assertEqual(notified(Kind.WARNING_ISSUED), ["Engineer", "Lead"])
        self.assertEqual(len(mail.outbox), 2)  # the member's e-mail; the head is told in the ERP only

    def test_a_report_may_be_dismissed_saying_why(self):
        t = self.t
        body = {"member_id": t.engineer.id, "ground": "communication", "facts": "No news"}
        report = self.ok(t.lead, "post", "/api/discipline/reports/", body, status=201)
        url = f"/api/discipline/reports/{report['id']}/dismiss/"
        self.assertEqual(self.send(t.lead, "post", url, {"note": "x"}).status_code, 403)  # not the authority
        self.assertEqual(self.send(t.manager, "post", url, {"note": ""}).status_code, 400)
        self.assertEqual(self.ok(t.manager, "post", url, {"note": "A validated blocker"})["status"],
                         ReportStatus.DISMISSED)

    def test_the_second_warning_creates_the_council_the_third_an_exclusion_to_confirm(self):
        t = self.t
        self.warn(t.chair, t.teammate)
        self.warn(t.chair, t.teammate, status=400)  # the council's date first
        second = self.warn(t.chair, t.teammate, **self.council())
        self.assertEqual(second["level"], 2)
        meeting = Meeting.objects.get(pk=second["council"]["id"])
        self.assertEqual((meeting.kind, meeting.is_mandatory, meeting.location), (MeetingKind.COUNCIL, False,
                                                                                  "Salle du club"))
        invited = sorted(meeting.attendances.values_list("member__first_name", flat=True))
        self.assertEqual(invited, ["Chair", "Manager", "Teammate", "Tm"])  # TM, project manager, member, issuer
        self.assertEqual(notified(Kind.MEETING_SCHEDULED), ["Manager", "Teammate", "Tm"])
        self.ok(t.chair, "post", f"/api/discipline/warnings/{second['id']}/council/",
                {"decision": "Pairing with a senior member for a month"})
        self.assertEqual(MemberWarning.objects.get(pk=second["id"]).council_decision,
                         "Pairing with a senior member for a month")
        third = self.warn(t.chair, t.teammate)
        self.assertEqual(third["level"], 3)
        exclusion = Exclusion.objects.get(member=t.teammate)
        self.assertEqual((exclusion.status, exclusion.cause), (ExclusionStatus.PENDING, "third_warning"))
        self.assertEqual(notified(Kind.EXCLUSION_PENDING), ["Tm"])  # the bureau, but who warned
        self.warn(t.chair, t.teammate, status=400)  # three already
        self.assertEqual(self.send(t.manager, "post", f"/api/discipline/exclusions/{exclusion.id}/confirm/")
                         .status_code, 403)
        self.ok(t.tm, "post", f"/api/discipline/exclusions/{exclusion.id}/confirm/")
        t.teammate.refresh_from_db()
        self.assertFalse(t.teammate.is_active)
        self.assertFalse(t.teammate.memberships.filter(end_date__isnull=True).exists())

    def test_the_count_restarts_each_season_and_a_cancelled_warning_no_longer_counts(self):
        t = self.t
        season = season_of(timezone.localdate())
        MemberWarning.objects.create(member=t.outsider, level=2, season=season - 1, ground="team_rules",
                                     facts="Last season", issued_by=t.chair)
        standing = self.ok(t.chair, "get", f"/api/discipline/standing/{t.outsider.id}/")
        self.assertEqual((standing["season"], standing["active_warnings"], standing["next_level"]), (season, 0, 1))
        warning = self.warn(t.chair, t.outsider)
        self.assertEqual(warning["level"], 1)
        url = f"/api/discipline/warnings/{warning['id']}/cancel/"
        self.assertEqual(self.send(t.manager, "post", url, {"reason": "Mistake"}).status_code, 404)  # not theirs
        self.ok(t.tm, "post", url, {"reason": "Wrong member"})
        self.assertEqual(MemberWarning.objects.get(pk=warning["id"]).status, WarningStatus.CANCELLED)
        self.assertEqual(self.ok(t.chair, "get", f"/api/discipline/standing/{t.outsider.id}/")["next_level"], 1)

    def test_the_member_sees_their_own_warnings_and_answers_them(self):
        t = self.t
        warning = self.warn(t.manager, t.engineer)
        self.warn(t.manager, t.manager, status=403)  # never to oneself
        self.assertEqual([row["id"] for row in self.ok(t.engineer, "get", "/api/discipline/warnings/")["results"]],
                         [warning["id"]])
        self.assertEqual(self.ok(t.outsider, "get", "/api/discipline/warnings/")["results"], [])
        self.assertEqual(len(self.ok(t.lead, "get", "/api/discipline/warnings/")["results"]), 1)  # their department
        url = f"/api/discipline/warnings/{warning['id']}/respond/"
        self.assertEqual(self.send(t.outsider, "post", url, {"response": "x"}).status_code, 404)
        self.assertEqual(self.send(t.manager, "post", url, {"response": "x"}).status_code, 403)
        data = self.ok(t.engineer, "post", url, {"response": "The parts arrived late; I warned on Discord."})
        self.assertEqual(data["member_response"], "The parts arrived late; I warned on Discord.")


class ExclusionAndRightsTests(DisciplineTestCase):
    def test_an_immediate_exclusion_is_proposed_then_confirmed_or_abandoned_by_the_bureau(self):
        t = self.t
        body = {"member_id": t.outsider.id, "serious_ground": "theft", "facts": "Took the club's oscilloscope"}
        self.assertEqual(self.send(t.manager, "post", "/api/discipline/exclusions/", body).status_code, 403)
        exclusion = self.ok(t.chair, "post", "/api/discipline/exclusions/", body, status=201)
        self.assertEqual(notified(Kind.EXCLUSION_PENDING), ["Tm"])
        self.assertEqual(self.send(t.chair, "post", "/api/discipline/exclusions/", body).status_code, 400)  # pending
        url = f"/api/discipline/exclusions/{exclusion['id']}"
        self.assertEqual(self.send(t.tm, "post", f"{url}/abandon/", {"note": ""}).status_code, 400)
        self.ok(t.tm, "post", f"{url}/abandon/", {"note": "Returned, a misunderstanding"})
        t.outsider.refresh_from_db()
        self.assertTrue(t.outsider.is_active)
        again = self.ok(t.chair, "post", "/api/discipline/exclusions/", body, status=201)
        self.ok(t.tm, "post", f"/api/discipline/exclusions/{again['id']}/confirm/")
        t.outsider.refresh_from_db()
        self.assertFalse(t.outsider.is_active)
        self.assertEqual(self.ok(t.engineer, "get", "/api/discipline/exclusions/")["results"], [])

    def test_the_rights_and_whom_each_one_may_report_or_warn(self):
        t = self.t
        expected = {
            t.engineer: (False, False, False), t.lead: (True, False, False), t.manager: (True, True, False),
            t.chair: (True, True, True),
        }
        for member, rights in expected.items():
            data = self.ok(member, "get", "/api/discipline/rights/")
            self.assertEqual((data["report"], data["issue"], data["sees_all"]), rights, member.first_name)
        names = lambda member: sorted(row["first_name"] for row in self.ok(member, "get", "/api/discipline/members/"))  # noqa: E731
        self.assertEqual(names(t.lead), ["Engineer"])
        self.assertEqual(names(t.manager), ["Engineer", "Teammate"])
        self.assertEqual(len(names(t.chair)), 6)  # everyone in the team but the chair
        self.assertEqual(self.ok(t.engineer, "get", "/api/discipline/members/"), [])

    def test_a_council_session_keeps_its_invitees(self):
        t = self.t
        self.warn(t.chair, t.teammate)
        second = self.warn(t.chair, t.teammate, **self.council())
        response = self.send(t.chair, "patch", f"/api/meetings/{second['council']['id']}/",
                             {"org_unit_id": t.aero.id})
        self.assertEqual(response.status_code, 400)


class SeasonTests(APITestCase):
    def test_a_season_starts_on_the_first_of_september(self):
        self.assertEqual(season_of(date(2026, 8, 31)), 2025)
        self.assertEqual(season_of(date(2026, 9, 1)), 2026)
