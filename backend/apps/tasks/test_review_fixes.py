"""Regression tests for the review of 24/11/2026: a leader may not score a task they assign to themselves, and the
assignees of a submitted or validated task (whose points the ranking counts) are kept."""

from rest_framework.test import APITestCase

from apps.projects.work_fixtures import build_team

from .models import Task, TaskAssignee, TaskStatus


class TaskReviewFixTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()

    def setUp(self):
        self.task = Task.objects.create(
            project=self.t.ev, subsystem=self.t.battery, title="Wire the BMS", created_by=self.t.engineer,
        )
        TaskAssignee.objects.create(task=self.task, member=self.t.engineer, is_primary=True)

    def patch(self, member, **data):
        self.client.force_authenticate(member)
        return self.client.patch(f"/api/tasks/{self.task.id}/", data, format="json")

    def test_a_leader_does_not_score_a_task_they_assign_to_themselves(self):
        response = self.patch(self.t.lead, points=5, assignee_ids=[self.t.lead.id])
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(self.patch(self.t.lead, points=5).status_code, 200)  # someone else's task: yes

    def test_the_assignees_of_a_validated_task_are_kept(self):
        Task.objects.filter(pk=self.task.pk).update(status=TaskStatus.VALIDATED, points=5, quality_mark=5)
        response = self.patch(self.t.manager, assignee_ids=[self.t.engineer.id, self.t.manager.id])
        self.assertEqual((response.status_code, list(response.json())), (400, ["assignee_ids"]))
        self.assertEqual(self.patch(self.t.manager, title="Wire the BMS (v2)").status_code, 200)
        self.assertEqual(self.patch(self.t.admin, assignee_ids=[self.t.engineer.id]).status_code, 200)
