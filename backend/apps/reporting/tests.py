"""The Team Manager's dashboard and the weekly and monthly reports (decision D-014, knowledge base:
PROJECTS/ERP/team_dashboard_design.md)."""

from datetime import date, datetime, time, timedelta
from io import BytesIO, StringIO

from django.core import mail
from django.core.management import call_command
from django.test import SimpleTestCase
from django.utils import timezone, translation
from openpyxl import load_workbook
from rest_framework.test import APITestCase

from apps.meetings.models import Attendance, Meeting
from apps.meetings.tests import build_meetings_team
from apps.members.models import MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.work_fixtures import person
from apps.reporting.models import SavedReport
from apps.tasks.models import Blocker, Task, TaskAssignee, TaskComment, TaskEvent, TaskEventKind, TaskStatus

from .health import member_statuses


class ReportingLabelsTests(SimpleTestCase):
    """"created by" is shared by tasks (مهمة, feminine) and reports (تقرير, masculine): in Arabic it
    must be a neutral noun, not a gendered verb such as أنشأها ("created her")."""

    def test_created_by_is_neutral_in_arabic(self):
        with translation.override("ar"):
            label = str(SavedReport._meta.get_field("created_by").verbose_name)
        self.assertNotEqual(label, "created by")
        self.assertNotIn("أنشأها", label)


def ago(days):
    return timezone.now() - timedelta(days=days)


def today(offset=0):
    return timezone.localdate() + timedelta(days=offset)


class DashboardTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        t = build_meetings_team()
        cls.t = t
        old = today(-200)
        type(t.engineer).objects.all().update(join_date=old)

        def task(title, *, status=TaskStatus.IN_PROGRESS, points=None, due=None, subsystem=t.battery, people=(),
                 project=None, quality=None, validated_days=None):
            item = Task.objects.create(
                project=project or (subsystem.project if subsystem else t.ev), subsystem=subsystem, title=title,
                status=status, points=points, due_date=due, quality_mark=quality,
                validated_at=ago(validated_days) if validated_days is not None else None,
            )
            for index, someone in enumerate(people):
                TaskAssignee.objects.create(task=item, member=someone, is_primary=index == 0)
            return item

        # Electronics: the lead has 2 overdue tasks (one critical and blocked), the engineer 3 critical ones.
        cls.late_critical = task("Wire the BMS", points=5, due=today(-4), people=[t.lead])
        task("Order the cells", points=2, due=today(-2), people=[t.lead])
        Blocker.objects.create(task=cls.late_critical, description="No crimping tool")
        for name in ("Pack CAD", "Cooling", "Harness"):
            task(name, points=4, due=today(20), people=[t.engineer])
        task("Fuse box", points=3, due=today(2), people=[t.engineer])  # important, due in 2 days
        task("Cells chosen", status=TaskStatus.VALIDATED, points=3, due=today(-10), people=[t.engineer],
             quality=4, validated_days=9)
        # Aerodynamics: one validated task, due in the period.
        task("Wing CFD", status=TaskStatus.VALIDATED, points=2, due=today(-5), subsystem=t.engine,
             people=[t.teammate], quality=5, validated_days=3)

        # Activity: the engineer commented 2 days ago, the teammate acted 10 days ago, the outsider never.
        comment = TaskComment.objects.create(task=cls.late_critical, author=t.engineer, content="On it")
        TaskComment.objects.filter(pk=comment.pk).update(created_at=ago(2))
        event = TaskEvent.objects.create(task=cls.late_critical, kind=TaskEventKind.COMMENTED, actor=t.teammate)
        TaskEvent.objects.filter(pk=event.pk).update(created_at=ago(10))
        lead_event = TaskEvent.objects.create(task=cls.late_critical, kind=TaskEventKind.STARTED, actor=t.lead)
        TaskEvent.objects.filter(pk=lead_event.pk).update(created_at=ago(1))
        for someone in (t.chair, t.tm, t.manager):
            TaskEvent.objects.create(task=cls.late_critical, kind=TaskEventKind.COMMENTED, actor=someone)

        # A mandatory session, confirmed: the engineer present, the lead late, the outsider absent... of
        # Electronics only: present 1 + late 0.5 over 2 = 75 %.
        start = ago(5)
        meeting = Meeting.objects.create(
            title="Weekly", kind="department", org_unit=t.electronics, starts_at=start,
            ends_at=start + timedelta(hours=1), is_mandatory=True, organiser=t.chair, attendance_confirmed_at=start,
        )
        Attendance.objects.create(meeting=meeting, member=t.engineer, status="present", checked_in_at=start)
        Attendance.objects.create(meeting=meeting, member=t.lead, status="late")

    def get(self, member, url, status=200):
        self.client.force_authenticate(member)
        response = self.client.get(url)
        self.assertEqual(response.status_code, status, getattr(response, "content", b"")[:300])
        return response


