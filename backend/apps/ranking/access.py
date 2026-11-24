"""
Who sees and does what in the monthly ranking (decision D-017, knowledge base: PROJECTS/ERP/ranking_design.md):

- every member sees their own score, its details and their published history;
- a leader (department head) sees and assesses the members of the units they lead, never themself;
- the club admins, the Board of Directors and the Team Manager among them (decision D-025), see and assess
  everyone (the Team Manager corrects the marks) and publish a month; so do, but for publishing, the positions given
  in the Executive Bureau (the Treasurer...), not the membership there that every leader gets;
- contribution points: anyone proposes some, for themself or for a member who helped them; those who assess the
  member decide them; a point entered by one of them is validated at once.
"""

from apps.meetings.access import meeting_access_for
from apps.members.models import Membership


class RankingAccess:
    def __init__(self, request):
        self.meetings = meeting_access_for(request)
        self.work = self.meetings.work
        self.viewer = self.work.viewer
        self.is_admin = self.work.is_admin
        self._team = None

    def is_viewer(self, member_id):
        return self.work.is_viewer(member_id)

    def sees_team(self):
        return self.is_admin or self.meetings.has_bureau_position

    def can_publish(self):
        return self.is_admin or self.meetings.is_team_manager

    def led_member_ids(self):
        """The members of the units the viewer leads (with the viewer, when they are in one)."""
        if self._team is None:
            led = self.work.led_unit_ids
            self._team = set(
                Membership.objects.filter(end_date__isnull=True, org_unit_id__in=led).values_list("member_id", flat=True)
            ) if led else set()
        return self._team

    def sees_a_team(self):
        return self.sees_team() or bool(self.led_member_ids())

    def scope(self):
        """None: everyone; else the ids of the members whose scores the viewer sees in the month's table."""
        return None if self.sees_team() else self.led_member_ids()

    def can_assess(self, member):
        return not self.is_viewer(member.pk) and (self.sees_team() or member.pk in self.led_member_ids())

    def can_see(self, member):
        return self.is_viewer(member.pk) or self.sees_team() or member.pk in self.led_member_ids()

    def sees_contribution(self, point):
        return (
            self.is_viewer(point.member_id) or self.is_viewer(point.proposed_by_id)
            or self.can_assess(point.member)
        )


def ranking_access_for(request):
    access = getattr(request, "_ranking_access", None)
    if access is None:
        access = RankingAccess(request)
        request._ranking_access = access
    return access
