from datetime import UTC, date, datetime, timedelta
from unittest.mock import patch

from django.apps import apps as django_apps
from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.communication.models import Notification, NotificationKind
from apps.projects.work_fixtures import build_team
from apps.subsystems.models import LifecycleStep

from .models import (
    Blocker, BlockerStatus, Task, TaskAssignee, TaskComment, TaskEvent, TaskEventKind, TaskLink, TaskPriority,
    TaskStatus,
)

NO_RIGHTS = {
    "edit": False, "delete": False, "comment": True, "start": False, "submit": False, "validate": False,
    "estimate": False, "declare_blocker": False, "update_progress": False,
}


class TaskApiTests(APITestCase):
    """/api/tasks/: every member sees every task; the rules of apps/projects/access.py decide who
    creates, changes and deletes them."""

    @classmethod
    def setUpTestData(cls):
        cls.t = t = build_team()
        today = timezone.localdate()
        cls.design = Task.objects.create(
            project=t.ev, subsystem=t.battery, lifecycle_step=t.steps[2], title="Design the battery pack",
            status=TaskStatus.IN_PROGRESS, priority=TaskPriority.HIGH, due_date=today - timedelta(days=1),
            created_by=t.manager, scored=False,
        )
        TaskAssignee.objects.create(task=cls.design, member=t.engineer, is_primary=True)
        cls.cells = Task.objects.create(
            project=t.ev, parent_task=cls.design, title="Choose the cells", status=TaskStatus.VALIDATED,
            due_date=today - timedelta(days=5), scored=False,
        )
        cls.wiring = Task.objects.create(project=t.ev, title="Plan the wiring", created_by=t.teammate)
        cls.engine = Task.objects.create(project=t.ic, title="Compare engines", priority=TaskPriority.LOW)

    def as_member(self, member):
        self.client.force_authenticate(member)

    def titles(self, query=""):
        response = self.client.get(f"/api/tasks/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return [task["title"] for task in response.json()["results"]]

    def create(self, **data):
        return self.client.post("/api/tasks/", {"project_id": self.t.ev.id, "title": "New task", **data}, format="json")

    def change(self, task, **data):
        return self.client.patch(f"/api/tasks/{task.id}/", data, format="json")

    # --- Reading ---

    def test_needs_login(self):
        self.assertEqual(self.client.get("/api/tasks/").status_code, 401)

    def test_every_member_sees_every_task_most_urgent_first(self):
        self.as_member(self.t.outsider)
        self.assertEqual(
            self.titles(), ["Design the battery pack", "Compare engines", "Choose the cells", "Plan the wiring"]
        )

    def test_a_listed_task_carries_what_a_card_shows(self):
        self.as_member(self.t.outsider)
        design = self.client.get("/api/tasks/?search=battery").json()["results"][0]
        self.assertEqual(design["project"], {"id": self.t.ev.id, "name": "EV Test", "category": "ev"})
        self.assertEqual(design["subsystem"], {"id": self.t.battery.id, "name": "Battery"})
        self.assertEqual(design["lifecycle_step"]["step_order"], 2)
        self.assertEqual(design["assignees"], [
            {"member": {"id": self.t.engineer.id, "first_name": "Engineer", "last_name": "Test"}, "is_primary": True}
        ])
        self.assertEqual((design["subtasks_total"], design["subtasks_done"], design["comments_count"]), (1, 1, 0))
        self.assertTrue(design["is_overdue"])  # due yesterday, not submitted
        self.assertEqual((design["is_blocked"], design["points"], design["scored"]), (False, None, False))
        self.assertEqual(design["permissions"], NO_RIGHTS)
        cells = self.client.get("/api/tasks/?search=cells").json()["results"][0]
        self.assertFalse(cells["is_overdue"])  # late, but validated
        self.assertEqual(cells["parent_id"], self.design.id)

    def test_the_step_is_named_in_the_reader_language(self):
        # Standard steps are saved in French (seed_lifecycle_steps): see apps/subsystems/tests.py.
        self.as_member(self.t.outsider)
        step = {"id": self.t.steps[2].id, "step_order": 2}
        for language, name in (("fr", "Conception CAD"), ("en", "CAD design")):
            listed = self.client.get("/api/tasks/?search=battery", HTTP_ACCEPT_LANGUAGE=language).json()["results"]
            self.assertEqual(listed[0]["lifecycle_step"], {**step, "name": name}, language)
            detail = self.client.get(f"/api/tasks/{self.design.id}/", HTTP_ACCEPT_LANGUAGE=language).json()
            self.assertEqual(detail["lifecycle_step"], {**step, "name": name}, language)

    def test_only_the_steps_of_the_projects_car(self):
        # An IC-only step (applies_to_ev off in the admin) is refused for the EV project (decision D-023).
        engine_test = LifecycleStep.objects.create(step_order=20, name="Engine bench test", applies_to_ev=False)
        self.as_member(self.t.manager)
        refused = self.create(lifecycle_step_id=engine_test.id)
        self.assertEqual(refused.status_code, 400)
        self.assertIn("lifecycle_step_id", refused.json())
        self.assertEqual(self.change(self.design, lifecycle_step_id=engine_test.id).status_code, 400)
        self.assertEqual(self.create(lifecycle_step_id=self.t.steps[2].id).status_code, 201)

    def test_filters(self):
        self.as_member(self.t.engineer)
        self.assertEqual(self.titles("?assignee=me"), ["Design the battery pack"])
        self.assertEqual(self.titles(f"?assignee={self.t.engineer.id}"), ["Design the battery pack"])
        self.assertEqual(self.titles(f"?project={self.t.ic.id}"), ["Compare engines"])
        self.assertEqual(self.titles(f"?subsystem={self.t.battery.id}"), ["Design the battery pack"])
        self.assertEqual(self.titles("?status=validated"), ["Choose the cells"])
        self.assertEqual(
            self.titles("?status=planned,validated"), ["Compare engines", "Choose the cells", "Plan the wiring"]
        )
        self.assertEqual(self.titles("?priority=low"), ["Compare engines"])
        self.assertEqual(self.titles(f"?parent={self.design.id}"), ["Choose the cells"])
        self.assertNotIn("Choose the cells", self.titles("?parent=none"))
        self.assertEqual(self.titles("?search=WIRING"), ["Plan the wiring"])
        self.assertEqual(self.titles("?overdue=true"), ["Design the battery pack"])
        Blocker.objects.create(task=self.wiring, description="Waiting for the harness drawing")
        self.assertEqual(self.titles("?blocked=true"), ["Plan the wiring"])
        self.assertEqual(self.client.get("/api/tasks/?project=abc").status_code, 400)

    def test_detail_with_subtasks_comments_and_rights(self):
        TaskComment.objects.create(task=self.design, author=self.t.lead, content="Check the cooling")
        expected = {
            self.t.manager: {
                **NO_RIGHTS, "edit": True, "delete": True, "declare_blocker": True, "update_progress": True,
            },
            self.t.lead: {**NO_RIGHTS, "edit": True, "declare_blocker": True, "update_progress": True},
            self.t.engineer: {  # the assignee
                **NO_RIGHTS, "submit": True, "declare_blocker": True, "update_progress": True,
            },
            self.t.outsider: NO_RIGHTS,
        }
        for member, permissions in expected.items():
            self.as_member(member)
            task = self.client.get(f"/api/tasks/{self.design.id}/").json()
            self.assertEqual(task["permissions"], permissions, member.first_name)
        self.assertEqual([subtask["title"] for subtask in task["subtasks"]], ["Choose the cells"])
        self.assertEqual(task["comments"][0]["content"], "Check the cooling")
        self.assertEqual(task["comments"][0]["author"]["id"], self.t.lead.id)
        self.assertEqual(task["created_by"]["id"], self.t.manager.id)
        self.assertEqual((task["blockers"], task["events"]), ([], []))

    def test_a_subtask_names_its_parent(self):
        self.as_member(self.t.outsider)
        subtask = self.client.get(f"/api/tasks/{self.cells.id}/").json()
        self.assertEqual(subtask["parent"], {"id": self.design.id, "title": "Design the battery pack"})
        self.assertIsNone(self.client.get(f"/api/tasks/{self.design.id}/").json()["parent"])

    def test_the_list_costs_the_same_queries_for_2_or_20_tasks(self):
        self.as_member(self.t.outsider)

        def queries():
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.client.get("/api/tasks/").status_code, 200)
            return len(captured)

        few = queries()
        for number in range(16):
            task = Task.objects.create(project=self.t.ev, title=f"Task {number}")
            TaskAssignee.objects.create(task=task, member=self.t.teammate, is_primary=True)
            TaskComment.objects.create(task=task, author=self.t.lead, content="Hello")
            Blocker.objects.create(task=task, description="Waiting")
        self.assertEqual(queries(), few)

    # --- Creating ---

    def test_people_involved_in_the_project_create_tasks(self):
        for member in (self.t.teammate, self.t.engineer, self.t.lead, self.t.manager, self.t.admin):
            self.as_member(member)
            response = self.create(title=f"By {member.first_name}")
            self.assertEqual(response.status_code, 201, member.first_name)
            self.assertEqual(response.json()["created_by"]["id"], member.id)
            self.assertEqual(response.json()["events"][0]["kind"], "created")

    def test_others_cannot_create_tasks(self):
        self.as_member(self.t.outsider)
        self.assertEqual(self.create().status_code, 403)
        self.as_member(self.t.teammate)
        self.assertEqual(self.create(project_id=self.t.ic.id).status_code, 403)  # not involved in IC

    def test_creates_with_assignees_the_first_one_main(self):
        self.as_member(self.t.teammate)
        response = self.create(
            subsystem_id=self.t.battery.id, lifecycle_step_id=self.t.steps[1].id, priority="medium",
            deliverable="A wiring plan", assignee_ids=[self.t.engineer.id, self.t.teammate.id],
        )
        self.assertEqual(response.status_code, 201, response.content)
        task = response.json()
        self.assertEqual(
            [(row["member"]["id"], row["is_primary"]) for row in task["assignees"]],
            [(self.t.engineer.id, True), (self.t.teammate.id, False)],
        )
        self.assertEqual(
            (task["status"], task["priority"], task["deliverable"], task["points"], task["scored"]),
            ("planned", "medium", "A wiring plan", None, True),
        )

    def test_refuses_incoherent_tasks(self):
        self.as_member(self.t.manager)
        cases = {
            "title": {"title": ""},
            "subsystem_id": {"subsystem_id": self.t.engine.id},  # subsystem of another project
            "parent_id": {"parent_id": self.engine.id},  # parent in another project
            "primary_assignee_id": {"assignee_ids": [self.t.engineer.id], "primary_assignee_id": self.t.lead.id},
            "assignee_ids": {"assignee_ids": [self.t.former.id]},  # inactive account
            "points": {"points": 6},
            "due_date": {"start_date": "2026-11-10", "due_date": "2026-11-01"},
        }
        for field, data in cases.items():
            response = self.create(**data)
            self.assertEqual(response.status_code, 400, field)
            self.assertIn(field, response.json(), field)

    def test_subtasks_have_one_level_only(self):
        self.as_member(self.t.manager)
        self.assertEqual(self.create(parent_id=self.design.id).status_code, 201)
        self.assertEqual(self.create(parent_id=self.cells.id).status_code, 400)  # a subtask of a subtask
        # A task with subtasks cannot become a subtask, nor move to another project.
        self.assertEqual(self.change(self.design, parent_id=self.wiring.id).status_code, 400)
        self.assertEqual(self.change(self.design, project_id=self.t.ic.id).status_code, 400)

    # --- Changing ---

    def test_assignees_change_nothing_but_through_the_steps_of_the_task(self):
        self.as_member(self.t.engineer)
        response = self.change(self.design, title="Renamed")
        self.assertEqual(response.status_code, 403)
        self.assertIn("étapes", response.json()["detail"])  # the API answers in French (LANGUAGE_CODE)

    def test_the_status_changes_only_through_the_steps_of_the_task(self):
        self.as_member(self.t.manager)
        response = self.change(self.design, status="validated")
        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.json())

    def test_author_manager_and_leaders_change_a_task(self):
        for member, task in ((self.t.teammate, self.wiring), (self.t.manager, self.design), (self.t.lead, self.design)):
            self.as_member(member)
            response = self.change(task, title=f"Changed by {member.first_name}", priority="low")
            self.assertEqual(response.status_code, 200, member.first_name)
            self.assertEqual(response.json()["title"], f"Changed by {member.first_name}")

    def test_changes_the_assignees_and_the_main_one(self):
        self.as_member(self.t.manager)
        response = self.change(self.design, assignee_ids=[self.t.teammate.id, self.t.engineer.id])
        # The engineer stays the main assignee.
        self.assertEqual(
            [(row["member"]["id"], row["is_primary"]) for row in response.json()["assignees"]],
            [(self.t.engineer.id, True), (self.t.teammate.id, False)],
        )
        response = self.change(self.design, primary_assignee_id=self.t.teammate.id)
        self.assertEqual(response.json()["assignees"][0]["member"]["id"], self.t.teammate.id)
        self.assertEqual(self.change(self.design, primary_assignee_id=self.t.lead.id).status_code, 400)
        response = self.change(self.design, assignee_ids=[])
        self.assertEqual(response.json()["assignees"], [])

    # --- Deleting ---

    def test_deleting_a_task_removes_its_subtasks(self):
        self.as_member(self.t.engineer)
        self.assertEqual(self.client.delete(f"/api/tasks/{self.design.id}/").status_code, 403)
        self.as_member(self.t.manager)
        self.assertEqual(self.client.delete(f"/api/tasks/{self.design.id}/").status_code, 204)
        self.assertFalse(Task.objects.filter(pk__in=[self.design.pk, self.cells.pk]).exists())

    def test_the_author_deletes_their_task(self):
        self.as_member(self.t.teammate)
        self.assertEqual(self.client.delete(f"/api/tasks/{self.wiring.id}/").status_code, 204)

    # --- Comments and links ---

    def test_any_member_comments(self):
        self.as_member(self.t.outsider)
        response = self.client.post(f"/api/tasks/{self.design.id}/comments/", {"content": "Good idea"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual((response.json()["author"]["id"], response.json()["can_delete"]), (self.t.outsider.id, True))
        self.assertEqual(self.client.post(f"/api/tasks/{self.design.id}/comments/", {"content": "  "}).status_code, 400)
        self.assertTrue(TaskEvent.objects.filter(task=self.design, kind=TaskEventKind.COMMENTED).exists())

    def test_comments_are_deleted_by_their_author_or_an_admin(self):
        first = TaskComment.objects.create(task=self.design, author=self.t.outsider, content="First")
        second = TaskComment.objects.create(task=self.design, author=self.t.outsider, content="Second")
        url = f"/api/tasks/{self.design.id}/comments/"
        self.as_member(self.t.manager)  # even the project manager may not delete someone else's comment
        self.assertEqual(self.client.delete(f"{url}{first.id}/").status_code, 403)
        self.as_member(self.t.outsider)
        self.assertEqual(self.client.delete(f"{url}{first.id}/").status_code, 204)
        self.as_member(self.t.admin)
        self.assertEqual(self.client.delete(f"{url}{second.id}/").status_code, 204)
        # A comment is reached through its own task only.
        other = TaskComment.objects.create(task=self.wiring, author=self.t.admin, content="Elsewhere")
        self.assertEqual(self.client.delete(f"{url}{other.id}/").status_code, 404)

    def test_the_people_of_a_task_add_links(self):
        url = f"/api/tasks/{self.design.id}/links/"
        link = {"url": "https://example.com/cad/pack", "label": "CAD of the pack", "link_type": "cad"}
        self.as_member(self.t.outsider)
        self.assertEqual(self.client.post(url, link, format="json").status_code, 403)
        self.as_member(self.t.engineer)  # assigned to it
        response = self.client.post(url, link, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual((response.json()["label"], response.json()["added_by"]["id"]), ("CAD of the pack", self.t.engineer.id))
        self.assertEqual(self.client.post(url, {**link, "url": "not a link"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {**link, "url": "javascript:alert(1)"}, format="json").status_code, 400)


class TaskWorkflowTests(APITestCase):
    """Planned → in progress → submitted → validated or to be reworked (decision D-012): the leaders set
    the points and dates, locked once work starts; a task is submitted with its evidence; a leader
    validates it with a quality mark."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()

    def setUp(self):
        self.task = Task.objects.create(
            project=self.t.ev, subsystem=self.t.battery, title="Wire the BMS", created_by=self.t.engineer,
        )
        TaskAssignee.objects.create(task=self.task, member=self.t.engineer, is_primary=True)

    def as_member(self, member):
        self.client.force_authenticate(member)

    def act(self, member, verb, **data):
        self.as_member(member)
        return self.client.post(f"/api/tasks/{self.task.id}/{verb}/", data, format="json")

    def estimate(self, member=None, **data):
        self.as_member(member or self.t.lead)
        values = {"points": 3, "start_date": "2026-10-20", "due_date": "2026-11-03", **data}
        return self.client.patch(f"/api/tasks/{self.task.id}/", values, format="json")

    def told(self, kind):
        return set(Notification.objects.filter(kind=kind).values_list("member__first_name", flat=True))

    def test_only_a_leader_sets_the_points_and_dates(self):
        for member in (self.t.engineer, self.t.teammate):  # the assignee, someone of the project
            response = self.estimate(member)
            self.assertEqual(response.status_code, 403, member.first_name)
        self.as_member(self.t.engineer)
        response = self.client.post(
            "/api/tasks/", {"project_id": self.t.ev.id, "title": "Mine", "points": 2}, format="json"
        )
        self.assertEqual(response.status_code, 403)  # a member cannot score their own work
        response = self.estimate()
        self.assertEqual(response.status_code, 200, response.content)
        task = response.json()
        self.assertEqual((task["points"], task["start_date"], task["due_date"]), (3, "2026-10-20", "2026-11-03"))
        self.assertEqual(task["events"][-1]["kind"], "estimated")
        self.assertEqual(self.estimate(self.t.manager, points=4).status_code, 200)  # the project manager too

    def test_work_starts_once_the_task_is_estimated_then_its_points_and_dates_are_locked(self):
        response = self.act(self.t.engineer, "start")
        self.assertEqual(response.status_code, 400)
        self.assertIn("points", response.json()["detail"])
        self.estimate()
        self.assertEqual(self.act(self.t.outsider, "start").status_code, 403)
        response = self.act(self.t.engineer, "start")
        self.assertEqual(response.status_code, 200, response.content)
        task = response.json()
        self.assertEqual((task["status"], task["initial_due_date"]), ("in_progress", "2026-11-03"))
        self.assertIsNotNone(task["started_at"])
        for change in ({"points": 5}, {"due_date": "2026-12-01"}, {"start_date": "2026-10-21"}):
            response = self.estimate(**change)
            self.assertEqual(response.status_code, 400, change)
        self.assertEqual(self.act(self.t.engineer, "start").status_code, 400)  # already started

    def test_a_task_of_before_starts_without_points(self):
        self.task.scored = False
        self.task.save()
        self.assertEqual(self.act(self.t.engineer, "start").status_code, 200)

    def test_a_task_is_submitted_with_what_was_delivered_and_its_evidence(self):
        self.estimate()
        self.act(self.t.engineer, "start")
        response = self.act(self.t.engineer, "submit")
        self.assertEqual(response.status_code, 400)
        self.assertIn("actual_deliverable", response.json())
        response = self.act(self.t.engineer, "submit", actual_deliverable="The BMS harness, tested")
        self.assertEqual(response.status_code, 400)  # no evidence
        self.assertIn("evidence_url", response.json())
        self.assertEqual(self.act(self.t.lead, "submit", actual_deliverable="x", evidence_url="https://example.com/x").status_code, 403)
        response = self.act(
            self.t.engineer, "submit", actual_deliverable="The BMS harness, tested",
            evidence_url="https://example.com/report/bms-test", evidence_label="Test report",
        )
        self.assertEqual(response.status_code, 200, response.content)
        task = response.json()
        self.assertEqual((task["status"], task["actual_deliverable"]), ("submitted", "The BMS harness, tested"))
        self.assertEqual([link["label"] for link in task["links"]], ["Test report"])
        self.assertIsNotNone(task["submitted_at"])
        self.assertEqual(self.told(NotificationKind.TASK_SUBMITTED), {"Lead", "Manager"})  # its validators

    def submitted(self, estimator=None):
        self.estimate(estimator)
        self.act(self.t.engineer, "start")
        TaskLink.objects.create(task=self.task, url="https://example.com/proof", added_by=self.t.engineer)
        response = self.act(self.t.engineer, "submit", actual_deliverable="Done")
        self.assertEqual(response.status_code, 200, response.content)

    def test_a_leader_validates_with_a_quality_mark(self):
        self.submitted()
        for member in (self.t.engineer, self.t.outsider, self.t.teammate):
            self.assertEqual(self.act(member, "validate", quality_mark=4).status_code, 403, member.first_name)
        for wrong in ({}, {"quality_mark": 6}, {"quality_mark": -1}):
            self.assertEqual(self.act(self.t.lead, "validate", **wrong).status_code, 400, wrong)
        response = self.act(self.t.lead, "validate", quality_mark=4)
        self.assertEqual(response.status_code, 200, response.content)
        task = response.json()
        self.assertEqual(
            (task["status"], task["quality_mark"], task["validated_by"]["id"]), ("validated", 4, self.t.lead.id)
        )
        self.assertEqual(self.told(NotificationKind.TASK_VALIDATED), {"Engineer"})
        self.assertEqual(self.act(self.t.lead, "validate", quality_mark=5).status_code, 400)  # already validated

    def test_a_leader_sends_it_back_with_what_to_rework_then_it_is_submitted_again(self):
        self.submitted()
        self.assertEqual(self.act(self.t.lead, "revise").status_code, 400)  # says what to rework
        response = self.act(self.t.lead, "revise", comment="The connector pinout is missing")
        self.assertEqual(response.status_code, 200, response.content)
        task = response.json()
        self.assertEqual(task["status"], "needs_revision")
        self.assertEqual(task["comments"][-1]["content"], "The connector pinout is missing")
        self.assertEqual(self.told(NotificationKind.TASK_REVISION), {"Engineer"})
        response = self.act(self.t.engineer, "submit", actual_deliverable="Done, with the pinout")
        self.assertEqual((response.status_code, response.json()["status"]), (200, "submitted"))

    def test_a_leader_assigned_to_the_task_does_not_validate_it(self):
        TaskAssignee.objects.create(task=self.task, member=self.t.lead)
        self.assertEqual(self.estimate().status_code, 403)  # assigned: not its leader for this task
        self.submitted(self.t.manager)
        self.assertEqual(self.act(self.t.lead, "validate", quality_mark=5).status_code, 403)
        self.assertEqual(self.act(self.t.manager, "validate", quality_mark=5).status_code, 200)

    def test_the_overdue_tasks_are_those_not_submitted_after_their_due_date(self):
        self.estimate(start_date="2026-10-01", due_date="2026-10-05")
        self.as_member(self.t.outsider)
        self.assertTrue(self.client.get(f"/api/tasks/{self.task.id}/").json()["is_overdue"])
        self.submitted_late()
        self.assertFalse(self.client.get(f"/api/tasks/{self.task.id}/").json()["is_overdue"])

    def submitted_late(self):
        self.act(self.t.engineer, "start")
        TaskLink.objects.create(task=self.task, url="https://example.com/proof", added_by=self.t.engineer)
        self.act(self.t.engineer, "submit", actual_deliverable="Done")
        self.as_member(self.t.outsider)


class TaskBlockerTests(APITestCase):
    """A blocker is declared on a task by its people; a leader validates it (the due date is frozen,
    then moved by the days it lasted) or rejects it; it is resolved by those concerned."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()

    def setUp(self):
        self.task = Task.objects.create(
            project=self.t.ev, subsystem=self.t.battery, title="Wire the BMS", created_by=self.t.engineer,
            status=TaskStatus.IN_PROGRESS, points=3, start_date=date(2026, 10, 1), due_date=date(2026, 10, 15),
            initial_due_date=date(2026, 10, 15),
        )
        TaskAssignee.objects.create(task=self.task, member=self.t.engineer, is_primary=True)

    def as_member(self, member):
        self.client.force_authenticate(member)

    def declare(self, member, **data):
        self.as_member(member)
        values = {
            "description": "The connectors are not delivered", "origin": "supplier", "severity": "high",
            "required_action": "Call the supplier", "known_since": "2026-10-11", **data,
        }
        return self.client.post(f"/api/tasks/{self.task.id}/blockers/", values, format="json")

    def blocker_action(self, member, blocker_id, verb, **data):
        self.as_member(member)
        return self.client.post(f"/api/tasks/{self.task.id}/blockers/{blocker_id}/{verb}/", data, format="json")

    def at(self, day):
        return patch("django.utils.timezone.now", return_value=datetime(2026, 10, day, 10, tzinfo=UTC))

    def test_the_people_of_the_task_declare_a_blocker_and_its_leaders_are_told(self):
        self.assertEqual(self.declare(self.t.outsider).status_code, 403)
        with self.at(13):
            response = self.declare(self.t.engineer, responsible_id=self.t.lead.id)
        self.assertEqual(response.status_code, 201, response.content)
        blocker = response.json()
        self.assertEqual(
            (blocker["status"], blocker["severity"], blocker["is_late"], blocker["reported_by"]["id"]),
            ("open", "high", False, self.t.engineer.id),
        )
        task = self.client.get(f"/api/tasks/{self.task.id}/").json()
        self.assertTrue(task["is_blocked"])
        self.assertEqual(task["blockers"][0]["description"], "The connectors are not delivered")
        self.assertEqual(
            set(Notification.objects.filter(kind=NotificationKind.BLOCKER_DECLARED).values_list("member__first_name", flat=True)),
            {"Lead", "Manager"},
        )

    def test_a_blocker_declared_more_than_two_working_days_after_it_was_known_is_late(self):
        with self.at(14):  # Wednesday: Monday, Tuesday, Wednesday after Sunday 11
            self.assertTrue(self.declare(self.t.engineer).json()["is_late"])
        with self.at(19):  # Monday: Friday and Saturday are not working days in Algeria
            self.assertFalse(self.declare(self.t.engineer, known_since="2026-10-15").json()["is_late"])

    def test_a_validated_blocker_freezes_the_due_date_then_moves_it_by_the_days_it_lasted(self):
        with self.at(12):
            blocker = self.declare(self.t.engineer).json()
        self.assertEqual(self.blocker_action(self.t.engineer, blocker["id"], "decide", accept=True).status_code, 403)
        with self.at(12):
            response = self.blocker_action(self.t.lead, blocker["id"], "decide", accept=True)
        self.assertEqual((response.status_code, response.json()["status"]), (200, "validated"))
        with patch("django.utils.timezone.localdate", return_value=date(2026, 10, 18)):
            self.assertFalse(self.client.get(f"/api/tasks/{self.task.id}/").json()["is_overdue"])  # frozen
        with self.at(17):
            response = self.blocker_action(self.t.engineer, blocker["id"], "resolve", resolution="Delivered")
        self.assertEqual((response.status_code, response.json()["status"]), (200, "resolved"))
        self.task.refresh_from_db()
        self.assertEqual((self.task.due_date, self.task.initial_due_date), (date(2026, 10, 20), date(2026, 10, 15)))
        self.assertEqual(
            list(self.task.events.values_list("kind", flat=True)),
            ["blocker_declared", "blocker_validated", "blocker_resolved", "deadline_moved"],
        )

    def test_a_rejected_blocker_moves_nothing(self):
        blocker = self.declare(self.t.engineer).json()
        self.assertEqual(self.blocker_action(self.t.lead, blocker["id"], "decide", accept=False).status_code, 400)
        response = self.blocker_action(self.t.lead, blocker["id"], "decide", accept=False, note="Use the spare ones")
        self.assertEqual((response.status_code, response.json()["status"]), (200, "rejected"))
        self.as_member(self.t.outsider)
        self.assertFalse(self.client.get(f"/api/tasks/{self.task.id}/").json()["is_blocked"])
        self.assertEqual(self.blocker_action(self.t.engineer, blocker["id"], "resolve", resolution="x").status_code, 400)

    def test_who_resolves_a_blocker(self):
        blocker = self.declare(self.t.engineer, responsible_id=self.t.teammate.id).json()
        self.assertEqual(self.blocker_action(self.t.outsider, blocker["id"], "resolve", resolution="x").status_code, 403)
        response = self.blocker_action(self.t.teammate, blocker["id"], "resolve", resolution="Found them")
        self.assertEqual((response.status_code, response.json()["resolution"]), (200, "Found them"))
        self.assertEqual(Blocker.objects.get().status, BlockerStatus.RESOLVED)


class WorkingDaysTests(SimpleTestCase):
    def test_working_days_run_from_sunday_to_thursday(self):
        from apps.tasks.workflow import working_days_between

        self.assertEqual(working_days_between(date(2026, 10, 11), date(2026, 10, 14)), 3)  # Sun → Wed
        self.assertEqual(working_days_between(date(2026, 10, 15), date(2026, 10, 19)), 2)  # Thu → Mon
        self.assertEqual(working_days_between(date(2026, 10, 15), date(2026, 10, 15)), 0)


class ConvertedStatusesTests(TestCase):
    """The tasks of before 20/10/2026 take the new statuses (migration tasks 0005)."""

    def test_the_old_statuses_are_converted(self):
        from importlib import import_module

        t = build_team()
        old = {
            status: Task.objects.create(project=t.ev, title=status, created_by=t.engineer) for status in ("todo", "blocked", "done", "in_progress")
        }
        for status, task in old.items():
            Task.objects.filter(pk=task.pk).update(status=status)
        import_module("apps.tasks.migrations.0005_convert_statuses").convert(django_apps, None)
        converted = {task.title: task.status for task in Task.objects.all()}
        self.assertEqual(
            converted, {"todo": "planned", "blocked": "in_progress", "done": "validated", "in_progress": "in_progress"}
        )
        self.assertFalse(Task.objects.filter(scored=True).exists())
        self.assertEqual(Blocker.objects.get().task.title, "blocked")
