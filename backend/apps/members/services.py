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
            ).update(end_date=timezone.localdate())
            for mid in to_end:
                logger.info("Bureau membership ended for member_id=%s", mid)


def sync_admins_group(membership):
    """
    The Admins group (every right in the admin site) follows who governs (decision D-025): a member joins it
    when they join the Board of Directors or become Team Manager, and leaves it when the membership that gave
    them those rights ends or is deleted (for the Department Heads group when they still lead somewhere).
    Superusers and members put in the group by hand for another reason are left as they are.
    """
    from django.contrib.auth.models import Group

    from .access import ADMINS_GROUP, BOARD_UNIT, DEPARTMENT_HEADS_GROUP, TEAM_MANAGER_ROLE, governing
    from .models import Member, Membership

    member = Member.objects.filter(pk=membership.member_id).first()
    if member is None or member.is_superuser:
        return
    in_admins = member.groups.filter(name=ADMINS_GROUP).exists()
    if Membership.objects.filter(governing(), member=member).exists():
        if not in_admins:
            member.groups.add(Group.objects.get_or_create(name=ADMINS_GROUP)[0])
            Member.objects.filter(pk=member.pk).update(is_staff=True)
            logger.info("Admins group joined by member_id=%s", member.pk)
        return
    # The row as it is now, or as it was before this save (a Team Manager's role changed to another one, a
    # Board membership moved to a department: signals.remember_rights sets _gave_rights_before).
    gave_rights = (
        membership.org_unit.code == BOARD_UNIT
        or membership.role.code == TEAM_MANAGER_ROLE
        or getattr(membership, "_gave_rights_before", False)
    )
    if not (in_admins and gave_rights):
        return
    member.groups.remove(*Group.objects.filter(name=ADMINS_GROUP))
    leads = Membership.objects.filter(member=member, end_date__isnull=True, role__is_leadership=True).exists()
    if leads:
        member.groups.add(Group.objects.get_or_create(name=DEPARTMENT_HEADS_GROUP)[0])
    Member.objects.filter(pk=member.pk).update(is_staff=leads)
    logger.info("Admins group left by member_id=%s", member.pk)


def revoke_rights(member):
    """An excluded member (all memberships ended): out of the Admins and Department Heads groups and of the admin
    site. Superusers are left as they are."""
    from django.contrib.auth.models import Group

    from .access import ADMINS_GROUP, DEPARTMENT_HEADS_GROUP
    from .models import Member

    if member.is_superuser:
        return
    member.groups.remove(*Group.objects.filter(name__in=[ADMINS_GROUP, DEPARTMENT_HEADS_GROUP]))
    Member.objects.filter(pk=member.pk).update(is_staff=False)