class DashboardAccessTests(DashboardTestCase):
    def test_the_board_the_team_manager_and_the_admins_see_the_team_each_leader_their_department(self):
        t = self.t
        board = OrgUnit.objects.create(code="board", name="Board of Directors", type=OrgUnitType.GOVERNING_BODY)
        director_role = Role.objects.create(
            code="board-member", name="Board Member", role_type=MemberRoleType.ADMIN, scope=RoleScope.CLUB,
            is_leadership=True,
        )
        director = person("director")
        Membership.objects.create(member=director, org_unit=board, role=director_role)
        # The chair holds a position given in the Executive Bureau: they see the whole team too.
        for member in (t.tm, director, t.admin, t.chair):
            data = self.get(member, "/api/reporting/dashboard/").json()
            self.assertEqual(data["scope"], "team", member.first_name)
        # The membership every leader gets in the Bureau does not count: the lead keeps their department (D-025).
        Role.objects.create(
            code="executive-bureau-member", name="Executive Bureau Member", role_type=MemberRoleType.ADMIN,
            scope=RoleScope.CLUB, is_leadership=True,
        )
        Membership.objects.filter(member=t.lead).first().save()  # the bureau's synchronisation adds them to it
        self.assertTrue(Membership.objects.filter(member=t.lead, org_unit=t.bureau, end_date__isnull=True).exists())
        self.assertEqual(self.get(t.lead, "/api/reporting/dashboard/").json()["scope"], "department")
        lead = self.get(t.lead, "/api/reporting/dashboard/").json()
        self.assertEqual(lead["scope"], "department")
        self.assertEqual([row["unit"]["name"] for row in lead["departments"]], ["Electronics"])
        self.assertEqual(sorted(row["member"]["first_name"] for row in lead["members"]), ["Engineer", "Lead"])
        self.get(t.engineer, "/api/reporting/dashboard/", status=403)

        self.assertEqual(self.get(t.tm, "/api/reporting/rights/").json(), {"dashboard": True, "reports": True})
        self.assertEqual(self.get(t.lead, "/api/reporting/rights/").json(), {"dashboard": True, "reports": False})
        self.assertEqual(self.get(t.engineer, "/api/reporting/rights/").json(), {"dashboard": False, "reports": False})


class MemberStatusTests(DashboardTestCase):
    def test_inactive_after_14_days_at_risk_after_7_or_with_2_overdue_tasks(self):
        t = self.t
        statuses = {row["member"].first_name: row["status"] for row in member_statuses(timezone.now())}
        self.assertEqual(statuses["Engineer"], "active")  # commented 2 days ago
        self.assertEqual(statuses["Teammate"], "at_risk")  # 10 days ago
        self.assertEqual(statuses["Outsider"], "inactive")  # never
        self.assertEqual(statuses["Lead"], "at_risk")  # active, but 2 overdue tasks
        self.assertNotIn("Alumnus", statuses)
        type(t.outsider).objects.filter(pk=t.outsider.pk).update(join_date=today(-5))
        statuses = {row["member"].first_name: row["status"] for row in member_statuses(timezone.now())}
        self.assertEqual(statuses["Outsider"], "active")  # arrived 5 days ago: not inactive yet


