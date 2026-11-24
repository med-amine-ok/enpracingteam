"""
Who may do what in the workshop (decision D-016, knowledge base: PROJECTS/ERP/workshop_design.md):

- every member sees the equipment, its coming reservations, its certified members and its maintenance (the
  cost to the managers only); reserves a free slot; asks to borrow what may leave the workshop;
- on a machine marked "certification required", only the certified members reserve or borrow it;
- the managers, as for the stock (Operations, the Manufacturing & Workshop Lead, the admins): add and change the
  equipment, its status, record the maintenance, hand the loans out or refuse them, receive them back, cancel
  any reservation;
- the Manufacturing & Workshop Lead and the admins certify the members, and revoke a certification;
- a member sees their own loans, the managers all of them.
"""

from django.db.models import Q

from apps.inventory.access import WORKSHOP_ROLE, stock_managers
from apps.members.access import is_club_admin
from apps.members.models import Member, Membership


def equipment_managers(prefix=""):
    """The active memberships (behind `prefix`) that make an equipment manager: those of the stock managers."""
    return stock_managers(prefix)


def workshop_leads(prefix=""):
    return Q(**{f"{prefix}end_date__isnull": True, f"{prefix}role__code": WORKSHOP_ROLE})


def managers():
    """The active equipment managers, for the notifications."""
    return list(Member.objects.filter(equipment_managers("memberships__"), is_active=True).distinct())


class EquipmentAccess:
    """Per-request answers to "may this viewer…?" about the workshop, computed once."""

    def __init__(self, request):
        self.viewer = getattr(request, "user", None)
        self.authenticated = bool(getattr(self.viewer, "is_authenticated", False))
        self.is_admin = is_club_admin(self.viewer)
        self._roles = None
        self._certified = None

    def _memberships(self):
        if self._roles is None:
            if not self.authenticated:
                self._roles = (False, False)
            else:
                mine = Membership.objects.filter(member=self.viewer)
                self._roles = (mine.filter(equipment_managers()).exists(), mine.filter(workshop_leads()).exists())
        return self._roles

    def is_viewer(self, member_id):
        return self.authenticated and member_id == self.viewer.pk

    def can_manage(self):
        return self.is_admin or self._memberships()[0]

    def can_certify(self):
        return self.is_admin or self._memberships()[1]

    @property
    def certified_ids(self):
        """The equipment the viewer is certified on."""
        if self._certified is None:
            self._certified = set(
                self.viewer.equipment_certifications.filter(revoked_at__isnull=True).values_list(
                    "equipment_id", flat=True
                )
            ) if self.authenticated else set()
        return self._certified

    def is_certified(self, equipment):
        return equipment.id in self.certified_ids

    def may_use(self, equipment):
        """Certified when the equipment needs it."""
        return not equipment.requires_certification or self.is_certified(equipment)

    def can_cancel_reservation(self, reservation):
        return self.is_viewer(reservation.reserved_by_id) or self.can_manage()

    def sees_loan(self, loan):
        return self.can_manage() or self.is_viewer(loan.borrower_id)


def equipment_access_for(request):
    access = getattr(request, "_equipment_access", None)
    if access is None:
        access = EquipmentAccess(request)
        request._equipment_access = access
    return access
