"""Regression tests for the review of 24/11/2026: two people for an exclusion, a third warning while an immediate
exclusion is pending, a cancelled earlier warning, the rights of an excluded leader, and who is told of a report."""

from apps.communication.models import NotificationKind as Kind
from apps.members.access import DEPARTMENT_HEADS_GROUP
from apps.projects.models import Project, ProjectCategory, ProjectMember, ProjectStatus

from .models import Exclusion, ExclusionStatus, MemberWarning
from .tests import DisciplineTestCase, notified

THEFT = {"serious_ground": "theft", "facts": "Took the club's oscilloscope"}


class ExclusionTwoPeopleTests(DisciplineTestCase):
    def test_who_proposed_an_exclusion_does_not_confirm_it_alone(self):
        t = self.t
        exclusion = self.ok(t.chair, "post", "/api/discipline/exclusions/", {"member_id": t.outsider.id, **THEFT},
                            status=201)
        url = f"/api/discipline/exclusions/{exclusion['id']}/confirm/"
        self.assertEqual(self.send(t.chair, "post", url).status_code, 403)
        self.ok(t.tm, "post", url)  # another member of the Bureau
        t.outsider.refresh_from_db()
        self.assertFalse(t.outsider.is_active)

    def test_an_admin_confirms_their_own_proposal(self):
        t = self.t
        exclusion = self.ok(t.admin, "post", "/api/discipline/exclusions/", {"member_id": t.outsider.id, **THEFT},
                            status=201)
        self.ok(t.admin, "post", f"/api/discipline/exclusions/{exclusion['id']}/confirm/")

    def test_an_excluded_leader_loses_the_department_heads_group_and_the_admin_site(self):
        t = self.t
        from django.contrib.auth.models import Group

        t.lead.groups.add(Group.objects.get_or_create(name=DEPARTMENT_HEADS_GROUP)[0])
        type(t.lead).objects.filter(pk=t.lead.pk).update(is_staff=True)
        exclusion = self.ok(t.chair, "post", "/api/discipline/exclusions/", {"member_id": t.lead.id, **THEFT},
                            status=201)
        self.ok(t.tm, "post", f"/api/discipline/exclusions/{exclusion['id']}/confirm/")
        t.lead.refresh_from_db()
        self.assertFalse(t.lead.is_staff)
        self.assertFalse(t.lead.groups.filter(name=DEPARTMENT_HEADS_GROUP).exists())


class ThirdWarningTests(DisciplineTestCase):
    def two_warnings(self, member):
        self.warn(self.t.chair, member)
        self.warn(self.t.chair, member, **self.council())

    def test_a_third_warning_is_recorded_while_an_immediate_exclusion_awaits(self):
        t = self.t
        self.two_warnings(t.teammate)
        self.ok(t.chair, "post", "/api/discipline/exclusions/", {"member_id": t.teammate.id, **THEFT}, status=201)
        third = self.warn(t.chair, t.teammate)  # was a 500 (one pending exclusion only)
        self.assertEqual(third["level"], 3)
        self.assertEqual(Exclusion.objects.filter(member=t.teammate, status=ExclusionStatus.PENDING).count(), 1)

    def test_cancelling_an_earlier_warning_abandons_the_third_warnings_exclusion(self):
        t = self.t
        self.two_warnings(t.teammate)
        self.warn(t.chair, t.teammate)
        exclusion = Exclusion.objects.get(member=t.teammate, cause="third_warning")
        first = MemberWarning.objects.filter(member=t.teammate).order_by("level").first()
        self.ok(t.chair, "post", f"/api/discipline/warnings/{first.id}/cancel/", {"reason": "Wrong person"})
        exclusion.refresh_from_db()
        self.assertEqual(exclusion.status, ExclusionStatus.ABANDONED)


class ReportRecipientsTests(DisciplineTestCase):
    def test_a_member_who_manages_their_own_project_is_not_told_of_the_report_about_them(self):
        t = self.t
        own = Project.objects.create(name="Own", category=ProjectCategory.EV, org_unit=t.fs_team,
                                     status=ProjectStatus.ACTIVE, project_manager=t.engineer)
        ProjectMember.objects.create(project=own, member=t.engineer, role="Member")
        self.ok(t.lead, "post", "/api/discipline/reports/",
                {"member_id": t.engineer.id, "ground": "commitments", "facts": "Late"}, status=201)
        self.assertNotIn("Engineer", notified(Kind.WARNING_REPORTED))
