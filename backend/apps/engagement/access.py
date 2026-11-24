"""
Who may do what with the goals, trainings, volunteering and member sheets (decision D-019):

- the full member sheet: the member, the leaders of their units, the Team Manager, the Bureau and the admins;
- goals: set and assessed by the member's heads (the leaders of their units), the Team Manager, the Bureau and the
  admins, never for oneself; the member moves their progress forward;
- trainings: the member wishes some; their heads plan them, mark them followed or drop them, or record one followed;
- volunteering: any member organises an activity with its participants; a head of the organiser (or the Team
  Manager, the Bureau, the admins) validates it, never the organiser; participants, organiser and heads see it.
"""

from apps.meetings.access import meeting_access_for
from apps.members.models import Membership


class EngagementAccess:
    def __init__(self, request):
        self.meetings = meeting_access_for(request)
        self.work = self.meetings.work
        self.viewer = self.work.viewer
        self.is_admin = self.work.is_admin
        self._led = None

    def is_viewer(self, member_id):
        return self.work.is_viewer(member_id)

    def sees_all(self):
        return self.is_admin or self.meetings.is_bureau

    def led_member_ids(self):
        """The members of the units the viewer leads (the viewer included, when in one)."""
        if self._led is None:
            led = self.work.led_unit_ids
            self._led = set(
                Membership.objects.filter(end_date__isnull=True, org_unit_id__in=led).values_list("member_id", flat=True)
            ) if led else set()
        return self._led

    def follows(self, member_id):
        """Heads them: sets their goals, plans their trainings (never one's own)."""
        return not self.is_viewer(member_id) and (self.sees_all() or member_id in self.led_member_ids())

    def leads_anyone(self):
        return self.sees_all() or bool(self.led_member_ids() - {self.viewer.pk})

    def sees_sheet(self, member):
        return self.is_viewer(member.pk) or self.follows(member.pk)

    def validates(self, activity):
        # Never one's own: neither as organiser nor as a participant (their own month would count as covered).
        if self.is_viewer(activity.organiser_id) or (
            self.viewer is not None and activity.pk is not None
            and activity.participants.filter(pk=self.viewer.pk).exists()
        ):
            return False
        return self.sees_all() or activity.organiser_id in self.led_member_ids()

    def sees_activity(self, activity):
        if self.sees_all() or self.is_viewer(activity.organiser_id) or activity.organiser_id in self.led_member_ids():
            return True
        participants = {member.pk for member in activity.participants.all()}
        return self.viewer.pk in participants or bool(participants & self.led_member_ids())


def engagement_access_for(request):
    access = getattr(request, "_engagement_access", None)
    if access is None:
        access = EngagementAccess(request)
        request._engagement_access = access
    return access
