"""Who may do what in the work module (specification §14, guide §2.4). Single place for these rules.

- Every logged-in member sees the official work (Work Orders and Deliverables) of every department, read-only
  (plan §4.3, recommended default). A proposal is seen only by its author and the Heads who decide it.
- The "Head" of a department is whoever leads it, as elsewhere in the ERP (apps/projects/access.py): an active
  leadership role in the unit or in a unit above it. Club admins (decision D-025) act as Head everywhere.
- The members assigned to a Deliverable update its progress and Milestones, report blockers and submit it.
- The scoring workspace and the ranking data (quality marks, budgets' rubric scores, calculations, rankings) belong
  to the club admins only (decision of 25/11/2026): superusers, the "Admins" group, the Board and the Team Manager
  (D-025). Being a Head never gives them. Whoever lacks them gets 404, so that they do not appear to exist.
"""

from django.db.models import Q
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.members.access import is_club_admin
from apps.members.models import Membership, OrgUnit

from .models import Assignment

class Access:
    """Per-request answers, computed once and lazily."""

    def __init__(self, user):
        self.user = user
        self.authenticated = bool(getattr(user, "is_authenticated", False))
        self.is_admin = is_club_admin(user) if self.authenticated else False
        self._led = None
        self._assigned = None

    # --- Heads ---

    @property
    def led_unit_ids(self):
        """The units the viewer leads, and every unit below them."""
        if self._led is None:
            self._led = set()
            if self.authenticated:
                roots = Membership.objects.filter(
                    member=self.user, end_date__isnull=True, role__is_leadership=True
                ).values_list("org_unit_id", flat=True)
                for unit in OrgUnit.objects.filter(pk__in=list(roots)):
                    self._led.update(unit.descendant_ids())
        return self._led

    @property
    def is_head(self):
        return self.is_admin or bool(self.led_unit_ids)

    def heads(self, department_id):
        return self.is_admin or department_id in self.led_unit_ids

    def heads_any(self, *department_ids):
        return any(self.heads(pk) for pk in department_ids)

    def require_head(self, department_id, message=None):
        if not self.heads(department_id):
            raise PermissionDenied(message or "Only the Head of this department may do this.")

    # --- Assigned members ---

    @property
    def assigned_ids(self):
        """The Deliverables the viewer is actively assigned to."""
        if self._assigned is None:
            self._assigned = set()
            if self.authenticated:
                self._assigned = set(
                    Assignment.objects.filter(member=self.user, is_active=True).values_list("deliverable_id", flat=True)
                )
        return self._assigned

    def is_assigned(self, deliverable):
        return deliverable.pk in self.assigned_ids

    def works_on(self, deliverable):
        """Assigned to it, or Head of its department."""
        return self.is_assigned(deliverable) or self.heads(deliverable.work_order.department_id)

    def require_works_on(self, deliverable):
        if not self.works_on(deliverable):
            raise PermissionDenied("Only the members assigned to this Deliverable or its Head may do this.")

    # --- Proposals ---

    def sees_work_order(self, work_order):
        return work_order.is_official or work_order.proposed_by_id == self.user.pk or self.heads(work_order.department_id)

    def sees_deliverable(self, deliverable):
        return (
            deliverable.is_official and self.sees_work_order(deliverable.work_order)
            or deliverable.proposed_by_id == self.user.pk
            or self.heads(deliverable.work_order.department_id)
        )

    def visible_work_orders(self, queryset):
        if self.is_admin:
            return queryset
        return queryset.filter(
            Q(proposal_status__isnull=True) | Q(proposal_status="approved") | Q(proposed_by=self.user)
            | Q(department_id__in=self.led_unit_ids)
        )

    def visible_deliverables(self, queryset):
        if self.is_admin:
            return queryset
        official = (Q(proposal_status__isnull=True) | Q(proposal_status="approved")) & (
            Q(work_order__proposal_status__isnull=True) | Q(work_order__proposal_status="approved")
        )
        return queryset.filter(
            official | Q(proposed_by=self.user) | Q(work_order__department_id__in=self.led_unit_ids)
        )

    # --- Scoring (confidential): the club admins only ---

    @property
    def is_scoring_admin(self):
        return self.is_admin

    @property
    def is_scoring_config_admin(self):
        return self.is_admin

    @property
    def is_scoring_publish_admin(self):
        return self.is_admin

    def sees_budget(self, department_id):
        """Budgets, weights and allocated points: the Heads who set them and the scoring admins (guide §12.2)."""
        return self.heads(department_id) or self.is_scoring_admin

    def capabilities(self):
        """What the screens may offer, from the backend (guide §2: never from role labels)."""
        result = {
            "is_head": self.is_head,
            "headed_department_ids": sorted(self.led_unit_ids) if not self.is_admin else None,
            "is_club_admin": self.is_admin,
        }
        # Absent, not false, for whoever has no scoring access: the key itself would reveal it (guide §2.1).
        if self.is_scoring_admin:
            result["scoring"] = {
                "admin": True, "config": self.is_scoring_config_admin, "publish": self.is_scoring_publish_admin,
            }
        return result


def access_for(request):
    cached = getattr(request, "_work_access", None)
    if cached is None:
        cached = Access(request.user)
        request._work_access = cached
    return cached


def hidden():
    """The answer of every scoring endpoint to whoever may not see it: as if it did not exist."""
    return NotFound()
