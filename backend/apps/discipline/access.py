"""
Who may do what with the warnings (decision D-018, charter art. 27-28):

- the authority gives warnings: the manager of a project to its members, the Executive Bureau (the Team Manager
  included) and the admins to anyone; never to oneself;
- the leaders of the member's units, the managers of the member's projects, the Bureau and the admins report a
  breach (art. 27.3) and see the member's warnings and reports; the member sees their warnings, never the reports;
- the Bureau and the admins cancel a warning, propose an immediate exclusion (art. 28) and confirm or abandon an
  exclusion; the council's decision is recorded by them or by who gave the warning.
"""

from django.db.models import Q

from apps.meetings.access import meeting_access_for
from apps.members.models import Membership
from apps.projects.models import ProjectMember, ProjectStatus

OPEN_PROJECTS = (ProjectStatus.PLANNED, ProjectStatus.ACTIVE)


class DisciplineAccess:
    def __init__(self, request):
        self.meetings = meeting_access_for(request)
        self.work = self.meetings.work
        self.viewer = self.work.viewer
        self.is_admin = self.work.is_admin
        self._led = None
        self._managed = None

    def is_viewer(self, member_id):
        return self.work.is_viewer(member_id)

    def sees_all(self):
        return self.is_admin or self.meetings.is_bureau

    def led_member_ids(self):
        """The members of the units the viewer leads."""
        if self._led is None:
            led = self.work.led_unit_ids
            self._led = set(
                Membership.objects.filter(end_date__isnull=True, org_unit_id__in=led).values_list("member_id", flat=True)
            ) if led else set()
        return self._led

    def managed_member_ids(self):
        """The members of the open projects the viewer manages."""
        if self._managed is None:
            self._managed = set(
                ProjectMember.objects.filter(
                    project__project_manager=self.viewer, project__status__in=OPEN_PROJECTS, is_active=True
                ).values_list("member_id", flat=True)
            ) if self.work.authenticated else set()
        return self._managed

    def can_report(self, member):
        return not self.is_viewer(member.pk) and (
            self.sees_all() or member.pk in self.led_member_ids() or member.pk in self.managed_member_ids()
        )

    def can_issue(self, member):
        return not self.is_viewer(member.pk) and (self.sees_all() or member.pk in self.managed_member_ids())

    def follows(self, member_id):
        """Sees the member's warnings and reports (not the member themself)."""
        return self.sees_all() or member_id in self.led_member_ids() or member_id in self.managed_member_ids()

    def handles(self, report):
        """Gives a warning from the report, or dismisses it: the authority over the member."""
        return self.can_issue(report.member)

    def warnings_seen(self, warnings):
        if self.sees_all():
            return warnings
        followed = (self.led_member_ids() | self.managed_member_ids()) - {self.viewer.pk}
        return warnings.filter(Q(member=self.viewer) | Q(member_id__in=followed) | Q(issued_by=self.viewer))

    def reports_seen(self, reports):
        if self.sees_all():
            return reports
        followed = (self.led_member_ids() | self.managed_member_ids()) - {self.viewer.pk}
        return reports.filter(Q(reported_by=self.viewer) | Q(member_id__in=followed)).exclude(member=self.viewer)

    def can_record_council(self, warning):
        return self.sees_all() or self.is_viewer(warning.issued_by_id)


def discipline_access_for(request):
    access = getattr(request, "_discipline_access", None)
    if access is None:
        access = DisciplineAccess(request)
        request._discipline_access = access
    return access
