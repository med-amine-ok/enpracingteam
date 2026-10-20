# apps/members/services.py

import logging

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger("members.auth")


def sync_executive_bureau():
    """
    Ensure every member who currently holds a leadership role anywhere in the
    org also has an active "Executive Bureau Member" membership in the
    Executive Bureau org unit.  Members who no longer hold any leadership
    role have their Bureau membership ended (not deleted — history is kept).

    This is idempotent and safe to call on every Membership/Role change.
    """
    from .models import Membership, OrgUnit, Role  # late import to avoid circular

    bureau = OrgUnit.objects.filter(code="executive-bureau").first()
    bureau_role = Role.objects.filter(code="executive-bureau-member").first()

    if bureau is None or bureau_role is None:
        # Org structure not seeded yet — nothing to sync.
        return

    with transaction.atomic():
        # Members who currently hold at least one leadership role (anywhere).
        leaders = set(
            Membership.objects.filter(
                role__is_leadership=True,
                end_date__isnull=True,
            )
            .exclude(org_unit=bureau)           # don't count the bureau row itself
            .values_list("member_id", flat=True)
        )

        # Current active bureau memberships (the auto-managed ones).
        existing = {
            m.member_id: m
            for m in Membership.objects.filter(
                org_unit=bureau,
                role=bureau_role,
                end_date__isnull=True,
            )
        }

        # Add missing bureau memberships.
        for member_id in leaders - existing.keys():
            Membership.objects.create(
                member_id=member_id,
                org_unit=bureau,
                role=bureau_role,
                is_primary=False,
            )
            logger.info("Bureau membership created for member_id=%s", member_id)

        # End bureau memberships for members who no longer hold a leadership role.
        to_end = existing.keys() - leaders
        if to_end:
            Membership.objects.filter(
                org_unit=bureau,
                role=bureau_role,
                end_date__isnull=True,
                member_id__in=to_end,
            ).update(end_date=timezone.now().date())
            for mid in to_end:
                logger.info("Bureau membership ended for member_id=%s", mid)
