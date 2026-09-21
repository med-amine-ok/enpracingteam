from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import ProtectedError

from apps.members.models import OrgUnit, OrgUnitType

ROOT = OrgUnitType.ROOT
GOV = OrgUnitType.GOVERNING_BODY
DEPT = OrgUnitType.CLUB_DEPARTMENT
FS_TEAM = OrgUnitType.FS_TEAM
FS_DEPT = OrgUnitType.FS_DEPARTMENT


def unit(code, name, type_, parent=None, aliases=()):
    """
    code    : stable identity. NEVER change it once it is in use.
    name    : display name. Change it freely.
    parent  : code of the parent unit (it must appear EARLIER in the list).
    aliases : old names, used once to adopt existing rows that have no code yet.
    """
    return {"code": code, "name": name, "type": type_, "parent": parent, "aliases": list(aliases)}


# ------------------------------------------------------------------
# THE STRUCTURE. Edit this list, then run: python manage.py seed_org_units
# ------------------------------------------------------------------
UNITS = [
    unit("enp-racing-team", "ENP Racing Team", ROOT),

    unit("board", "Board of Directors", GOV, "enp-racing-team",
         aliases=["Conseil d'Administration"]),
    unit("executive-bureau", "Executive Bureau", GOV, "enp-racing-team",
         aliases=["Bureau Exécutif"]),

    unit("dept-projet", "Project Department", DEPT, "enp-racing-team",
         aliases=["Département Projet"]),
    unit("dept-training-industry", "Training & Industry Department", DEPT, "enp-racing-team",
         aliases=["Département Formation & Industrie"]),
    unit("dept-media", "Media & Scientific Journalism Department", DEPT, "enp-racing-team",
         aliases=["Département Médias & Journalisme Scientifique"]),
    unit("dept-information-systems", "Information Systems Department", DEPT, "enp-racing-team",
         aliases=["Département Systèmes d'Information"]),
    unit("dept-business-projects", "Business Projects Department", DEPT, "enp-racing-team",
         aliases=["Département Business Projects", "Département Business & Innovation"]),
    unit("dept-operations", "Operations & Partnerships Department", DEPT, "enp-racing-team",
         aliases=["Département Opérations & Partenariats"]),

    unit("fs-team", "Formula Student Team", FS_TEAM, "dept-projet"),
    unit("fs-suspension-steering", "Suspension & Steering", FS_DEPT, "fs-team"),
    unit("fs-chassis-ergonomics", "Chassis & Ergonomics", FS_DEPT, "fs-team"),
    unit("fs-powertrain", "Powertrain", FS_DEPT, "fs-team"),
    unit("fs-aerodynamics", "Aerodynamics", FS_DEPT, "fs-team"),
    unit("fs-electronics", "Electronics", FS_DEPT, "fs-team"),
]


class Command(BaseCommand):
    help = "Sync the organizational structure with the UNITS list (safe to re-run)."

    @transaction.atomic
    def handle(self, *args, **options):
        self._validate()

        by_code = {}
        for spec in UNITS:
            parent = by_code[spec["parent"]] if spec["parent"] else None
            by_code[spec["code"]] = self._sync(spec, parent)

        self._prune(set(by_code))

        unmanaged = OrgUnit.objects.filter(code__isnull=True)
        if unmanaged.exists():
            names = ", ".join(u.name for u in unmanaged)
            self.stdout.write(self.style.WARNING(f"  not managed by the seed (no code): {names}"))

        self.stdout.write(self.style.SUCCESS(
            f"Done. {OrgUnit.objects.filter(is_active=True).count()} active org units."
        ))
        self.stdout.write("")
        self._print_tree(by_code[UNITS[0]["code"]], 0)

    def _validate(self):
        seen = set()
        for spec in UNITS:
            if spec["code"] in seen:
                raise CommandError(f"Duplicate code: {spec['code']}")
            if spec["parent"] and spec["parent"] not in seen:
                raise CommandError(
                    f"'{spec['code']}': parent '{spec['parent']}' must be defined earlier in the list."
                )
            seen.add(spec["code"])

    def _sync(self, spec, parent):
        obj = OrgUnit.objects.filter(code=spec["code"]).first()

        if obj is None:  # first run: adopt an existing row that has no code yet
            names = [spec["name"], *spec["aliases"]]
            obj = OrgUnit.objects.filter(code__isnull=True, name__in=names).order_by("id").first()

        if obj is None:
            OrgUnit.objects.create(
                code=spec["code"], name=spec["name"], type=spec["type"], parent=parent
            )
            self.stdout.write(f"  created: {spec['name']}")
            return OrgUnit.objects.get(code=spec["code"])

        desired = {
            "code": spec["code"],
            "name": spec["name"],
            "type": spec["type"],
            "parent_id": parent.id if parent else None,
            "is_active": True,
        }
        changed = [f for f, v in desired.items() if getattr(obj, f) != v]
        if changed:
            for f in changed:
                setattr(obj, f, desired[f])
            obj.save()
            self.stdout.write(f"  updated: {spec['name']} ({', '.join(changed)})")
        return obj

    def _prune(self, kept_codes):
        """Units removed from the list: delete if unused, otherwise deactivate."""
        obsolete = list(OrgUnit.objects.filter(code__isnull=False).exclude(code__in=kept_codes))
        progress = True
        while obsolete and progress:  # several passes so children go before their parent
            progress = False
            for obj in list(obsolete):
                try:
                    with transaction.atomic():
                        obj.delete()
                except ProtectedError:
                    continue
                obsolete.remove(obj)
                progress = True
                self.stdout.write(f"  removed: {obj.name}")
        for obj in obsolete:
            if obj.is_active:
                obj.is_active = False
                obj.save()
                self.stdout.write(self.style.WARNING(f"  in use, deactivated instead: {obj.name}"))

    def _print_tree(self, obj, depth):
        self.stdout.write("  " * depth + ("└─ " if depth else "") + obj.name)
        for child in obj.children.filter(is_active=True).order_by("id"):
            self._print_tree(child, depth + 1)