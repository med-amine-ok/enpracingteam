from datetime import date, datetime, time, timedelta
from io import StringIO

from django.core import mail
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.communication.models import Notification, NotificationKind as Kind
from apps.meetings.access import TEAM_MANAGER_ROLE
from apps.members.models import MemberRoleType, Membership, Role, RoleScope
from apps.projects.work_fixtures import build_team, person
from apps.tasks.models import Blocker, BlockerStatus, Task, TaskAssignee, TaskEvent, TaskEventKind, TaskStatus

from . import scoring
from .models import ContributionPoint, ContributionStatus, MonthlyAssessment, MonthlyScore, RankingPublication

OCTOBER = scoring.month_of(date(2026, 10, 1))
SEPTEMBER = scoring.month_of(date(2026, 9, 1))


def at(day, hour=12):
    return timezone.make_aware(datetime.combine(day, time(hour)))


def build_ranking_team():
    """build_team() (apps/projects/work_fixtures.py) plus `tm`, the Team Manager (in the FS team)."""
    t = build_team()
    role = Role.objects.create(
        code=TEAM_MANAGER_ROLE, name="Team Manager", role_type=MemberRoleType.HEAD_OF_DEPARTMENT,
        scope=RoleScope.FS_TEAM, is_leadership=False,
    )
    t.tm = person("tm")
    Membership.objects.create(member=t.tm, org_unit=t.fs_team, role=role)
    return t


class RankingTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_ranking_team()

    def task(self, member, points, start, due, *, quality=None, submitted=None, validated=None, title="Task"):
        """A scored task of `member`: validated when `validated` is given, else in progress."""
        task = Task.objects.create(
            project=self.t.ev, title=title, points=points, start_date=start, due_date=due, initial_due_date=due,
            started_at=at(start), scored=True, quality_mark=quality,
            status=TaskStatus.VALIDATED if validated else TaskStatus.IN_PROGRESS,
            submitted_at=at(submitted) if submitted else None, validated_at=at(validated) if validated else None,
        )
        TaskAssignee.objects.create(task=task, member=member, is_primary=True)
        return task

    def assess(self, member, month=OCTOBER, **marks):
        return MonthlyAssessment.objects.create(member=member, month=month.first, **marks)

    def month(self, member, month=OCTOBER):
        return scoring.compute_month(month, members=[member.pk])[member.pk]

    def send(self, member, method, url, data=None):
        self.client.force_authenticate(member)
        with self.captureOnCommitCallbacks(execute=True):
            return getattr(self.client, method)(url, data or {}, format="json")

    def ok(self, member, method, url, data=None, status=200):
        response = self.send(member, method, url, data)
        self.assertEqual(response.status_code, status, response.content[:500])
        return response.json() if response.content else None