class IndicatorsTests(DashboardTestCase):
    def test_the_indicators_and_their_colours(self):
        from apps.discipline.models import season_of
        from apps.engagement.models import Objective

        for member in (self.t.lead, self.t.engineer):  # goals in progress this season (decision D-019)
            Objective.objects.create(member=member, season=season_of(timezone.localdate()), title="A goal")
        data = self.get(self.t.tm, "/api/reporting/dashboard/").json()
        indicators = data["indicators"]
        self.assertEqual(indicators["active_members"]["value"], 7)  # chair, tm, manager, lead, engineer, teammate, outsider
        self.assertEqual(indicators["inactive_members"]["value"], 3)  # outsider inactive, teammate and lead at risk
        self.assertEqual(indicators["inactive_members"]["status"], "red")  # 3 of 7 > 25 %
        self.assertEqual(indicators["attendance_rate"]["value"], 75.0)
        self.assertEqual(indicators["attendance_rate"]["status"], "orange")
        # Due in the last 30 days: Wire the BMS, Order the cells (open), Cells chosen, Wing CFD (validated).
        self.assertEqual(indicators["completion_rate"]["value"], 50.0)
        self.assertEqual(indicators["completion_rate"]["status"], "red")
        self.assertEqual((indicators["overdue_tasks"]["value"], indicators["overdue_tasks"]["status"]), (2, "orange"))
        self.assertEqual((indicators["blocked_tasks"]["value"], indicators["blocked_tasks"]["status"]), (1, "orange"))
        self.assertEqual(indicators["critical_tasks"]["value"], 4)
        self.assertEqual(indicators["unresolved_blockers"]["value"], 1)
        # Without a goal in progress this season: chair, tm, manager, teammate, outsider.
        self.assertEqual(indicators["members_without_objectives"]["value"], 5)
        self.assertEqual(data["overall"], "red")


class WarningTests(DashboardTestCase):
    def test_the_early_warnings(self):
        warnings = self.get(self.t.tm, "/api/reporting/dashboard/").json()["warnings"]
        found = {(row["kind"], (row["member"] or {}).get("first_name") or (row["task"] or {}).get("title")
                  or (row["department"] or {}).get("name")): row["severity"] for row in warnings}
        self.assertEqual(found[("member_overdue", "Lead")], "orange")  # 2 overdue tasks
        self.assertEqual(found[("member_inactive", "Outsider")], "red")
        self.assertEqual(found[("member_at_risk", "Teammate")], "orange")
        self.assertEqual(found[("critical_blocked", "Wire the BMS")], "red")
        self.assertEqual(found[("knowledge_concentration", "Engineer")], "orange")  # main on 3 critical tasks
        self.assertEqual(found[("workload", "Engineer")], "orange")  # 15 open points
        self.assertEqual(found[("deadline_close", "Fuse box")], "orange")
        self.assertNotIn(("department_overdue_critical", "Electronics"), found)  # only one overdue critical
        self.assertEqual(warnings[0]["severity"], "red")  # the reds first


class DepartmentTests(DashboardTestCase):
    def test_each_department_with_its_figures(self):
        rows = {row["unit"]["name"]: row for row in self.get(self.t.tm, "/api/reporting/dashboard/").json()["departments"]}
        self.assertEqual(sorted(rows), ["Aerodynamics", "Electronics", "Projects Office"])
        electronics = rows["Electronics"]
        self.assertEqual(
            {key: electronics[key] for key in ("members", "validated", "in_progress", "overdue", "critical", "blockers")},
            {"members": 2, "validated": 1, "in_progress": 6, "overdue": 2, "critical": 4, "blockers": 1},
        )
        self.assertEqual(electronics["attendance_rate"], 75.0)
        self.assertEqual(electronics["status"], "orange")
        self.assertEqual(rows["Aerodynamics"]["validated"], 1)


