import shutil
import smtplib
import tempfile
from datetime import datetime, time, timedelta
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core import mail
from django.core.management import CommandError, call_command
from django.test import SimpleTestCase, TestCase
from django.utils import timezone, translation
from django.utils.translation import gettext as _
from rest_framework.test import APITestCase

from apps.members.models import Member, MemberRoleType, Membership, Role, RoleScope
from apps.projects.work_fixtures import build_team, person
from apps.subsystems.models import SubsystemStepProgress
from apps.tasks.models import Blocker, Task, TaskAssignee, TaskLink, TaskStatus

from .models import Notification, NotificationKind as Kind

VOLUNTEERING_STEP = "apps.communication.management.commands.send_deadline_reminders.volunteering_reminders"


def notified(kind):
    """Who received a notification of this kind, by first name."""
    return sorted(Notification.objects.filter(kind=kind).values_list("member__first_name", flat=True))


class NotificationEventsTests(APITestCase):
    """What the team is told about, and who (knowledge base: PROJECTS/ERP/notifications_design.md):
    never the person who acted, only active accounts; e-mails for assignments and awaited
    validations."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()

    def act(self, member, method, path, body=None):
        self.client.force_authenticate(member)
        # The e-mails leave once the change is saved (on commit): run those callbacks here.
        with self.captureOnCommitCallbacks(execute=True):
            response = getattr(self.client, method)(path, body or {}, format="json")
        self.assertLess(response.status_code, 300, response.content)
        return response

    def new_task(self, author, **fields):
        body = {"project_id": self.t.ev.id, "title": "Wire the BMS", **fields}
        return Task.objects.get(pk=self.act(author, "post", "/api/tasks/", body).json()["id"])

    def test_people_assigned_are_told_but_not_who_assigned_them(self):
        t = self.t
        task = self.new_task(
            t.manager, assignee_ids=[t.engineer.id, t.manager.id, t.teammate.id], primary_assignee_id=t.engineer.id
        )
        self.assertEqual(notified(Kind.TASK_ASSIGNED), ["Engineer", "Teammate"])
        notification = Notification.objects.get(member=t.engineer)
        self.assertEqual(notification.actor, t.manager)
        self.assertEqual((notification.related_entity_type, notification.related_entity_id), ("task", task.id))
        self.assertEqual(
            notification.data, {"task": "Wire the BMS", "project": "EV Test", "primary_id": t.engineer.id}
        )
        # By e-mail too, with a link to the task.
        self.assertEqual(sorted(message.to[0] for message in mail.outbox), [t.engineer.email, t.teammate.email])
        self.assertIn("Wire the BMS", mail.outbox[0].subject)
        self.assertIn(f"http://localhost:3000/fr/tasks/{task.id}", mail.outbox[0].body)
        self.assertIn("Manager Test", mail.outbox[0].body)

    def test_only_people_added_later_are_told(self):
        task = self.new_task(self.t.manager, assignee_ids=[self.t.engineer.id])
        self.act(self.t.manager, "patch", f"/api/tasks/{task.id}/", {"assignee_ids": [self.t.engineer.id, self.t.teammate.id]})
        self.assertEqual(notified(Kind.TASK_ASSIGNED), ["Engineer", "Teammate"])  # the engineer once only

    def test_comments_are_told_to_the_author_and_the_people_assigned(self):
        task = self.new_task(self.t.manager, assignee_ids=[self.t.engineer.id])
        mail.outbox = []
        self.act(self.t.teammate, "post", f"/api/tasks/{task.id}/comments/", {"content": "Cells arrive on Monday. " * 10})
        self.assertEqual(notified(Kind.TASK_COMMENTED), ["Engineer", "Manager"])
        excerpt = Notification.objects.filter(kind=Kind.TASK_COMMENTED).first().data["excerpt"]
        self.assertTrue(excerpt.startswith("Cells arrive on Monday."))
        self.assertLessEqual(len(excerpt), 140)
        self.assertTrue(excerpt.endswith("…"))
        self.assertEqual(mail.outbox, [])  # in the ERP only

    def test_a_submitted_task_and_a_blocker_ask_its_leaders_by_e_mail_and_a_revision_its_people(self):
        t = self.t
        task = Task.objects.create(
            project=t.ev, subsystem=t.battery, title="Wire the BMS", status=TaskStatus.IN_PROGRESS,
            created_by=t.engineer, scored=False,
        )
        TaskAssignee.objects.create(task=task, member=t.engineer, is_primary=True)
        TaskLink.objects.create(task=task, url="https://example.com/proof", added_by=t.engineer)
        self.act(t.engineer, "post", f"/api/tasks/{task.id}/submit/", {"actual_deliverable": "The harness"})
        self.assertEqual(notified(Kind.TASK_SUBMITTED), ["Lead", "Manager"])  # its validators, not its people
        self.assertEqual(
            sorted(message.to[0] for message in mail.outbox), ["lead@example.invalid", "manager@example.invalid"]
        )
        with translation.override("fr"):  # their language: the default one (LANGUAGE_CODE)
            self.assertEqual(mail.outbox[0].subject, _("To validate: %(task)s") % {"task": "Wire the BMS"})
        self.assertTrue(mail.outbox[0].subject.startswith("À valider"))

        mail.outbox.clear()
        self.act(t.lead, "post", f"/api/tasks/{task.id}/revise/", {"comment": "Add the connector pinout"})
        self.assertEqual(notified(Kind.TASK_REVISION), ["Engineer"])
        self.assertEqual(mail.outbox[0].to, ["engineer@example.invalid"])
        self.assertIn("Add the connector pinout", mail.outbox[0].body)

        mail.outbox.clear()
        self.act(t.engineer, "post", f"/api/tasks/{task.id}/blockers/", {"description": "No crimping tool"})
        self.assertEqual(notified(Kind.BLOCKER_DECLARED), ["Lead", "Manager"])
        self.assertEqual(len(mail.outbox), 2)
        blocker = Blocker.objects.get()
        self.act(t.lead, "post", f"/api/tasks/{task.id}/blockers/{blocker.id}/decide/", {"accept": True})
        self.assertEqual(notified(Kind.BLOCKER_UPDATED), ["Engineer"])  # its owner, who declared it

    def tick(self, member, subsystem, order, done=True):
        step = self.t.steps[order]
        self.act(member, "patch", f"/api/subsystems/{subsystem.id}/steps/{step.id}/", {"is_complete": done})

    def done_before(self, subsystem, *orders):
        for order in orders:
            SubsystemStepProgress.objects.create(
                subsystem=subsystem, lifecycle_step=self.t.steps[order], is_complete=True, completed_at=timezone.now()
            )

    def test_the_unit_leaders_are_asked_to_validate_once_the_steps_before_are_done(self):
        t = self.t
        self.done_before(t.battery, 1)
        self.tick(t.engineer, t.battery, 3)  # step 2 still to do: too early
        self.assertEqual(notified(Kind.VALIDATION_REQUESTED), [])

        self.tick(t.engineer, t.battery, 2)
        self.assertEqual(notified(Kind.VALIDATION_REQUESTED), ["Lead"])  # leads Electronics
        request = Notification.objects.get(kind=Kind.VALIDATION_REQUESTED)
        self.assertEqual(request.related_entity_type, "subsystem")
        self.assertEqual(
            request.data,
            {"subsystem": "Battery", "project": "EV Test", "project_id": t.ev.id, "step": "Validation par le chef"},
        )
        self.assertEqual([message.to for message in mail.outbox], [[t.lead.email]])
        self.assertIn(f"http://localhost:3000/fr/projects/{t.ev.id}?tab=subsystems", mail.outbox[0].body)

    def test_the_awaited_step_is_named_in_the_leader_language(self):
        # Saved as typed ("Validation par le chef", a standard step), named in the reader's language.
        t = self.t
        Member.objects.filter(pk=t.lead.pk).update(language="en")
        self.done_before(t.battery, 1, 2)
        self.tick(t.engineer, t.battery, 3)
        self.assertIn("before “Validation by the head” are done", mail.outbox[0].body)

    def test_without_a_leader_in_its_unit_the_request_goes_to_the_unit_above(self):
        t = self.t
        team_lead = person("teamlead")
        role = Role.objects.create(
            code="t-team-lead", name="Team Lead", role_type=MemberRoleType.HEAD_OF_DEPARTMENT, scope=RoleScope.FS_TEAM,
            is_leadership=True,
        )
        Membership.objects.create(member=team_lead, org_unit=t.fs_team, role=role)
        self.done_before(t.engine, 1, 2)
        self.tick(t.admin, t.engine, 3)  # nobody leads Aerodynamics
        self.assertEqual(notified(Kind.VALIDATION_REQUESTED), ["Teamlead"])

    def test_a_signed_validation_is_told_to_the_subsystem_and_the_project_manager(self):
        t = self.t
        self.done_before(t.battery, 1, 2, 3)
        self.tick(t.lead, t.battery, 4)
        self.assertEqual(notified(Kind.VALIDATION_SIGNED), ["Engineer", "Manager"])

    def test_inactive_accounts_are_not_told(self):
        task = self.new_task(self.t.manager, assignee_ids=[self.t.engineer.id])
        Member.objects.filter(pk=self.t.engineer.pk).update(is_active=False)
        self.act(self.t.teammate, "post", f"/api/tasks/{task.id}/comments/", {"content": "Done?"})
        self.assertEqual(notified(Kind.TASK_COMMENTED), ["Manager"])

    def test_each_person_gets_the_e_mail_in_their_language(self):
        Member.objects.filter(pk=self.t.engineer.pk).update(language="ar")
        self.new_task(self.t.manager, assignee_ids=[self.t.engineer.id])
        with translation.override("ar"):
            subject = _("Task assigned to you: %(task)s") % {"task": "Wire the BMS"}
        self.assertNotIn("Task assigned", subject)  # translated
        self.assertEqual(mail.outbox[0].subject, subject)
        self.assertIn("http://localhost:3000/ar/tasks/", mail.outbox[0].body)


class DeadlineRemindersTests(TestCase):
    """manage.py send_deadline_reminders (once a day): the people linked to an unfinished task
    (assigned, author, project manager) are told 3 days before its due date, then when it is past —
    once per due date, in the ERP and by e-mail."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        cls.today = timezone.localdate()

    def task(self, title, days, status=TaskStatus.PLANNED):
        task = Task.objects.create(
            project=self.t.ev, title=title, status=status, due_date=self.today + timedelta(days=days),
            created_by=self.t.teammate,
        )
        TaskAssignee.objects.create(task=task, member=self.t.engineer, is_primary=True)
        return task

    def remind(self):
        out = StringIO()
        # From the 20th, the run also reminds the volunteering (tested in apps.engagement): not about deadlines.
        with patch(VOLUNTEERING_STEP, return_value=0), self.captureOnCommitCallbacks(execute=True):  # e-mails on save
            call_command("send_deadline_reminders", stdout=out)
        return out.getvalue()

    def test_three_days_before_then_when_late_once_per_due_date(self):
        soon = self.task("Order the cells", 3)
        self.task("Later", 4)
        self.task("Already validated", 1, status=TaskStatus.VALIDATED)
        self.task("Submitted, awaiting its validation", 1, status=TaskStatus.SUBMITTED)
        frozen = self.task("Frozen by a validated blocker", -2)
        Blocker.objects.create(task=frozen, description="No parts", status="validated")
        late = self.task("Quote the inverter", -1)

        self.assertIn("6 notifications", self.remind())  # 3 people x 2 tasks
        self.assertEqual(notified(Kind.TASK_DUE_SOON), ["Engineer", "Manager", "Teammate"])
        self.assertEqual(notified(Kind.TASK_OVERDUE), ["Engineer", "Manager", "Teammate"])
        self.assertEqual(
            Notification.objects.filter(kind=Kind.TASK_DUE_SOON).first().data,
            {"task": "Order the cells", "project": "EV Test", "due_date": soon.due_date.isoformat()},
        )
        self.assertEqual(len(mail.outbox), 6)
        overdue_mail = next(message for message in mail.outbox if "Quote the inverter" in message.subject)
        self.assertTrue(overdue_mail.subject.startswith("🔴"))
        self.assertIn(f"/fr/tasks/{late.id}", overdue_mail.body)

        self.remind()  # the next day's run: nothing new
        self.assertEqual(Notification.objects.count(), 6)

        soon.due_date = self.today + timedelta(days=2)  # a new due date: a new reminder
        soon.save()
        self.remind()
        self.assertEqual(notified(Kind.TASK_DUE_SOON), ["Engineer", "Engineer", "Manager", "Manager", "Teammate", "Teammate"])


