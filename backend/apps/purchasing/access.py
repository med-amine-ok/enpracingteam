# apps/purchasing/access.py
"""
Who may do what with purchases (knowledge base: PROJECTS/ERP/purchasing_design.md, decided with the
user on 19/10/2026). Single place for these rules, used by the API.

Every logged-in member sees the purchase requests, their orders and the suppliers: the club's
purchases are shared, and everyone can follow "where is my part?". Protected: the suppliers' contact
people and street address (Operations, club admins and unit leaders), and the shipping addresses
(Operations and club admins).

- "Operations" = the head of the Operations & Partnerships department (a leadership role there) and
  its logistics coordinators; not its other, junior, members. They order, receive, and keep the
  suppliers up to date.
- A request is made for a unit, and maybe one of its subsystems, by someone involved there: for a
  subsystem, a member involved in its project (as for creating a task) or a leader of its unit; for a
  unit, one of its members (of the unit or of a unit below it) or a leader. Operations and club
  admins may ask for any unit.
- Two approvals before ordering:
  1. the leader: a leader of the request's unit (or of a unit above it), the project manager of its
     subsystem's project, or a club admin;
  2. the head of Operations (an active leadership role in that department) or a club admin.
  A person who may approve the next step approves it at once (a leader's own request skips step 1).
- A request is changed only while it awaits its leader (by its author and the people who approve
  it); after that it is cancelled and asked again, so that the approvals stay true.
- Cancelling: its author until the part is ordered; Operations and admins until it is delivered.
  Refusing: whoever may approve the current step.
- Once some parts of an order have arrived (they are in stock), neither the request nor its order can
  be cancelled any more: Operations receive the rest, or close the order with what arrived (D-023).
"""

from django.db.models import Q

from apps.members.models import Membership, OrgUnit
from apps.projects.access import work_access_for

from .models import PurchaseStatus

# Code of the Operations & Partnerships department (seed_org_units: a code never changes).
OPERATIONS_UNIT = "dept-operations"
# Role code of its logistics coordinators (seed_roles: a code never changes).
LOGISTICS_ROLE = "logistics-coordinator"

STATUS = PurchaseStatus
AWAITING_APPROVAL = (STATUS.A_VALIDER_CHEF, STATUS.A_VALIDER_OPERATIONS)
BEFORE_ORDER = (*AWAITING_APPROVAL, STATUS.A_COMMANDER)
OPEN = (*BEFORE_ORDER, STATUS.EN_COMMANDE)


def operations_staff(prefix=""):
    """The active memberships (behind `prefix`, e.g. "memberships__") of Operations' staff: the leaders
    of the Operations & Partnerships department and its logistics coordinators."""
    in_department = Q(**{f"{prefix}end_date__isnull": True, f"{prefix}org_unit__code": OPERATIONS_UNIT})
    return in_department & (Q(**{f"{prefix}role__is_leadership": True}) | Q(**{f"{prefix}role__code": LOGISTICS_ROLE}))


