"""
Who sees the Team Manager's dashboard and the reports (decisions D-014, D-025): the club admins (the Board of
Directors and the Team Manager among them) and the positions given in the Executive Bureau (the Treasurer...) see
the whole team and its reports; a leader sees the departments they lead (the membership every leader gets in the
Bureau does not count).
"""

from apps.meetings.access import meeting_access_for
from apps.members.models import OrgUnit

from .health import DEPARTMENT_TYPES


class ReportingAccess:
    def __init__(self, request):
        self.meetings = meeting_access_for(request)
        self.work = self.meetings.work
        self._departments = None

    def sees_team(self):
        """The club admins (the Board of Directors, the Team Manager) and the Bureau's positions (decision D-025)."""
        return self.work.is_admin or self.meetings.has_bureau_position

    def led_departments(self):
        """The departments the viewer leads (directly, or below a unit they lead)."""
        if self._departments is None:
            led = self.work.led_unit_ids
            self._departments = list(OrgUnit.objects.filter(pk__in=led, type__in=DEPARTMENT_TYPES).order_by("name"))
        return self._departments

    def scope(self):
        """None: the whole team; else the ids of the units of the viewer's departments (empty: no access)."""
        if self.sees_team():
            return None
        ids = set()
        for unit in self.led_departments():
            ids.update(unit.descendant_ids())
        return ids

    def sees_dashboard(self):
        return self.sees_team() or bool(self.led_departments())


def reporting_access_for(request):
    access = getattr(request, "_reporting_access", None)
    if access is None:
        access = ReportingAccess(request)
        request._reporting_access = access
    return access