class NotificationApiTests(APITestCase):
    """/api/notifications/: each member sees and marks only their own."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        task = Task.objects.create(project=cls.t.ev, title="Wire the BMS")
        data = {"task": "Wire the BMS", "project": "EV Test"}
        cls.older = Notification.objects.create(
            member=cls.t.engineer, kind=Kind.TASK_DONE, actor=cls.t.teammate, data=data,
            related_entity_type="task", related_entity_id=task.id,
        )
        cls.newer = Notification.objects.create(
            member=cls.t.engineer, kind=Kind.TASK_COMMENTED, actor=cls.t.manager, data={**data, "excerpt": "Hi"},
            related_entity_type="task", related_entity_id=task.id,
        )
        cls.others = Notification.objects.create(member=cls.t.teammate, kind=Kind.MESSAGE, message="Welcome!")
        cls.task = task

    def test_needs_login(self):
        self.assertEqual(self.client.get("/api/notifications/").status_code, 401)

    def test_members_see_their_own_newest_first(self):
        self.client.force_authenticate(self.t.engineer)
        results = self.client.get("/api/notifications/").json()["results"]
        self.assertEqual([row["id"] for row in results], [self.newer.id, self.older.id])
        self.assertEqual(
            results[0],
            {
                "id": self.newer.id, "kind": "task_commented", "message": "",
                "actor": {"id": self.t.manager.id, "first_name": "Manager", "last_name": "Test"},
                "data": {"task": "Wire the BMS", "project": "EV Test", "excerpt": "Hi"},
                "target": {"type": "task", "id": self.task.id},
                "is_read": False, "created_at": results[0]["created_at"],
            },
        )
        self.client.force_authenticate(self.t.teammate)
        only = self.client.get("/api/notifications/").json()["results"]
        self.assertEqual([(row["kind"], row["message"], row["target"]) for row in only], [("message", "Welcome!", None)])

    def test_a_standard_step_is_named_in_the_reader_language(self):
        data = {"subsystem": "Battery", "project": "EV Test", "project_id": self.t.ev.id}
        signed = Notification.objects.create(
            member=self.t.engineer, kind=Kind.VALIDATION_SIGNED, actor=self.t.lead,
            data={**data, "step": "Validation par le chef"},
            related_entity_type="subsystem", related_entity_id=self.t.battery.id,
        )
        custom = Notification.objects.create(
            member=self.t.engineer, kind=Kind.VALIDATION_SIGNED, actor=self.t.lead,
            data={**data, "step": "Revue sécurité"},  # a step added by the team: as typed
            related_entity_type="subsystem", related_entity_id=self.t.battery.id,
        )
        self.client.force_authenticate(self.t.engineer)
        results = self.client.get("/api/notifications/", HTTP_ACCEPT_LANGUAGE="en").json()["results"]
        data_of = {row["id"]: row["data"] for row in results}
        self.assertEqual(data_of[signed.id]["step"], "Validation by the head")
        self.assertEqual(data_of[custom.id]["step"], "Revue sécurité")
        self.assertNotIn("step", data_of[self.newer.id])  # the other kinds have none

    def test_unread_count_and_marking_as_read(self):
        self.client.force_authenticate(self.t.engineer)
        self.assertEqual(self.client.get("/api/notifications/unread-count/").json(), {"count": 2})

        response = self.client.post(f"/api/notifications/{self.older.id}/read/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_read"])
        self.assertEqual(self.client.get("/api/notifications/unread-count/").json(), {"count": 1})
        self.assertEqual(
            [row["id"] for row in self.client.get("/api/notifications/?unread=true").json()["results"]], [self.newer.id]
        )
        # Someone else's: as if it did not exist.
        self.assertEqual(self.client.post(f"/api/notifications/{self.others.id}/read/").status_code, 404)

        self.assertEqual(self.client.post("/api/notifications/read-all/").json(), {"count": 1})
        self.assertEqual(self.client.get("/api/notifications/unread-count/").json(), {"count": 0})
        self.others.refresh_from_db()
        self.assertFalse(self.others.is_read)


class SchedulerTests(SimpleTestCase):
    """manage.py run_scheduler, on the server (docker-compose.prod.yml): the daily jobs, in club time."""

    def at(self, day, hour, minute=0):
        return timezone.make_aware(datetime(2026, 10, day, hour, minute))  # Africa/Algiers, no DST

    def test_the_next_run_is_today_or_tomorrow_at_the_given_time(self):
        from apps.communication.management.commands.run_scheduler import next_run

        seven = time(7, 0)
        self.assertEqual(next_run(self.at(20, 6, 59), seven), self.at(20, 7))
        self.assertEqual(next_run(self.at(20, 7), seven), self.at(21, 7))  # just done: tomorrow
        self.assertEqual(next_run(self.at(20, 23, 30), seven), self.at(21, 7))

    def test_the_next_job_is_the_soonest(self):
        from apps.communication.management.commands.run_scheduler import next_job

        jobs = [(time(7, 0), "send_deadline_reminders"), (time(3, 0), "other")]
        self.assertEqual(next_job(self.at(20, 5), jobs), (self.at(20, 7), "send_deadline_reminders"))
        self.assertEqual(next_job(self.at(20, 8), jobs), (self.at(21, 3), "other"))

    def test_it_waits_then_runs_the_reminders_and_survives_a_failure(self):
        from apps.communication.management.commands import run_scheduler

        class Stop(Exception):
            pass

        waits = []

        def sleep(seconds):
            waits.append(seconds)
            if len(waits) == 3:
                raise Stop

        out, err = StringIO(), StringIO()
        with (
            patch.object(run_scheduler.clock, "sleep", side_effect=sleep),
            patch.object(run_scheduler, "call_command", side_effect=[None, RuntimeError("SMTP down")]) as run,
            patch.object(run_scheduler.timezone, "now", return_value=self.at(20, 6, 30)),
            self.assertRaises(Stop),
        ):
            call_command("run_scheduler", stdout=out, stderr=err)
        self.assertEqual(waits[0], 30 * 60)  # 06:30 -> 07:00
        self.assertEqual([c.args[0] for c in run.call_args_list], ["send_deadline_reminders"] * 2)
        self.assertIn("Next: send_deadline_reminders at 2026-10-20 07:00", out.getvalue())
        self.assertIn("send_deadline_reminders failed: SMTP down", err.getvalue())  # and it goes on


class MailBackendTests(SimpleTestCase):
    """The real e-mails (SMTP) never go to addresses that can receive none, such as the demo's fictitious
    people (@example.invalid): those are printed in the server's console instead, so they can still
    sign in for a demonstration, as on a PC without e-mails."""

    def send(self, *recipients):
        from django.core.mail import EmailMessage, get_connection

        from apps.communication.mail import SMTPBackend

        out = StringIO()
        sent_by_smtp = []
        with patch("django.core.mail.backends.smtp.EmailBackend.send_messages", side_effect=lambda messages: sent_by_smtp.extend(messages) or len(messages)):
            connection = get_connection("apps.communication.mail.SMTPBackend", stream=out)
            self.assertIsInstance(connection, SMTPBackend)
            message = EmailMessage("Your login code", "123456", "erp@example.org", list(recipients), connection=connection)
            self.assertEqual(message.send(), 1)
        return sent_by_smtp, out.getvalue()

    def test_a_real_address_goes_through_smtp(self):
        sent, printed = self.send("member@g.enp.edu.dz")
        self.assertEqual([m.to for m in sent], [["member@g.enp.edu.dz"]])
        self.assertEqual(printed, "")

    def test_a_fictitious_address_is_printed_not_sent(self):
        sent, printed = self.send("lina.demo@example.invalid")
        self.assertEqual(sent, [])
        self.assertIn("To: lina.demo@example.invalid", printed)
        self.assertIn("123456", printed)

    def test_both_kinds_in_one_message_are_split(self):
        sent, printed = self.send("member@g.enp.edu.dz", "demo@example.invalid")
        self.assertEqual([m.to for m in sent], [["member@g.enp.edu.dz"]])
        self.assertIn("To: demo@example.invalid", printed)
        self.assertNotIn("member@g.enp.edu.dz", printed)

    def test_the_addresses_that_can_receive_nothing(self):
        from apps.communication.mail import deliverable

        for address in ["a@example.invalid", "b@demo.test", "c@example.com", "d@EXAMPLE.ORG", "e@localhost"]:
            self.assertFalse(deliverable(address), address)
        for address in ["member@g.enp.edu.dz", "club@gmail.com"]:
            self.assertTrue(deliverable(address), address)


class SetupEmailTests(SimpleTestCase):
    """manage.py setup_email, run by the script set_email.ps1: real e-mails from a Google account. The
    address and its app password are saved in the settings file only once a test e-mail went out with
    them; the password is typed hidden and never printed."""

    BEFORE = (
        "DEBUG=True\r\n"
        "EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend\r\n"
        "EMAIL_HOST=\r\n"
        "EMAIL_HOST_PASSWORD=\r\n"
        "# kept as it is\r\n"
        "REDIS_URL=redis://localhost:6379/0\r\n"
    )

    def setUp(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder)
        self.env_file = folder / ".env"
        self.env_file.write_bytes(self.BEFORE.encode())

    def run_setup(self, *args, typed=("club@school.example", "abcd efgh ijkl mnop"), refused=None):
        """Runs the command, `typed` being the address and the app password typed in, and `refused` the
        error of the mail server. Returns the e-mails sent (with their connection), what was printed,
        and the error that stopped the command, if any."""
        from django.core.mail.backends import smtp

        sent = []

        def send_messages(connection, messages):
            if refused:
                raise refused
            sent.extend((connection, message) for message in messages)
            return len(messages)

        out, error = StringIO(), None
        with (
            patch("builtins.input", return_value=typed[0]),
            patch("getpass.getpass", return_value=typed[1]),
            patch.object(smtp.EmailBackend, "send_messages", autospec=True, side_effect=send_messages),
        ):
            try:
                call_command("setup_email", *args, env_file=str(self.env_file), stdout=out)
            except CommandError as stopped:
                error = str(stopped)
        return sent, out.getvalue(), error

    def saved(self):
        from apps.communication.management.commands.setup_email import read_values

        return read_values(self.env_file.read_bytes().decode())

    def test_the_account_is_saved_once_the_test_email_went_out(self):
        sent, printed, error = self.run_setup()
        self.assertIsNone(error)
        [(connection, message)] = sent
        self.assertEqual((connection.host, connection.port, connection.use_tls), ("smtp.gmail.com", 587, True))
        self.assertEqual((connection.username, connection.password), ("club@school.example", "abcdefghijklmnop"))
        self.assertEqual(message.to, ["club@school.example"])
        self.assertEqual(message.from_email, "ENP Racing Team ERP <club@school.example>")
        self.assertEqual(
            {key: value for key, value in self.saved().items() if key.startswith(("EMAIL_", "DEFAULT_FROM"))},
            {
                "EMAIL_BACKEND": "apps.communication.mail.SMTPBackend",
                "EMAIL_HOST": "smtp.gmail.com",
                "EMAIL_PORT": "587",
                "EMAIL_USE_TLS": "True",
                "EMAIL_HOST_USER": "club@school.example",
                "EMAIL_HOST_PASSWORD": "abcdefghijklmnop",
                "DEFAULT_FROM_EMAIL": "ENP Racing Team ERP <club@school.example>",
            },
        )
        text = self.env_file.read_bytes().decode()
        self.assertTrue(text.startswith("DEBUG=True\r\nEMAIL_BACKEND=apps.communication.mail.SMTPBackend\r\n"))
        self.assertIn("\r\n# kept as it is\r\nREDIS_URL=redis://localhost:6379/0\r\n", text)
        self.assertNotIn("\n", text.replace("\r\n", ""))  # Windows line endings everywhere, as before
        self.assertIn("Now: no real e-mail", printed)
        self.assertIn("Real e-mails are on, sent from club@school.example", printed)
        self.assertNotIn("abcdefghijklmnop", printed)  # the password is never shown
        self.assertNotIn("abcd efgh", printed)

    def test_nothing_is_saved_when_google_refuses_the_password(self):
        refused = smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")
        sent, printed, error = self.run_setup(refused=refused)
        self.assertIn("Google refused this address or this app password", error)
        self.assertIn("nothing was changed", error)
        self.assertEqual(self.env_file.read_bytes(), self.BEFORE.encode())

    def test_nothing_is_saved_when_gmail_cannot_be_reached(self):
        sent, printed, error = self.run_setup(refused=TimeoutError("timed out"))
        self.assertIn("The test e-mail could not be sent (TimeoutError: timed out)", error)
        self.assertIn("nothing was changed", error)
        self.assertEqual(self.env_file.read_bytes(), self.BEFORE.encode())

    def test_what_is_not_an_address_or_an_app_password_is_refused_before_any_e_mail(self):
        for typed in [
            ("club@school.example", "MyUsualPassword1"),  # the password of the account itself: never
            ("club@school.example", ""),
            ("not an address", "abcd efgh ijkl mnop"),
            ("", "abcd efgh ijkl mnop"),
        ]:
            sent, printed, error = self.run_setup(typed=typed)
            self.assertEqual(sent, [], typed)
            self.assertIn("nothing was changed", error, typed)
            self.assertNotIn("MyUsualPassword1", printed + error)
        self.assertEqual(self.env_file.read_bytes(), self.BEFORE.encode())

    def test_enter_keeps_the_saved_address(self):
        self.run_setup()
        sent, printed, error = self.run_setup(typed=("", "mnop ijkl efgh abcd"))
        self.assertIsNone(error)
        self.assertEqual(sent[0][1].to, ["club@school.example"])
        self.assertEqual(self.saved()["EMAIL_HOST_PASSWORD"], "mnopijklefghabcd")
        self.assertIn("Now: real e-mails, sent from club@school.example", printed)

    def test_off_prints_the_codes_again_and_keeps_the_account(self):
        self.run_setup()
        sent, printed, error = self.run_setup("--off")
        self.assertIsNone(error)
        self.assertEqual(sent, [])
        saved = self.saved()
        self.assertEqual(saved["EMAIL_BACKEND"], "django.core.mail.backends.console.EmailBackend")
        self.assertEqual((saved["EMAIL_HOST_USER"], saved["EMAIL_HOST_PASSWORD"]), ("club@school.example", "abcdefghijklmnop"))
        self.assertIn("Real e-mails are off", printed)

    def test_on_tests_the_saved_account_again(self):
        self.run_setup()
        self.run_setup("--off")
        sent, printed, error = self.run_setup("--on", refused=TimeoutError("timed out"))
        self.assertIn("nothing was changed", error)
        self.assertEqual(self.saved()["EMAIL_BACKEND"], "django.core.mail.backends.console.EmailBackend")

        sent, printed, error = self.run_setup("--on", typed=("", ""))  # nothing is asked
        self.assertIsNone(error)
        [(connection, message)] = sent
        self.assertEqual((connection.username, connection.password), ("club@school.example", "abcdefghijklmnop"))
        self.assertEqual(self.saved()["EMAIL_BACKEND"], "apps.communication.mail.SMTPBackend")

    def test_on_needs_a_saved_account(self):
        sent, printed, error = self.run_setup("--on")
        self.assertIn("No account is saved yet", error)
        self.assertEqual(sent, [])
        self.assertEqual(self.env_file.read_bytes(), self.BEFORE.encode())

    def test_a_key_written_twice_is_changed_everywhere_and_a_file_keeps_its_line_endings(self):
        from apps.communication.management.commands.setup_email import with_values

        text = "A=1\nEMAIL_HOST=old\nB=2\nEMAIL_HOST=older"
        self.assertEqual(with_values(text, {"EMAIL_HOST": "new", "C": "3"}), "A=1\nEMAIL_HOST=new\nB=2\nEMAIL_HOST=new\nC=3\n")