class ReportTests(DashboardTestCase):
    def test_the_weekly_report_on_screen_in_pdf_and_in_excel(self):
        t = self.t
        data = self.get(t.tm, "/api/reporting/reports/weekly/?lang=en").json()
        self.assertEqual(data["kind"], "weekly")
        self.assertEqual(data["title"], "Weekly team report")
        self.assertEqual([row["title"] for row in data["achievements"]], ["Wing CFD"])  # validated this week
        self.assertEqual(sorted(row["title"] for row in data["delayed"]), ["Order the cells", "Wire the BMS"])
        self.assertEqual([row["task"]["title"] for row in data["critical_blockers"]], ["Wire the BMS"])
        self.assertEqual(
            [row["title"] for row in data["priorities"]], ["Fuse box"],  # due within the next 7 days
        )
        self.assertEqual(self.get(t.tm, "/api/reporting/reports/weekly/?lang=fr").json()["title"],
                         "Rapport hebdomadaire de l'équipe")

        pdf = self.get(t.tm, "/api/reporting/reports/weekly/?export=pdf&lang=fr")
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        self.assertIn("attachment;", pdf["Content-Disposition"])

        xlsx = self.get(t.admin, "/api/reporting/reports/weekly/?export=xlsx&lang=en")
        book = load_workbook(BytesIO(xlsx.content))
        self.assertIn("Delayed tasks", book.sheetnames)
        self.assertEqual(book["Delayed tasks"]["A1"].value, "Task")

        self.get(t.lead, "/api/reporting/reports/weekly/", status=403)  # the whole team's: Board, TM, Bureau positions
        self.get(t.chair, "/api/reporting/reports/weekly/")  # a position given in the Bureau (decision D-025)
        self.get(t.tm, "/api/reporting/reports/weekly/?export=doc", status=400)

    def test_the_monthly_report_counts_what_each_member_delivered(self):
        t = self.t
        month = today().strftime("%Y-%m")
        data = self.get(t.tm, f"/api/reporting/reports/monthly/?month={month}&lang=en").json()
        self.assertEqual(data["kind"], "monthly")
        rows = {row["member"]["first_name"]: row for row in data["members"]}
        # Validated in the month... depending on the day of the month: count what this month holds.
        validated = Task.objects.filter(
            status=TaskStatus.VALIDATED, validated_at__date__gte=today().replace(day=1)
        )
        expected = {task.assignees.get(is_primary=True).member.first_name: task for task in validated}
        for name, task in expected.items():
            self.assertEqual(rows[name]["validated"], 1)
            self.assertEqual(rows[name]["delivered_points"], round(task.points * task.quality_mark / 5, 1))
        self.assertEqual(rows["Engineer"]["presence"], 100.0 if ago(5).month == timezone.now().month else None)
        pdf = self.get(t.tm, f"/api/reporting/reports/monthly/?month={month}&export=pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        self.get(t.tm, "/api/reporting/reports/monthly/?month=2026-13", status=400)


class WeeklyEmailTests(DashboardTestCase):
    def test_the_weekly_report_goes_to_who_sees_the_whole_team_with_its_pdf(self):
        board = OrgUnit.objects.create(code="board", name="Board of Directors", type=OrgUnitType.GOVERNING_BODY)
        director_role = Role.objects.create(
            code="board-member", name="Board Member", role_type=MemberRoleType.ADMIN, scope=RoleScope.CLUB,
            is_leadership=True,
        )
        Membership.objects.create(member=person("director"), org_unit=board, role=director_role)
        call_command("send_weekly_report", stdout=StringIO())
        recipients = sorted(address for message in mail.outbox for address in message.to)
        # Those who see the whole team: the Board, the Team Manager, the positions given in the Bureau (D-025).
        self.assertEqual(recipients, ["chair@example.invalid", "director@example.invalid", "tm@example.invalid"])
        message = mail.outbox[0]
        self.assertTrue(message.attachments[0][0].endswith(".pdf"))
        self.assertTrue(message.attachments[0][1].startswith(b"%PDF"))


class WeeklySchedulerTests(SimpleTestCase):
    def test_the_weekly_report_runs_on_sunday_at_7(self):
        from apps.communication.management.commands.run_scheduler import JOBS, next_run

        def at(day, hour, minute=0):
            return timezone.make_aware(datetime(2026, 10, day, hour, minute))

        sunday = 6
        self.assertEqual(next_run(at(20, 6, 59), time(7), sunday), at(25, 7))  # Tuesday 20/10 -> Sunday 25/10
        self.assertEqual(next_run(at(25, 7), time(7), sunday), at(25, 7) + timedelta(days=7))
        self.assertIn((time(7, 0), "send_weekly_report", sunday), JOBS)
        self.assertEqual(date(2026, 10, 25).weekday(), sunday)
