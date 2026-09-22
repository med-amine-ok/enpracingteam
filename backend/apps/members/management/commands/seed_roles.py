from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import ProtectedError

from apps.members.models import MemberRoleType, Role, RoleScope

CLUB = RoleScope.CLUB
FS = RoleScope.FS_TEAM
ADMIN = MemberRoleType.ADMIN
HEAD = MemberRoleType.HEAD_OF_DEPARTMENT
MEMBER = MemberRoleType.MEMBER


def role(code, name, scope, role_type, leadership=False, pm=False, aliases=()):
    """code = stable identity (never change it). name = display name (change freely)."""
    return {
        "code": code, "name": name, "scope": scope, "role_type": role_type,
        "is_leadership": leadership, "can_be_project_manager": pm, "aliases": list(aliases),
    }


# ------------------------------------------------------------------
# THE ROLES. Edit this list, then run: python manage.py seed_roles
# ------------------------------------------------------------------
ROLES = [
    # --- Governing bodies (admins; refine titles when known) ---
    role("board-member", "Board Member", CLUB, ADMIN, leadership=True), # membre de conseil d administration 
    role("executive-bureau-member", "Executive Bureau Member", CLUB, ADMIN, leadership=True), # membre bureau executifs 

    # --- Club departments: leadership ---
    role("project-manager", "Project Manager", CLUB, HEAD, leadership=True, pm=True),
    role("business-projects-lead", "Business Projects Lead", CLUB, HEAD, leadership=True),
    role("information-systems-lead", "Information Systems Lead", CLUB, HEAD, leadership=True),
    role("training-industry-lead", "Training & Industry Lead", CLUB, HEAD, leadership=True),
    role("operations-lead", "Operations Lead", CLUB, HEAD, leadership=True),
    role("lead-journalist", "Lead Journalist", CLUB, HEAD, leadership=True),
    role("head-of-production", "Head of Production", CLUB, HEAD, leadership=True),

    # --- Club departments: functional titles ---
    role("training-coordinator", "Training Coordinator", CLUB, MEMBER,
         aliases=["Coordinator"]),
    role("producer", "Producer", CLUB, MEMBER),
    role("developer", "Developer", CLUB, MEMBER,
         aliases=["ERP Developer"]),
    role("logistics-coordinator", "Logistics Coordinator", CLUB, MEMBER),
    role("business-projects-member", "Business Projects Member", CLUB, MEMBER,
         aliases=["Buisness projects Member ", "Buisness projects Member"]),


    # --- Formula Student team leadership ---
    role("team-lead", "Team Lead", FS, ADMIN, leadership=True),
    role("chief-engineer", "Chief Engineer", FS, ADMIN, leadership=True),
    role("manufacturing-workshop-lead", "Manufacturing & Workshop Lead", FS, ADMIN, leadership=True),
    role("team-manager", "Team Manager", FS, ADMIN, leadership=True),

    # --- Formula Student technical departments: leadership ---
    role("suspension-steering-lead-engineer", "Suspension & Steering Lead Engineer", FS, HEAD, leadership=True),
    role("chassis-ergonomics-lead-engineer", "Chassis & Ergonomics Lead Engineer", FS, HEAD, leadership=True),
    role("powertrain-lead-engineer", "Powertrain Lead Engineer", FS, HEAD, leadership=True),
    role("aerodynamics-lead-engineer", "Aerodynamics Lead Engineer", FS, HEAD, leadership=True),
    role("electronics-lead-engineer", "Electronics Lead Engineer", FS, HEAD, leadership=True),

    # --- Formula Student technical departments: members ---
    role("suspension-steering-engineer", "Suspension & Steering Engineer", FS, MEMBER),
    role("chassis-ergonomics-engineer", "Chassis & Ergonomics Engineer", FS, MEMBER),
    role("powertrain-engineer", "Powertrain Engineer", FS, MEMBER),
    role("aerodynamics-engineer", "Aerodynamics Engineer", FS, MEMBER),
    role("electronics-engineer", "Electronics Engineer", FS, MEMBER),
]

FIELDS = ["code", "name", "scope", "role_type", "is_leadership",
          "can_be_project_manager"]


class Command(BaseCommand):
    help = "Sync roles with the ROLES list (safe to re-run)."

    @transaction.atomic
    def handle(self, *args, **options):
        codes = [r["code"] for r in ROLES]
        if len(codes) != len(set(codes)):
            raise CommandError("Duplicate role code in ROLES.")

        for spec in ROLES:
            self._sync(spec)
        self._prune(set(codes))

        unmanaged = Role.objects.filter(code__isnull=True)
        if unmanaged.exists():
            names = ", ".join(str(r) for r in unmanaged)
            self.stdout.write(self.style.WARNING(f"  not managed by the seed (no code): {names}"))

        self.stdout.write(self.style.SUCCESS(f"Done. {Role.objects.count()} roles."))

    def _sync(self, spec):
        obj = Role.objects.filter(code=spec["code"]).first()

        if obj is None:  # first run: adopt an existing row that has no code yet
            names = [spec["name"], *spec["aliases"]]
            obj = Role.objects.filter(
                code__isnull=True, scope=spec["scope"], name__in=names
            ).order_by("id").first()

        if obj is None:
            Role.objects.create(**{f: spec[f] for f in FIELDS})
            self.stdout.write(f"  created: {spec['name']} ({spec['scope']})")
            return

        changed = [f for f in FIELDS if getattr(obj, f) != spec[f]]
        if changed:
            for f in changed:
                setattr(obj, f, spec[f])
            obj.save()
            self.stdout.write(f"  updated: {spec['name']} ({', '.join(changed)})")

    def _prune(self, kept_codes):
        """Roles removed from the list: delete if unused, otherwise keep and warn."""
        for obj in Role.objects.filter(code__isnull=False).exclude(code__in=kept_codes):
            try:
                with transaction.atomic():
                    obj.delete()
                self.stdout.write(f"  removed: {obj}")
            except ProtectedError:
                self.stdout.write(self.style.WARNING(f"  in use, kept: {obj}"))