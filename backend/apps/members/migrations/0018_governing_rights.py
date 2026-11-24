"""
Decision D-025: the club admins are the Board of Directors and the Team Manager (with the superusers), no longer the
whole Executive Bureau. Adds the Board's positions (President, Vice-President) and the MATE ROV team, as the seeds
do, then makes the Admins group follow the governing roles: the members of the Bureau who do not govern leave it
(for the Department Heads group when they lead somewhere), those who govern join it. Superusers are left as they are.
"""

from django.db import migrations
from django.db.models import Q

POSITIONS = (("president", "President"), ("vice-president", "Vice-President"))


def forwards(apps, schema_editor):
    Role = apps.get_model("members", "Role")
    OrgUnit = apps.get_model("members", "OrgUnit")
    Membership = apps.get_model("members", "Membership")
    Member = apps.get_model("members", "Member")
    Group = apps.get_model("auth", "Group")

    # Only in a database with the club's structure (seed_org_units): a new one gets them from the seeds.
    if OrgUnit.objects.filter(code="board").exists():
        for code, name in POSITIONS:
            if not Role.objects.filter(code=code).exists() and not Role.objects.filter(name=name, scope="club").exists():
                Role.objects.create(code=code, name=name, role_type="admin", scope="club", is_leadership=True)
    project_department = OrgUnit.objects.filter(code="dept-projet").first()
    if project_department is not None and not OrgUnit.objects.filter(code="mate-rov").exists():
        OrgUnit.objects.create(code="mate-rov", name="MATE ROV", type="club_pole", parent=project_department)

    admins = Group.objects.filter(name="Admins").first()
    if admins is None:
        return
    active = Membership.objects.filter(end_date__isnull=True)
    governors = set(
        active.filter(Q(org_unit__code="board") | Q(role__code="team-manager")).values_list("member_id", flat=True)
    )
    leaders = set(active.filter(role__is_leadership=True).values_list("member_id", flat=True))
    for member in Member.objects.filter(groups=admins, is_superuser=False):
        if member.pk in governors:
            continue
        member.groups.remove(admins)
        if member.pk in leaders:
            member.groups.add(Group.objects.get_or_create(name="Department Heads")[0])
        Member.objects.filter(pk=member.pk).update(is_staff=member.pk in leaders)
    for member in Member.objects.filter(pk__in=governors, is_superuser=False).exclude(groups=admins):
        member.groups.add(admins)
        Member.objects.filter(pk=member.pk).update(is_staff=True)


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("members", "0017_email_topics"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
