"""The work orders of the team's Figma (decision D-022): each task has a readable reference, a progress, a
health computed from its dates, its progress and its blockers, its current phase and its next step."""

from datetime import timedelta

from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.projects.models import Project
from apps.projects.serializers import ProjectSerializer
from apps.projects.work_fixtures import build_team

from .models import Blocker, Task, TaskAssignee, TaskEvent, TaskEventKind, TaskStatus


class WorkOrderTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = t = build_team()
        t.ev.key = "EV27"
        t.ev.save()
        cls.today = timezone.localdate()
        cls.task = Task.objects.create(
            project=t.ev, subsystem=t.battery, title="Wire the BMS", status=TaskStatus.IN_PROGRESS,
            start_date=cls.today - timedelta(days=10), due_date=cls.today + timedelta(days=20),
        )
        TaskAssignee.objects.create(task=cls.task, member=t.engineer, is_primary=True)

    def read(self, task, member=None):
        self.client.force_authenticate(member or self.t.engineer)
        response = self.client.get(f"/api/tasks/{task.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def update(self, member=None, task=None, **data):
        self.client.force_authenticate(member or self.t.engineer)
        return self.client.post(f"/api/tasks/{(task or self.task).id}/progress/", data, format="json")

    # --- The reference ---

    def test_each_task_has_a_reference_numbered_in_its_project(self):
        second = Task.objects.create(project=self.t.ev, title="Test the BMS")
        other = Task.objects.create(project=self.t.ic, title="Compare engines")
        self.assertEqual((self.task.number, second.number, other.number), (1, 2, 1))
        self.assertEqual(self.read(self.task)["reference"], "EV27-001")
        self.assertEqual(self.read(second)["reference"], "EV27-002")
        self.assertEqual(self.read(other)["reference"], f"P{self.t.ic.id}-001")  # a project without its key

    def test_two_tasks_of_a_project_never_share_a_number(self):
        with transaction.atomic(), self.assertRaises(IntegrityError):
            Task.objects.create(project=self.t.ev, title="Copy", number=1)

    def test_a_project_key_is_short_capitals_and_digits_and_unique(self):
        self.client.force_authenticate(self.t.admin)
        url = f"/api/projects/{self.t.ic.id}/"
        for key in ("ev 27", "e", "TOOLONGKEY01", "EV27"):
            self.assertEqual(self.client.patch(url, {"key": key}, format="json").status_code, 400, key)
        response = self.client.patch(url, {"key": "ic27"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(Project.objects.get(pk=self.t.ic.pk).key, "IC27")  # written in capitals

    def test_a_key_shaped_like_a_default_reference_is_refused(self):
        # "P12" would clash with the references of the project with id 12 while it has no key ("P12-007").
        self.client.force_authenticate(self.t.admin)
        url = f"/api/projects/{self.t.ic.id}/"
        for key in ("P12", "p7", f"P{self.t.ic.id}"):
            response = self.client.patch(url, {"key": key}, format="json")
            self.assertEqual(response.status_code, 400, key)
            self.assertIn("key", response.json())
        self.assertEqual(self.client.patch(url, {"key": "PROTO"}, format="json").status_code, 200)

    def test_once_its_tasks_are_numbered_only_an_admin_changes_a_key(self):
        # The manager sets the key while the project has none; once set, renaming it would change every
        # reference already written: an admin only.
        t = self.t
        self.client.force_authenticate(t.manager)
        response = self.client.patch(f"/api/projects/{t.ev.id}/", {"key": "EV28"}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("key", response.json())
        self.assertEqual(self.client.patch(f"/api/projects/{t.ev.id}/", {"key": "ev27"}, format="json").status_code,
                         200)  # the same key: nothing changes
        t.ic.project_manager = t.manager
        t.ic.save()
        Task.objects.create(project=t.ic, title="Compare engines")
        self.assertEqual(self.client.patch(f"/api/projects/{t.ic.id}/", {"key": "IC27"}, format="json").status_code,
                         200)  # no key yet: its manager gives the first one
        self.client.force_authenticate(t.admin)
        self.assertEqual(self.client.patch(f"/api/projects/{t.ev.id}/", {"key": "EV28"}, format="json").status_code,
                         200)

    def test_the_default_reference_keeps_working_once_the_project_has_its_key(self):
        other = Task.objects.create(project=self.t.ic, title="Compare engines")
        Project.objects.filter(pk=self.t.ic.pk).update(key="IC27")
        self.client.force_authenticate(self.t.outsider)
        for reference in (f"P{self.t.ic.id}-001", "IC27-001"):
            response = self.client.get("/api/tasks/find/", {"reference": reference})
            self.assertEqual(response.json()["id"], other.id, reference)

    def test_two_projects_taking_one_key_at_the_same_moment_get_a_clear_refusal(self):
        self.client.force_authenticate(self.t.admin)
        with patch.object(ProjectSerializer, "validate_key", lambda serializer, key: key.strip().upper()):
            response = self.client.patch(f"/api/projects/{self.t.ic.id}/", {"key": "EV27"}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("key", response.json())
        self.assertEqual(Project.objects.get(pk=self.t.ic.pk).key, "")

    def test_a_task_is_found_by_its_reference(self):
        self.client.force_authenticate(self.t.outsider)  # every member sees every task
        response = self.client.get("/api/tasks/find/", {"reference": "ev27-001"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], self.task.id)
        other = Task.objects.create(project=self.t.ic, title="Compare engines")
        self.assertEqual(self.client.get("/api/tasks/find/", {"reference": f"P{self.t.ic.id}-1"}).json()["id"],
                         other.id)
        for missing in ("EV27-099", "XX-001", "nothing"):
            self.assertEqual(self.client.get("/api/tasks/find/", {"reference": missing}).status_code, 404, missing)

    def test_the_search_of_the_list_knows_the_references(self):
        self.client.force_authenticate(self.t.outsider)
        rows = self.client.get("/api/tasks/", {"search": "EV27-001"}).json()["results"]
        self.assertEqual([row["id"] for row in rows], [self.task.id])

    # --- The progress ---

    def test_the_assignee_updates_the_progress_the_phase_and_the_next_step(self):
        response = self.update(progress=40, current_phase="Câblage", next_step="Tester l'isolation")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual((data["progress"], data["progress_mode"]), (40, "manual"))
        self.assertEqual((data["current_phase"], data["next_step"]), ("Câblage", "Tester l'isolation"))
        event = TaskEvent.objects.get(task=self.task, kind=TaskEventKind.PROGRESS)
        self.assertEqual(event.actor, self.t.engineer)
        self.assertEqual(event.data["progress"], 40)

    def test_the_progress_goes_from_0_to_100(self):
        for value in (-5, 101):
            self.assertEqual(self.update(progress=value).status_code, 400, value)

    def test_who_updates_the_progress(self):
        self.assertEqual(self.update(member=self.t.outsider, progress=10).status_code, 403)
        self.assertEqual(self.update(member=self.t.lead, progress=10).status_code, 200)  # who leads the task
        self.assertTrue(self.read(self.task)["permissions"]["update_progress"])
        self.assertFalse(self.read(self.task, member=self.t.outsider)["permissions"]["update_progress"])

    def test_a_delivered_task_is_at_100_and_its_progress_no_longer_moves(self):
        self.task.status = TaskStatus.VALIDATED
        self.task.save()
        self.assertEqual(self.read(self.task)["progress"], 100)
        self.assertEqual(self.update(progress=50).status_code, 400)

    def test_a_task_with_subtasks_follows_them(self):
        Task.objects.create(project=self.t.ev, parent_task=self.task, title="A", status=TaskStatus.VALIDATED)
        Task.objects.create(project=self.t.ev, parent_task=self.task, title="B")
        Task.objects.create(project=self.t.ev, parent_task=self.task, title="C")
        Task.objects.create(project=self.t.ev, parent_task=self.task, title="D", status=TaskStatus.VALIDATED)
        data = self.read(self.task)
        self.assertEqual((data["progress"], data["progress_mode"]), (50, "automatic"))
        self.assertEqual(self.update(progress=80).status_code, 400)
        self.assertEqual(self.update(next_step="Finir C").status_code, 200)  # the rest stays theirs

    def test_an_update_that_changes_nothing_is_refused_and_counts_for_nothing(self):
        # Sending the same figures again every week must not pass for a weekly update in the ranking.
        self.assertEqual(self.update(progress=40, current_phase="Câblage").status_code, 200)
        response = self.update(progress=40, current_phase="Câblage")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(TaskEvent.objects.filter(task=self.task, kind=TaskEventKind.PROGRESS).count(), 1)
        self.assertEqual(self.update(current_phase="Câblage", next_step="Tester").status_code, 200)

    def test_a_progress_update_counts_as_a_meaningful_update_for_the_ranking(self):
        from apps.ranking.scoring import MEANINGFUL

        self.assertIn(TaskEventKind.PROGRESS, MEANINGFUL)

    # --- The health ---

    def health(self, **changes):
        Task.objects.filter(pk=self.task.pk).update(**changes)
        return self.read(Task.objects.get(pk=self.task.pk))["health"]

    def test_a_task_on_schedule_is_on_track(self):
        self.assertEqual(self.health(progress=40), "on_track")

    def test_a_task_far_behind_its_schedule_is_at_risk(self):
        # 10 days of 30 gone: about 33 % expected; 10 % done is more than 15 points behind.
        self.assertEqual(self.health(progress=10), "at_risk")

    def test_a_blocked_task_is_at_risk(self):
        Blocker.objects.create(task=self.task, description="Cells not delivered", reported_by=self.t.engineer)
        self.assertEqual(self.health(progress=50), "at_risk")

    def test_a_task_due_within_a_week_is_due_soon(self):
        self.assertEqual(self.health(progress=90, due_date=self.today + timedelta(days=5)), "due_soon")

    def test_a_task_past_its_due_date_is_overdue(self):
        self.assertEqual(self.health(due_date=self.today - timedelta(days=1)), "overdue")

    def test_a_delivered_task_was_done_on_time_or_late(self):
        on_time = timezone.now() - timedelta(days=1)
        due = self.today + timedelta(days=0)
        self.assertEqual(self.health(status=TaskStatus.VALIDATED, submitted_at=on_time, validated_at=on_time,
                                     due_date=due), "done_on_time")
        self.assertEqual(self.health(status=TaskStatus.SUBMITTED, submitted_at=on_time,
                                     due_date=self.today - timedelta(days=3)), "done_late")

    def test_the_list_costs_the_same_number_of_queries_with_more_tasks(self):
        self.client.force_authenticate(self.t.engineer)
        first = self.query_count()
        for index in range(5):
            Task.objects.create(project=self.t.ev, subsystem=self.t.battery, title=f"More {index}")
        self.assertEqual(self.query_count(), first)

    def query_count(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/tasks/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(all("reference" in row and "health" in row and "unit" in row
                            for row in response.json()["results"]))
        return len(queries)

    def test_each_task_names_its_team(self):
        self.assertEqual(self.read(self.task)["unit"]["code"], "t-electronics")  # its subsystem's department
        other = Task.objects.create(project=self.t.ic, title="Compare engines")
        self.assertEqual(self.read(other)["unit"]["code"], "t-fs-team")  # else the project's unit
