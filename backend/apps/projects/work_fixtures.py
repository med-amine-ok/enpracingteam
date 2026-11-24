"""A small fictitious team for the tests of the work API (projects, subsystems, tasks), with one
person for each case of the access rules (apps/projects/access.py). Not a test module itself."""

from io import StringIO
from types import SimpleNamespace

from django.core.management import call_command

from apps.members.models import Member, MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.models import Project, ProjectCategory, ProjectMember, ProjectStatus
from apps.subsystems.models import LifecycleStep, MemberSubsystem, Subsystem


def person(key, **extra):
    return Member.objects.create_user(
        email=f"{key}@example.invalid", password=None, first_name=key.capitalize(), last_name="Test", **extra
    )


def build_team():
    """
    FS Team ─┬─ Electronics (led by `lead`; `engineer` works there, assigned to the Battery subsystem)
             └─ Aerodynamics (`teammate` and `outsider` work there)
    Projects Office (where `manager` holds a project-manager role)

    Projects: "EV Test" (active, managed by `manager`, `teammate` in its team, subsystem Battery) and
    "IC Test" (planned, no manager, subsystem Engine in Aerodynamics). `admin` is a superuser, `former`
    an inactive account. `outsider` is involved in nothing.
    """
    call_command("seed_lifecycle_steps", stdout=StringIO())
    fs_team = OrgUnit.objects.create(code="t-fs-team", name="FS Team", type=OrgUnitType.FS_TEAM)
    electronics = OrgUnit.objects.create(
        code="t-electronics", name="Electronics", type=OrgUnitType.FS_DEPARTMENT, parent=fs_team
    )
    aero = OrgUnit.objects.create(code="t-aero", name="Aerodynamics", type=OrgUnitType.FS_DEPARTMENT, parent=fs_team)
    office = OrgUnit.objects.create(code="t-office", name="Projects Office", type=OrgUnitType.CLUB_DEPARTMENT)

    lead_role = Role.objects.create(
        code="t-lead", name="Lead Engineer", role_type=MemberRoleType.HEAD_OF_DEPARTMENT, scope=RoleScope.FS_TEAM,
        is_leadership=True,
    )
    engineer_role = Role.objects.create(
        code="t-engineer", name="Engineer", role_type=MemberRoleType.MEMBER, scope=RoleScope.FS_TEAM
    )
    manager_role = Role.objects.create(
        code="t-manager", name="Project Manager", role_type=MemberRoleType.HEAD_OF_DEPARTMENT, scope=RoleScope.CLUB,
        is_leadership=True, can_be_project_manager=True,
    )

    admin = person("admin", is_superuser=True, is_staff=True)
    manager = person("manager")
    lead = person("lead")
    engineer = person("engineer")
    teammate = person("teammate")
    outsider = person("outsider")
    former = person("former", is_active=False)

    Membership.objects.create(member=manager, org_unit=office, role=manager_role)
    Membership.objects.create(member=lead, org_unit=electronics, role=lead_role)
    Membership.objects.create(member=engineer, org_unit=electronics, role=engineer_role, member_level="main")
    Membership.objects.create(member=teammate, org_unit=aero, role=engineer_role, member_level="junior")
    Membership.objects.create(member=outsider, org_unit=aero, role=engineer_role, member_level="main")

    ev = Project.objects.create(
        name="EV Test", category=ProjectCategory.EV, org_unit=fs_team, status=ProjectStatus.ACTIVE,
        project_manager=manager,
    )
    ic = Project.objects.create(
        name="IC Test", category=ProjectCategory.IC, org_unit=fs_team, status=ProjectStatus.PLANNED
    )
    ProjectMember.objects.create(project=ev, member=teammate, role="Member")
    battery = Subsystem.objects.create(name="Battery", project=ev, org_unit=electronics)
    engine = Subsystem.objects.create(name="Engine", project=ic, org_unit=aero)
    MemberSubsystem.objects.create(subsystem=battery, member=engineer, member_level="main")

    steps = {step.step_order: step for step in LifecycleStep.objects.all()}
    return SimpleNamespace(
        fs_team=fs_team, electronics=electronics, aero=aero, office=office,
        admin=admin, manager=manager, lead=lead, engineer=engineer, teammate=teammate, outsider=outsider,
        former=former, ev=ev, ic=ic, battery=battery, engine=engine, steps=steps,
    )
