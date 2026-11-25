"""A small team for the work module's tests (built on apps/projects/work_fixtures.build_team):

Electronics (Head `lead`; `engineer`, `engineer2` work there), Aerodynamics (Head `aero_lead`; `teammate`),
`admin` a superuser, `outsider` nobody's Head, `scorer` a club admin (who alone does the scoring). One current season."""

from datetime import datetime
from io import StringIO
from zoneinfo import ZoneInfo

from django.contrib.auth.models import Group
from django.core.management import call_command

from apps.members.models import Membership, Role
from apps.projects.work_fixtures import build_team, person

from ..models import Season

ALGIERS = ZoneInfo("Africa/Algiers")


def build():
    t = build_team()
    call_command("seed_task_management", stdout=StringIO())
    t.season = Season.objects.get(is_active=True)
    t.season.scoring_cutoff_at = datetime(2026, 12, 31, 23, 0, tzinfo=ALGIERS)
    t.season.save()
    t.aero_lead = person("aerolead")
    Membership.objects.create(member=t.aero_lead, org_unit=t.aero, role=Role.objects.get(code="t-lead"))
    t.engineer2 = person("engineer2")
    Membership.objects.create(member=t.engineer2, org_unit=t.electronics, role=Role.objects.get(code="t-engineer"),
                              member_level="main")
    t.scorer = person("scorer")
    # Scoring belongs to the club admins only: here through the "Admins" group.
    t.scorer.groups.add(Group.objects.get_or_create(name="Admins")[0])
    return t
