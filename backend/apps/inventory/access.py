# apps/inventory/access.py
"""
Who may do what with the stock (knowledge base: PROJECTS/ERP/stock_design.md, decided with the user
on 19/10/2026). Single place for these rules, used by the API.

Every logged-in member sees the stock: its lines, their places, their history.
The stock managers manage it: Operations (the head of Operations & Partnerships and the logistics
coordinators), the Manufacturing & Workshop Lead and the club admins. They create the lines, change
the places and thresholds, record the manual entries, the exits — like a storekeeper: members ask
for a part, a manager records it — and the counts. The entries of the purchases are recorded when
an order is received (apps/purchasing/workflow.py).
"""

from django.db.models import Q

from apps.members.access import is_club_admin
from apps.members.models import Membership
from apps.purchasing.access import operations_staff

# Role code of the Manufacturing & Workshop Lead (seed_roles: a code never changes).
WORKSHOP_ROLE = "manufacturing-workshop-lead"


def stock_managers(prefix=""):
    """The active memberships (behind `prefix`, e.g. "memberships__") that make a stock manager."""
    return operations_staff(prefix) | Q(**{f"{prefix}end_date__isnull": True, f"{prefix}role__code": WORKSHOP_ROLE})


class StockAccess:
    """Per-request answers to "may this viewer…?" about the stock, computed once."""

    def __init__(self, request):
        self.viewer = getattr(request, "user", None)
        self.authenticated = bool(getattr(self.viewer, "is_authenticated", False))
        self.is_admin = is_club_admin(self.viewer)
        self._manager = None

    @property
    def is_manager(self):
        if self._manager is None:
            self._manager = self.authenticated and Membership.objects.filter(stock_managers(), member=self.viewer).exists()
        return self._manager

    def can_manage(self):
        """Create lines, change places and thresholds, record entries, exits and counts."""
        return self.is_admin or self.is_manager


def stock_access_for(request):
    """StockAccess cached on the request object (one per request)."""
    access = getattr(request, "_stock_access", None)
    if access is None:
        access = StockAccess(request)
        request._stock_access = access
    return access