class PurchasingAccess:
    """Per-request answers to "may this viewer…?" about purchases. Built on the work rules
    (apps/projects/access.py: admins, led units, projects) and computed once, lazily."""

    def __init__(self, request):
        self.work = work_access_for(request)
        self.viewer = self.work.viewer
        self.is_admin = self.work.is_admin
        self._operations = None
        self._member_unit_ids = None

    # --- Who the viewer is ---

    def _operations_roles(self):
        """(is Operations' staff, heads Operations), from the viewer's active memberships there."""
        if self._operations is None:
            roles = []
            if self.work.authenticated:
                roles = list(
                    Membership.objects.filter(operations_staff(), member=self.viewer).values_list(
                        "role__is_leadership", flat=True
                    )
                )
            self._operations = (bool(roles), any(roles))
        return self._operations

    @property
    def is_operations(self):
        return self._operations_roles()[0]

    @property
    def is_operations_head(self):
        return self._operations_roles()[1]

    @property
    def member_unit_ids(self):
        """Units the viewer belongs to now, and every unit above them (an Electronics member also
        works for the Formula Student team)."""
        if self._member_unit_ids is None:
            self._member_unit_ids = set()
            if self.work.authenticated:
                parents = dict(OrgUnit.objects.values_list("pk", "parent_id"))
                for unit_id in Membership.objects.filter(member=self.viewer, end_date__isnull=True).values_list(
                    "org_unit_id", flat=True
                ):
                    while unit_id is not None and unit_id not in self._member_unit_ids:
                        self._member_unit_ids.add(unit_id)
                        unit_id = parents.get(unit_id)
        return self._member_unit_ids

    def is_author(self, purchase):
        return self.work.is_viewer(purchase.requested_by_id)

    # --- Seeing ---

    def can_manage(self):
        """Order, receive, keep the suppliers and the shipping addresses up to date."""
        return self.is_admin or self.is_operations

    def can_see_supplier_contacts(self):
        return self.can_manage() or bool(self.work.led_unit_ids)

    def can_see_shipping_addresses(self):
        return self.can_manage()

    # --- Asking ---

    def can_request_for(self, unit, subsystem=None):
        if self.can_manage():
            return True
        if subsystem is not None:
            return self.work.is_involved(subsystem.project) or self.work.leads(subsystem.org_unit_id)
        return unit.pk in self.member_unit_ids or self.work.leads(unit.pk)

    # --- Approving (the rights; the view checks the step first) ---

    def approves_as_leader(self, purchase):
        if self.is_admin or (purchase.org_unit_id is not None and self.work.leads(purchase.org_unit_id)):
            return True
        return purchase.subsystem_id is not None and self.work.manages(purchase.subsystem.project)

    def approves_as_operations(self, purchase):
        return self.is_admin or self.is_operations_head

    def can_approve(self, purchase):
        """Approve or refuse the step the request awaits."""
        if purchase.status == STATUS.A_VALIDER_CHEF:
            return self.approves_as_leader(purchase)
        if purchase.status == STATUS.A_VALIDER_OPERATIONS:
            return self.approves_as_operations(purchase)
        return False

    def approvable(self, purchases):
        """`purchases` (a queryset) narrowed to the ones awaiting this viewer's approval."""
        if self.is_admin:
            return purchases.filter(status__in=AWAITING_APPROVAL)
        awaited = Q(status=STATUS.A_VALIDER_CHEF) & (
            Q(org_unit_id__in=self.work.led_unit_ids) | Q(subsystem__project__project_manager=self.viewer)
        )
        if self.is_operations_head:
            awaited |= Q(status=STATUS.A_VALIDER_OPERATIONS)
        return purchases.filter(awaited)

    # --- Changing, cancelling ---

    def can_edit(self, purchase):
        return purchase.status == STATUS.A_VALIDER_CHEF and (self.is_author(purchase) or self.approves_as_leader(purchase))

    def can_cancel(self, purchase):
        if purchase.status in BEFORE_ORDER and self.is_author(purchase):
            return True
        return purchase.status in OPEN and self.can_manage() and not parts_arrived(purchase)

    # --- Ordering, receiving ---

    def can_order(self, purchase):
        return purchase.status == STATUS.A_COMMANDER and self.can_manage()

    def can_manage_order(self, purchase):
        """Change the order, receive parts, cancel the order (the request goes back to "to order") or close
        it with what arrived."""
        return purchase.status == STATUS.EN_COMMANDE and self.can_manage()

    def can_cancel_order(self, purchase):
        """Only while none of its parts has arrived."""
        return self.can_manage_order(purchase) and not parts_arrived(purchase)

    def can_close_order(self, purchase):
        """Deliver it with the parts that arrived, once some did (the rest will not come)."""
        return self.can_manage_order(purchase) and parts_arrived(purchase)


def parts_arrived(purchase):
    """Some parts of the request's order in progress are already in stock (its orders may be prefetched)."""
    return any(order.status == STATUS.EN_COMMANDE and order.quantity_received > 0 for order in purchase.orders.all())


def purchasing_access_for(request):
    """PurchasingAccess cached on the request object (one per request)."""
    access = getattr(request, "_purchasing_access", None)
    if access is None:
        access = PurchasingAccess(request)
        request._purchasing_access = access
    return access
