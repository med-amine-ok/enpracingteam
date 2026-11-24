"""
Who may do what with the sessions (decision D-013, knowledge base: PROJECTS/ERP/meetings_design.md):

- the Executive Bureau (the Team Manager included) and the admins schedule, change and cancel them, and
  see them all, with everyone's attendance;
- their organiser (or an admin, or the bureau) runs them: invitees, attendance, minutes, decisions,
  actions;
- the people invited see them, check in and ask for an excuse;
- the Team Manager decides the excuses (the admins when there is none); nobody decides their own, not even an
  admin (the Team Manager is one since decision D-025).
"""

from django.db.models import Q

from apps.members.access import bureau_positions
from apps.members.models import Membership
from apps.projects.access import work_access_for

from .models import Attendance

# Codes of the Executive Bureau (seed_org_units) and of the Team Manager's role (seed_roles).
BUREAU_UNIT = "executive-bureau"
TEAM_MANAGER_ROLE = "team-manager"


def team_managers(prefix=""):
    """The active memberships (behind `prefix`, e.g. "memberships__") of the Team Managers."""
    return Q(**{f"{prefix}end_date__isnull": True, f"{prefix}role__code": TEAM_MANAGER_ROLE})


class MeetingAccess:
    """Per-request answers about the sessions, computed once, lazily."""

    def __init__(self, request):
        self.work = work_access_for(request)
        self.viewer = self.work.viewer
        self.is_admin = self.work.is_admin
        self._roles = None
        self._position = None

    def _memberships(self):
        """(in the Executive Bureau, Team Manager), from the active memberships."""
        if self._roles is None:
            self._roles = (False, False)
            if self.work.authenticated:
                mine = Membership.objects.filter(member=self.viewer)
                self._roles = (
                    mine.filter(end_date__isnull=True, org_unit__code=BUREAU_UNIT).exists(),
                    mine.filter(team_managers()).exists(),
                )
        return self._roles

    @property
    def is_bureau(self):
        # The Team Manager sits in the real bureau (synchronised from the admin roles); counted here by role too.
        return self._memberships()[0] or self._memberships()[1]

    @property
    def is_team_manager(self):
        return self._memberships()[1]

    @property
    def has_bureau_position(self):
        """A position given in the Executive Bureau (the Treasurer...), not the membership every leader gets there:
        with the club admins, they see the whole team's dashboard and ranking (decision D-025)."""
        if self._position is None:
            self._position = self.work.authenticated and Membership.objects.filter(
                bureau_positions(), member=self.viewer
            ).exists()
        return self._position

    def is_viewer(self, member_id):
        return self.work.is_viewer(member_id)

    # --- Sessions ---

    def can_schedule(self):
        return self.is_admin or self.is_bureau

    def sees_all(self):
        return self.can_schedule()

    def visible(self, meetings):
        if self.sees_all():
            return meetings
        # A subquery: a join on the attendances would distort the counts annotated on the sessions.
        invited = Attendance.objects.filter(member=self.viewer).values("meeting_id")
        return meetings.filter(Q(pk__in=invited) | Q(organiser=self.viewer))

    def can_run(self, meeting):
        """Invitees, attendance, minutes, decisions and actions."""
        return self.is_viewer(meeting.organiser_id) or self.can_schedule()

    def sees_everyone(self, meeting):
        return self.can_run(meeting)

    # --- Excuses ---

    def can_decide_excuses(self):
        return self.is_admin or self.is_team_manager

    def can_decide(self, attendance):
        """The Team Manager and the admins decide the excuses, never their own."""
        if self.is_viewer(attendance.member_id):
            return False
        return self.is_admin or self.is_team_manager

    # --- Actions ---

    def can_tick(self, action):
        return self.is_viewer(action.responsible_id) or self.can_run(action.meeting)

    # --- Presence ---

    def sees_presence_of(self, member_id):
        return self.is_viewer(member_id) or self.sees_all()


def meeting_access_for(request):
    """MeetingAccess cached on the request object (one per request)."""
    access = getattr(request, "_meeting_access", None)
    if access is None:
        access = MeetingAccess(request)
        request._meeting_access = access
    return access
