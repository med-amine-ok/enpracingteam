# apps/members/access.py
"""
Who may see or manage which members. Single place for these rules, used by the API
serializers and the Django admin, so they can be changed in one spot.

- Club admins see and manage everyone: the superusers, the "Admins" group, and (decision D-025) whoever governs,
  that is every active member of the Board of Directors and the Team Manager. The Executive Bureau, which every
  leader joins (services.sync_executive_bureau), does not: the Admins group follows the governing roles.
- A department head sees and manages the members of the units they currently head.
- Personal contact details (phone, Facebook) are visible to the member themselves,
  club admins, and the heads of a unit the member currently belongs to.
- Adding a member from the web app (decision D-024): club admins, to any active unit with any role;
  a department head, to the units they head and those below them, with a role that is not a
  leadership one (a head never makes another head). Only the club admins give a position in the club (the Board's
  or the Executive Bureau's roles) and put the new member in projects anywhere; a head, in the projects of the
  units they may add to (decision D-025).
"""

from django.db.models import Q

from .models import MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope

ADMINS_GROUP = "Admins"
DEPARTMENT_HEADS_GROUP = "Department Heads"
CONTACT_FIELDS = ("phone", "facebook_url")

# Codes of the governing units and of the Team Manager's role (seed_org_units, seed_roles).
BOARD_UNIT = "board"
BUREAU_UNIT = "executive-bureau"
TEAM_MANAGER_ROLE = "team-manager"
# The positions in the club, by unit (decision D-025): the roles a member holds in the Board or the Bureau. Not
# "Executive Bureau Member": every leader holds it, kept up to date by services.sync_executive_bureau.
POSITIONS = {
    BOARD_UNIT: ("president", "vice-president", "board-member"),
    BUREAU_UNIT: ("treasurer",),
}


def governing(prefix=""):
    """The active memberships (behind `prefix`, e.g. "memberships__") that give the club admin's rights: in the
    Board of Directors, or as Team Manager (decision D-025)."""
    return Q(**{f"{prefix}end_date__isnull": True}) & (
        Q(**{f"{prefix}org_unit__code": BOARD_UNIT}) | Q(**{f"{prefix}role__code": TEAM_MANAGER_ROLE})
    )


# The membership every leader gets in the Executive Bureau (services.sync_executive_bureau): not a position.
BUREAU_MEMBER_ROLE = "executive-bureau-member"


def bureau_positions(prefix=""):
    """The active memberships (behind `prefix`) of a position given in the Executive Bureau, such as the Treasurer:
    not the membership every leader gets there (decision D-025). They see the whole team's dashboard and ranking."""
    return Q(**{f"{prefix}end_date__isnull": True, f"{prefix}org_unit__code": BUREAU_UNIT}) & ~Q(
        **{f"{prefix}role__code": BUREAU_MEMBER_ROLE}
    )


def club_admins_filter():
    """The members who are club admins, as a filter on Member (with .distinct())."""
    return Q(is_superuser=True) | Q(groups__name=ADMINS_GROUP) | governing("memberships__")


def is_club_admin(user):
    if not getattr(user, "is_authenticated", False):
        return False
    if user.is_superuser or user.groups.filter(name=ADMINS_GROUP).exists():
        return True
    return Membership.objects.filter(governing(), member=user).exists()


def headed_unit_ids(user):
    """Ids of the org units this user currently heads (active head-of-department memberships)."""
    if not getattr(user, "is_authenticated", False):
        return set()
    return set(
        Membership.objects.filter(
            member=user, end_date__isnull=True, role__role_type=MemberRoleType.HEAD_OF_DEPARTMENT
        ).values_list("org_unit_id", flat=True)
    )


class ContactAccess:
    """Per-request answer to "may this viewer see that member's contact details?".

    Computes the viewer's admin status and headed units once, then answers for each member
    from their (ideally prefetched) memberships, so a list of N members costs no extra queries.
    """

    def __init__(self, viewer):
        self.viewer = viewer
        self.is_admin = is_club_admin(viewer)
        self.headed_units = headed_unit_ids(viewer) if not self.is_admin else set()

    def can_view(self, member):
        if not getattr(self.viewer, "is_authenticated", False):
            return False
        if self.is_admin or self.viewer.pk == member.pk:
            return True
        if not self.headed_units:
            return False
        return any(
            m.end_date is None and m.org_unit_id in self.headed_units
            for m in member.memberships.all()
        )


def scope_of(unit):
    """The roles a unit takes: those of the Formula Student team for its units, the club's otherwise."""
    return RoleScope.FS_TEAM if unit.type in (OrgUnitType.FS_TEAM, OrgUnitType.FS_DEPARTMENT) else RoleScope.CLUB


class MemberAdding:
    """Where this viewer may add members from the web app, and with which roles (decision D-024)."""

    def __init__(self, viewer):
        self.is_admin = is_club_admin(viewer)
        active = OrgUnit.objects.filter(is_active=True)
        if self.is_admin:
            self.unit_ids = set(active.values_list("pk", flat=True))
        else:
            below = set()
            for unit in OrgUnit.objects.filter(pk__in=headed_unit_ids(viewer)):
                below.update(unit.descendant_ids())
            self.unit_ids = set(active.filter(pk__in=below).values_list("pk", flat=True))

    @property
    def can_add(self):
        return bool(self.unit_ids)

    def roles(self):
        roles = Role.objects.order_by("scope", "-is_leadership", "name")
        return roles if self.is_admin else roles.filter(is_leadership=False)

    def positions(self):
        """The positions in the club the viewer may give, as (unit, role): the club admins only (decision D-025)."""
        if not self.is_admin:
            return []
        units = {unit.code: unit for unit in OrgUnit.objects.filter(code__in=POSITIONS, is_active=True)}
        codes = [code for unit_codes in POSITIONS.values() for code in unit_codes]
        roles = {role.code: role for role in Role.objects.filter(code__in=codes)}
        return [
            (units[unit], roles[code])
            for unit, unit_codes in POSITIONS.items() if unit in units
            for code in unit_codes if code in roles
        ]

    def projects(self):
        """The projects under way or planned the viewer may put the member in: any for a club admin; for a head,
        those of the units they may add to and of the units above them (an FS department's lead, the FS team's)."""
        from apps.projects.models import Project, ProjectStatus  # the projects app builds on this one

        projects = Project.objects.filter(status__in=(ProjectStatus.PLANNED, ProjectStatus.ACTIVE)).order_by("name")
        if self.is_admin:
            return projects
        units = set(self.unit_ids)
        for unit in OrgUnit.objects.filter(pk__in=self.unit_ids).select_related("parent"):
            while unit.parent_id is not None:
                unit = unit.parent
                units.add(unit.pk)
        return projects.filter(org_unit_id__in=units)


def contact_access_for(request):
    """ContactAccess cached on the request object (one per request)."""
    access = getattr(request, "_contact_access", None)
    if access is None:
        access = ContactAccess(getattr(request, "user", None))
        request._contact_access = access
    return access