class DeliveryTests(RankingTestCase):
    def test_points_quality_and_timing_make_the_performance(self):
        t = self.t
        self.task(t.engineer, 3, date(2026, 10, 1), date(2026, 10, 15), quality=5, submitted=date(2026, 10, 14),
                  validated=date(2026, 10, 16))  # one day early: on time (1.0)
        self.task(t.engineer, 2, date(2026, 10, 1), date(2026, 10, 10), quality=4, submitted=date(2026, 10, 12),
                  validated=date(2026, 10, 13))  # 2 days late on 9: up to 25 % (0.8)
        self.task(t.engineer, 1, date(2026, 10, 1), date(2026, 10, 20), quality=5, submitted=date(2026, 10, 5),
                  validated=date(2026, 10, 6))  # 15 days early, quality 5: early (1.1)
        result = self.month(t.engineer)
        self.assertEqual([entry.timing for entry in result.entries], [1.0, 0.8, 1.1])
        self.assertEqual(round(result.performance, 1), 89.7)  # (3×1 + 2×0.8×0.8 + 1×1.1) ÷ 6
        self.assertEqual(round(result.delivered_points, 2), 5.6)
        self.assertEqual(result.load, 100.0)  # the team's median is 0: anything delivered is enough
        self.assertEqual(round(result.delivery, 1), 92.8)  # 0.7 × 89.7 + 0.3 × 100
        self.assertIsNone(self.month(t.engineer, SEPTEMBER).delivery)  # nothing that month: not calculable

    def test_the_load_compares_with_the_median_lowered_for_excused_weeks_or_no_work(self):
        t = self.t
        start, due, done = date(2026, 10, 1), date(2026, 10, 20), date(2026, 10, 19)
        for member, points, quality in ((t.lead, 4, 5), (t.engineer, 3, 5), (t.teammate, 3, 3), (t.outsider, 2, 5),
                                        (t.manager, 1, 5)):
            self.task(member, points, start, due, quality=quality, submitted=done, validated=done)
        self.assess(t.teammate, no_work_available=True)  # its own 3 points become the reference
        self.assess(t.manager, excused_weeks=1)
        months = scoring.compute_month(OCTOBER)
        # Delivered: tm 0, manager 1, teammate 1.8, outsider 2, engineer 3, lead 4: the team's median is 1.9
        # (the departments have fewer than 4 members).
        self.assertEqual(round(months[t.engineer.pk].reference_load, 2), 1.9)
        self.assertEqual(months[t.engineer.pk].load, 100.0)
        self.assertEqual(round(months[t.teammate.pk].load, 1), 60.0)  # 1.8 ÷ 3
        self.assertEqual(round(months[t.manager.pk].load, 1), 68.0)  # 1 ÷ (1.9 × (1 − 1 ÷ 4.43))

    def test_a_task_too_late_at_month_end_is_not_delivered_then_scored_there_when_delivered(self):
        t = self.t
        task = self.task(t.engineer, 2, date(2026, 9, 1), date(2026, 9, 20))  # open, late by 10 of 19 days
        september = self.month(t.engineer, SEPTEMBER)
        self.assertEqual([(entry.not_delivered, entry.score) for entry in september.entries], [(True, 0.0)])
        self.assertEqual(september.performance, 0.0)
        Task.objects.filter(pk=task.pk).update(
            status=TaskStatus.VALIDATED, quality_mark=4, submitted_at=at(date(2026, 10, 4)),
            validated_at=at(date(2026, 10, 5)),
        )
        september = self.month(t.engineer, SEPTEMBER)
        self.assertEqual(round(september.performance, 1), 16.0)  # quality 0.8 × timing 0.2: September recalculated
        self.assertIsNone(self.month(t.engineer).delivery)  # not counted again in October

    def test_a_validated_blocker_freezes_the_due_date(self):
        t = self.t
        task = self.task(t.engineer, 2, date(2026, 10, 1), date(2026, 10, 10), quality=5,
                         submitted=date(2026, 10, 15), validated=date(2026, 10, 16))
        Blocker.objects.create(
            task=task, description="Supplier late", reported_by=t.engineer, status=BlockerStatus.VALIDATED,
            decided_by=t.lead, decided_at=at(date(2026, 10, 8)),
        )
        self.assertEqual([entry.timing for entry in self.month(t.engineer).entries], [1.0])


