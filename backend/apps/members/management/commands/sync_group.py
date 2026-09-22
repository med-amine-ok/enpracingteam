from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.members.models import Member, MemberRoleType, Membership

# Which Django model permissions each group gets. app_label.codename format.
GROUP_PERMISSIONS = {
    "Admins": None,  # None = every permission (see handle())
    "Department Heads": [
        "members.view_member", "members.change_member",
        "members.view_membership", "members.add_membership", "members.change_membership",
        "members.view_orgunit", "members.view_role", "members.view_alumniprofile",
    ],
    "Members": [
        "members.view_member", "members.view_membership",
        "members.view_orgunit", "members.view_role",
    ],
}

# Which role_type puts someone in which group.
ROLE_TYPE_TO_GROUP = {
    MemberRoleType.ADMIN: "Admins",
    MemberRoleType.HEAD_OF_DEPARTMENT: "Department Heads",
    MemberRoleType.MEMBER: "Members",
}


class Command(BaseCommand):
    help = "Create/update admin groups and sync member group membership (safe to re-run)."

    @transaction.atomic
    def handle(self, *args, **options):
        groups = self._sync_group_permissions()
        self._sync_member_groups(groups)

    def _sync_group_permissions(self):
        groups = {}
        for name, codenames in GROUP_PERMISSIONS.items():
            group, created = Group.objects.get_or_create(name=name)
            groups[name] = group
            if codenames is None:
                perms = Permission.objects.all()
            else:
                perms = Permission.objects.filter(
                    content_type__app_label="members",
                    codename__in=[c.split(".")[1] for c in codenames],
                )
            group.permissions.set(perms)
            self.stdout.write(f"  {'created' if created else 'ok'}: group '{name}' ({perms.count()} perms)")
        return groups

    def _sync_member_groups(self, groups):
        # Highest active role_type per member wins (admin > head > member).
        priority = [MemberRoleType.ADMIN, MemberRoleType.HEAD_OF_DEPARTMENT, MemberRoleType.MEMBER]
        active = Membership.objects.filter(end_date__isnull=True).select_related("role")

        best = {}
        for m in active:
            rt = m.role.role_type
            current = best.get(m.member_id)
            if current is None or priority.index(rt) < priority.index(current):
                best[m.member_id] = rt

        for member in Member.objects.filter(code__isnull=False):
            wanted_group = groups[ROLE_TYPE_TO_GROUP[best.get(member.id, MemberRoleType.MEMBER)]]
            current_groups = set(member.groups.filter(name__in=GROUP_PERMISSIONS).values_list("id", flat=True))
            if current_groups != {wanted_group.id}:
                member.groups.remove(*Group.objects.filter(name__in=GROUP_PERMISSIONS))
                member.groups.add(wanted_group)
                self.stdout.write(f"  {member} -> {wanted_group.name}")

        self.stdout.write(self.style.SUCCESS("Done syncing groups."))

        # Anyone in Admins or Department Heads needs is_staff to log into /admin/.
        staff_group_ids = Group.objects.filter(name__in=["Admins", "Department Heads"]).values_list("id", flat=True)
        should_be_staff = set(Member.objects.filter(groups__id__in=staff_group_ids).values_list("id", flat=True))
        Member.objects.filter(id__in=should_be_staff, is_staff=False).update(is_staff=True)
        Member.objects.filter(code__isnull=False, is_staff=True).exclude(id__in=should_be_staff).update(is_staff=False)