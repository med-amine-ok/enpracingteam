"""The state of a project, as in the team's Figma (decision D-022): in preparation, on track, at risk, on hold or
completed; at risk once one of its tasks is late or blocked, or its tasks lag well behind its calendar."""

from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from apps.tasks.models import Blocker, BlockerStatus, Task, TaskStatus

from .models import Project, ProjectStatus
from .work_fixtures import build_team


class ProjectHealthTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        cls.today = timezone.localdate()

    def row(self, project):
        self.client.force_authenticate(self.t.outsider)  # every member sees every project
        rows = self.client.get("/api/projects/").json()["results"]
        return next(row for row in rows if row["id"] == project.id)

    def schedule(self, project, days_gone, days_left):
        Project.objects.filter(pk=project.pk).update(
            status=ProjectStatus.ACTIVE, start_date=self.today - timedelta(days=days_gone),
            end_date=self.today + timedelta(days=days_left),
        )

    def test_the_state_follows_the_project_status(self):
        ev, ic = self.t.ev, self.t.ic
        self.assertEqual(self.row(ic)["health"], "planning")  # planned
        Project.objects.filter(pk=ic.pk).update(status=ProjectStatus.ON_HOLD)
        self.assertEqual(self.row(ic)["health"], "on_hold")
        Project.objects.filter(pk=ic.pk).update(status=ProjectStatus.COMPLETED)
        self.assertEqual(self.row(ic)["health"], "completed")
        self.assertEqual(self.row(ev)["health"], "on_track")  # active, nothing late, no calendar

    def test_a_late_task_puts_the_project_at_risk(self):
        ev = self.t.ev
        late = Task.objects.create(project=ev, title="Order the cells", due_date=self.today - timedelta(days=2))
        Task.objects.create(project=ev, title="Done late", status=TaskStatus.VALIDATED,
                            due_date=self.today - timedelta(days=9))  # delivered: not late any more
        row = self.row(ev)
        self.assertEqual((row["tasks_overdue"], row["health"]), (1, "at_risk"))
        # Frozen by a validated blocker: not counted late (it waits for others), but blocked: still at risk.
        Blocker.objects.create(task=late, description="Supplier closed", status=BlockerStatus.VALIDATED)
        row = self.row(ev)
        self.assertEqual((row["tasks_overdue"], row["tasks_blocked"], row["health"]), (0, 1, "at_risk"))

    def test_tasks_well_behind_the_calendar_put_it_at_risk(self):
        ev = self.t.ev
        for index in range(4):
            Task.objects.create(project=ev, title=f"Part {index}",
                                status=TaskStatus.VALIDATED if index == 0 else TaskStatus.IN_PROGRESS)
        self.schedule(ev, days_gone=60, days_left=40)  # 60 % of the time gone, 25 % of the tasks validated
        self.assertEqual(self.row(ev)["health"], "at_risk")
        self.schedule(ev, days_gone=30, days_left=70)  # 30 % gone, 25 % done: within 15 points
        self.assertEqual(self.row(ev)["health"], "on_track")

    def test_the_detail_gives_the_same_state(self):
        Task.objects.create(project=self.t.ev, title="Late", due_date=self.today - timedelta(days=1))
        self.client.force_authenticate(self.t.outsider)
        self.assertEqual(self.client.get(f"/api/projects/{self.t.ev.id}/").json()["health"], "at_risk")