class ReliabilityAndTeamTests(RankingTestCase):
    def test_update_rate_and_the_communication_mark_capped_by_late_blockers(self):
        t = self.t
        task = self.task(t.engineer, 2, date(2026, 10, 1), date(2026, 10, 25), quality=4,
                         submitted=date(2026, 10, 19), validated=date(2026, 10, 20))
        for kind, day in ((TaskEventKind.STARTED, date(2026, 10, 1)), (TaskEventKind.COMMENTED, date(2026, 10, 12))):
            event = TaskEvent.objects.create(task=task, kind=kind, actor=t.engineer)
            TaskEvent.objects.filter(pk=event.pk).update(created_at=at(day))
        for late in (True, False):
            blocker = Blocker.objects.create(task=task, description="Parts", reported_by=t.engineer, is_late=late)
            Blocker.objects.filter(pk=blocker.pk).update(reported_at=at(date(2026, 10, 6)))
        self.assess(t.engineer, communication_mark=5)
        result = self.month(t.engineer)
        # Weeks of October 2026 (Sunday to Saturday): 1-3, 4-10, 11-17, 18-24, 25-31. In progress: the first four;
        # updated: the 1st and the 3rd.
        self.assertEqual((result.weeks_in_progress, result.weeks_updated, result.update_rate), (4, 2, 50.0))
        self.assertEqual((result.late_blockers, result.communication_cap, result.communication_mark), (1, 4, 4))
        self.assertEqual(result.reliability, 65.0)  # 0.5 × 50 + 0.5 × 80

    def test_contribution_points_marks_na_and_the_bonuses(self):
        t = self.t
        for points, day, status in ((2, date(2026, 10, 3), ContributionStatus.VALIDATED),
                                    (1, date(2026, 10, 20), ContributionStatus.VALIDATED),
                                    (3, date(2026, 10, 21), ContributionStatus.PROPOSED),
                                    (2, date(2026, 9, 30), ContributionStatus.VALIDATED)):
            ContributionPoint.objects.create(member=t.engineer, points=points, description="Help", occurred_on=day,
                                             status=status)
        self.assess(t.engineer, workshop_mark=4, events_na_reason="No event this month", logistics_mark=3,
                    effort_mark=4)  # an effort without evidence: 2 at most
        result = self.month(t.engineer)
        self.assertEqual(result.contribution_points, 3)
        self.assertEqual(result.events, {"mark": None, "na": "No event this month", "score": None})
        self.assertEqual(result.effort_mark, 2)
        # Base (0.55 × 50 + 0.25 × 80) ÷ 0.80 = 59.4, bonus 2 × 3 + 2 × 2 = 10.
        self.assertEqual(round(result.team, 1), 69.4)

    def test_a_missing_part_gives_its_weight_to_the_others_and_the_score_is_provisional(self):
        t = self.t
        ContributionPoint.objects.create(member=t.outsider, points=3, description="CFD help",
                                         occurred_on=date(2026, 10, 9), status=ContributionStatus.VALIDATED)
        result = self.month(t.outsider)
        self.assertEqual((result.delivery, result.presence, result.reliability), (None, None, None))
        self.assertEqual((result.team, result.final, result.provisional), (50.0, 50.0, True))


class RankingRulesTests(TestCase):
    def test_categories(self):
        cases = [(86, 60, "A"), (86, 59, "B"), (86, None, "B"), (70, None, "B"), (69.9, None, "C"),
                 (55, None, "C"), (40, None, "D"), (39.9, None, "E"), (None, None, "")]
        for score, load, expected in cases:
            self.assertEqual(scoring.category(score, load), expected, (score, load))

    def test_ranks_by_score_then_delivery_then_team_equal_rows_share(self):
        rows = [
            {"name": "a", "ranking_score": 80, "delivery": 70, "team": 50},
            {"name": "b", "ranking_score": 80, "delivery": 75, "team": 10},
            {"name": "c", "ranking_score": 80, "delivery": 75, "team": 10},
            {"name": "d", "ranking_score": 90, "delivery": None, "team": 0},
            {"name": "e", "ranking_score": None, "delivery": None, "team": 0},
        ]
        ranks = {row["name"]: row["rank"] for row in scoring.rank(rows)}
        self.assertEqual(ranks, {"d": 1, "b": 2, "c": 2, "a": 4, "e": None})

    def test_the_ranking_score_averages_the_last_three_calculable_months(self):
        t = build_ranking_team()
        for month, final, load in ((date(2026, 6, 1), 20, 10), (date(2026, 7, 1), 90, 70), (date(2026, 8, 1), 80, 50),
                                   (date(2026, 9, 1), None, None)):
            publication = RankingPublication.objects.create(month=month, published_at=at(month))
            MonthlyScore.objects.create(publication=publication, member=t.engineer, final=final, load=load)
        score, load = scoring.ranking_score(t.engineer.pk, OCTOBER, 60, None)
        self.assertEqual(score, (60 + 80 + 90) / 3)  # September is not calculable: June is too old
        self.assertEqual(load, 60)  # the loads of the same months: August 50, July 70


