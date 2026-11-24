# apps/finance/access.py
"""
Who may do what with the club's money (knowledge base: PROJECTS/ERP/finance_design.md §10, decided
with the user on 20/10/2026, decision D-011). Single place for these rules, used by the API.

- The finance managers are the Treasurer (a role of the Executive Bureau, given by an admin) and the
  club admins. They set the budgets, enter the expenses that are not purchases, impute the expenses
  that wait for a budget, and note the suppliers' invoices.
- The budgets and their expenses are seen:
  - all of them, by the Executive Bureau, Operations (the head of Operations & Partnerships and its
    logistics coordinators), the Treasurer and the admins;
  - by a leader, those of the units they lead; by a project manager, those of their projects' units;
    and, for both, of every unit below;
  - by nobody else.
  The expenses that wait for a budget are seen by those who see all the budgets.
- The sponsors are followed by Operations and the admins, who alone see their contacts; the Executive
  Bureau and the Treasurer see them and their totals.
"""

from django.db.models import Q

from apps.members.models import Membership, OrgUnit
from apps.projects.access import work_access_for
from apps.projects.models import Project
from apps.purchasing.access import operations_staff

# Codes of the Executive Bureau (seed_org_units) and of the Treasurer's role (seed_roles): a code never changes.
BUREAU_UNIT = "executive-bureau"
TREASURER_ROLE = "treasurer"


def treasurers(prefix=""):
    """The active memberships (behind `prefix`, e.g. "memberships__") of the treasurers."""
    return Q(**{f"{prefix}end_date__isnull": True, f"{prefix}role__code": TREASURER_ROLE})


class FinanceAccess:
    """Per-request answers to "may this viewer…?" about the budgets, the expenses and the sponsors.
    Built on the work rules (apps/projects/access.py: admins, led units) and computed once, lazily."""

    def __init__(self, request):
        self.work = work_access_for(request)
        self.viewer = self.work.viewer
        self.is_admin = self.work.is_admin
        self._roles = None
        self._unit_ids = None

    # --- Who the viewer is ---

    def _memberships(self):
        """(treasurer, member of the Executive Bureau, Operations' staff), from the active memberships."""
        if self._roles is None:
            self._roles = (False, False, False)
            if self.work.authenticated:
                mine = Membership.objects.filter(member=self.viewer)
                self._roles = (
                    mine.filter(treasurers()).exists(),
                    mine.filter(end_date__isnull=True, org_unit__code=BUREAU_UNIT).exists(),
                    mine.filter(operations_staff()).exists(),
                )
        return self._roles

    @property
    def is_treasurer(self):
        return self._memberships()[0]

    @property
    def is_bureau(self):
        return self._memberships()[1]

    @property
    def is_operations(self):
        return self._memberships()[2]

    @property
    def unit_ids(self):
        """The units whose budgets a leader sees: the units they lead, those of the projects they manage,
        and every unit below them."""
        if self._unit_ids is None:
            self._unit_ids = set(self.work.led_unit_ids)
            if self.work.authenticated:
                managed = Project.objects.filter(project_manager=self.viewer).values("org_unit_id")
                for unit in OrgUnit.objects.filter(pk__in=managed):
                    self._unit_ids.update(unit.descendant_ids())
        return self._unit_ids

    # --- Budgets and expenses ---

    def can_manage(self):
        """Set the budgets, enter and change the expenses, impute them, note the invoices."""
        return self.is_admin or self.is_treasurer

    def can_see_all(self):
        return self.can_manage() or self.is_bureau or self.is_operations

    def can_see_budgets(self):
        return self.can_see_all() or bool(self.unit_ids)

    def visible_budgets(self, budgets, prefix=""):
        """`budgets` (or the objects whose budget is behind `prefix`, e.g. "budget__") the viewer sees."""
        if self.can_see_all():
            return budgets
        return budgets.filter(**{f"{prefix}org_unit_id__in": self.unit_ids})

    # --- Sponsors ---

    def can_manage_sponsors(self):
        """Add, follow and remove the sponsors, and see their contacts."""
        return self.is_admin or self.is_operations

    def can_see_sponsors(self):
        return self.can_manage_sponsors() or self.is_bureau or self.is_treasurer


def finance_access_for(request):
    """FinanceAccess cached on the request object (one per request)."""
    access = getattr(request, "_finance_access", None)
    if access is None:
        access = FinanceAccess(request)
        request._finance_access = access
    return access
