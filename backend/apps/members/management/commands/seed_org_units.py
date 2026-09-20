from django.core.management.base import BaseCommand
from django.db import transaction

from apps.members.models import OrgUnit, OrgUnitType

ROOT_NAME = "ENP Racing Team"

GOVERNING_BODIES = [
    "Conseil d'Administration",
    "Bureau Exécutif",
]

CLUB_DEPARTMENTS = [
    "Département Projet",
    "Département Formation & Industrie",
    "Département Médias & Journalisme Scientifique",
    "Département Systèmes d'Information",
    "Département Business & Innovation",
    "Département Opérations & Partenariats",
]

FS_TEAM_NAME = "Formula Student Team"
FS_TEAM_PARENT = "Département Projet"

FS_DEPARTMENTS = [
    "Suspension & Steering",
    "Chassis & Ergonomics",
    "Powertrain",
    "Aerodynamics",
    "Electronics",
]


class Command(BaseCommand):
    help = "Create the ENP Racing organizational structure (safe to re-run, fixes parents)."

    @transaction.atomic
    def handle(self, *args, **options):
        def ensure(name, unit_type, parent=None):
            unit, created = OrgUnit.objects.get_or_create(
                name=name, defaults={"type": unit_type, "parent": parent}
            )
            if created:
                self.stdout.write(f"  created: {name}")
            else:
                parent_id = parent.id if parent else None
                if unit.type != unit_type or unit.parent_id != parent_id:
                    unit.type = unit_type
                    unit.parent = parent
                    unit.save(update_fields=["type", "parent", "updated_at"])
                    self.stdout.write(f"  updated: {name}")
            return unit

        # Root
        root = ensure(ROOT_NAME, OrgUnitType.ROOT)

        # Governing bodies (directly under the root)
        for name in GOVERNING_BODIES:
            ensure(name, OrgUnitType.GOVERNING_BODY, root)

        # The 6 club departments (directly under the root)
        departments = {
            name: ensure(name, OrgUnitType.CLUB_DEPARTMENT, root)
            for name in CLUB_DEPARTMENTS
        }

        # Formula Student team under Département Projet, then its technical departments
        fs_team = ensure(FS_TEAM_NAME, OrgUnitType.FS_TEAM, departments[FS_TEAM_PARENT])
        for name in FS_DEPARTMENTS:
            ensure(name, OrgUnitType.FS_DEPARTMENT, fs_team)

        self.stdout.write(self.style.SUCCESS(f"Done. {OrgUnit.objects.count()} org units."))
        self.stdout.write("")
        self._print_tree(root, 0)

    def _print_tree(self, unit, depth):
        self.stdout.write("  " * depth + ("└─ " if depth else "") + unit.name)
        for child in unit.children.order_by("id"):
            self._print_tree(child, depth + 1)