class RankingApiTests(RankingTestCase):
    def previous_month(self):
        return scoring.month_of(timezone.localdate()).previous()

    def test_each_member_sees_their_score_leaders_their_department_the_tm_everyone(self):
        t = self.t
        mine = self.ok(t.engineer, "get", "/api/ranking/me/")
        self.assertEqual(mine["month"], scoring.month_of(timezone.localdate()).key)
        self.assertTrue(mine["score"]["provisional"])
        self.assertEqual(mine["history"], [])
        url = f"/api/ranking/members/{t.engineer.id}/?month=2026-10"
        self.assertEqual(self.send(t.teammate, "get", url).status_code, 403)
        for viewer in (t.lead, t.tm, t.admin):
            self.assertEqual(self.ok(viewer, "get", url)["member"]["id"], t.engineer.id)
        self.assertEqual(self.send(t.engineer, "get", "/api/ranking/months/2026-10/").status_code, 403)
        rows = self.ok(t.lead, "get", "/api/ranking/months/2026-10/")["rows"]
        self.assertEqual(sorted(row["member"]["first_name"] for row in rows), ["Engineer", "Lead"])
        rows = self.ok(t.tm, "get", "/api/ranking/months/2026-10/")["rows"]
        self.assertEqual(len(rows), 6)
        rights = self.ok(t.lead, "get", "/api/ranking/rights/")
        self.assertEqual((rights["team"], rights["publish"]), (True, False))
        self.assertEqual(self.ok(t.tm, "get", "/api/ranking/rights/")["publish"], True)
        self.assertEqual(self.ok(t.engineer, "get", "/api/ranking/rights/")["team"], False)

    def test_the_department_head_assesses_never_themself(self):
        t = self.t
        url = f"/api/ranking/members/{t.engineer.id}/assessment/"
        body = {"month": "2026-10", "communication_mark": 4, "workshop_mark": None, "workshop_na_reason": "Remote",
                "events_mark": 3, "excused_weeks": "1.0"}
        self.assertEqual(self.send(t.teammate, "put", url, body).status_code, 403)
        data = self.ok(t.lead, "put", url, body)
        self.assertEqual(data["score"]["details"]["workshop"], {"mark": None, "na": "Remote", "score": None})
        assessment = MonthlyAssessment.objects.get(member=t.engineer, month=date(2026, 10, 1))
        self.assertEqual((assessment.communication_mark, assessment.assessed_by), (4, t.lead))
        self.ok(t.tm, "put", url, {**body, "communication_mark": 5})  # the Team Manager corrects
        self.assertEqual(MonthlyAssessment.objects.get(pk=assessment.pk).communication_mark, 5)
        own = f"/api/ranking/members/{t.lead.id}/assessment/"
        self.assertEqual(self.send(t.lead, "put", own, body).status_code, 403)
        self.assertEqual(self.send(t.lead, "put", url, {**body, "events_mark": 6}).status_code, 400)
        both = {**body, "workshop_mark": 2, "workshop_na_reason": "Remote"}
        self.assertEqual(self.send(t.lead, "put", url, both).status_code, 400)  # a mark or N/A, not both

    def test_contribution_points_proposed_then_decided_by_the_department_head(self):
        t = self.t
        body = {"member_id": t.engineer.id, "points": 2, "description": "Helped Aero with the CFD",
                "occurred_on": "2026-10-05"}
        own = self.ok(t.engineer, "post", "/api/contributions/", body, status=201)
        self.assertEqual(own["status"], ContributionStatus.PROPOSED)
        self.assertEqual(sorted(Notification.objects.filter(kind=Kind.CONTRIBUTION_PROPOSED)
                                .values_list("member__first_name", flat=True)), ["Lead"])
        helped = self.ok(t.teammate, "post", "/api/contributions/", {**body, "points": 1}, status=201)
        self.assertEqual(self.send(t.teammate, "post", f"/api/contributions/{own['id']}/validate/").status_code,
                         404)  # not theirs to see
        self.assertEqual(self.send(t.teammate, "post", f"/api/contributions/{helped['id']}/validate/").status_code,
                         403)  # proposed by them, not theirs to decide
        self.assertEqual(self.send(t.engineer, "post", f"/api/contributions/{own['id']}/validate/").status_code, 403)
        self.assertEqual(self.ok(t.lead, "post", f"/api/contributions/{own['id']}/validate/")["status"],
                         ContributionStatus.VALIDATED)
        self.assertEqual(self.send(t.lead, "post", f"/api/contributions/{helped['id']}/reject/", {"note": ""})
                         .status_code, 400)
        self.ok(t.lead, "post", f"/api/contributions/{helped['id']}/reject/", {"note": "Part of the member's own task"})
        self.assertEqual(sorted(Notification.objects.filter(kind=Kind.CONTRIBUTION_DECIDED)
                                .values_list("member__first_name", flat=True)), ["Engineer", "Engineer", "Teammate"])
        direct = self.ok(t.lead, "post", "/api/contributions/", {**body, "points": 3}, status=201)
        self.assertEqual(direct["status"], ContributionStatus.VALIDATED)  # entered by the head: validated
        self.assertEqual(self.send(t.engineer, "post", "/api/contributions/", {**body, "points": 4}).status_code, 400)
        rows = self.ok(t.outsider, "get", "/api/contributions/")["results"]
        self.assertEqual(rows, [])  # neither theirs nor theirs to decide
        rows = self.ok(t.lead, "get", "/api/contributions/?status=proposed")["results"]
        self.assertEqual(rows, [])

    def test_the_team_manager_publishes_a_past_month_and_the_members_are_told(self):
        t = self.t
        month = self.previous_month()
        ContributionPoint.objects.create(member=t.engineer, points=3, description="Help", occurred_on=month.first,
                                         status=ContributionStatus.VALIDATED)
        current = scoring.month_of(timezone.localdate()).key
        self.assertEqual(self.send(t.tm, "post", f"/api/ranking/months/{current}/publish/").status_code, 400)
        url = f"/api/ranking/months/{month.key}/publish/"
        for member in (t.engineer, t.lead):
            self.assertEqual(self.send(member, "post", url).status_code, 403)
        data = self.ok(t.tm, "post", url)
        self.assertIsNotNone(data["published_at"])
        score = MonthlyScore.objects.get(member=t.engineer, publication__month=month.first)
        self.assertEqual((score.final, score.category, score.rank), (50.0, "D", 1))
        self.assertEqual(MonthlyScore.objects.filter(publication__month=month.first).count(), 6)
        told = Notification.objects.filter(kind=Kind.RANKING_PUBLISHED)
        self.assertEqual(told.count(), 5)  # everyone but the Team Manager, who published it
        self.assertNotIn("50", mail.outbox[0].body)  # never the score in an e-mail
        self.ok(t.tm, "post", url)  # published again: replaced, not doubled
        self.assertEqual(MonthlyScore.objects.filter(publication__month=month.first).count(), 6)
        history = self.ok(t.engineer, "get", "/api/ranking/me/")["history"]
        self.assertEqual([(row["month"], row["final"], row["category"]) for row in history], [(month.key, 50.0, "D")])

    def test_the_team_manager_is_reminded_once_in_the_first_week_to_publish_the_last_month(self):
        from apps.communication import notify

        november = date(2026, 11, 1)
        self.assertEqual(notify.ranking_reminders(november + timedelta(days=9)), 0)  # after the first week
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(notify.ranking_reminders(november + timedelta(days=1)), 1)
        self.assertEqual(notify.ranking_reminders(november + timedelta(days=2)), 0)  # once
        reminded = Notification.objects.filter(kind=Kind.RANKING_TO_PUBLISH)
        self.assertEqual(list(reminded.values_list("member__first_name", flat=True)), ["Tm"])
        self.assertEqual(len(mail.outbox), 1)
        RankingPublication.objects.create(month=november, published_at=timezone.now())
        self.assertEqual(notify.ranking_reminders(date(2026, 12, 3)), 0)  # November is published
        out = StringIO()
        call_command("send_deadline_reminders", stdout=out)
        self.assertIn("Ranking reminders:", out.getvalue())
