from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count, Q

from apps.members.models import Member, MemberRoleType, Membership, OrgUnit, Role

SEEDS = ["seed_org_units", "seed_roles", "seed_members", "sync_group"]


class Command(BaseCommand):
    help = "Run every seed in the right order, then verify the result (safe to re-run)."

    @transaction.atomic  # if the verification fails, nothing is saved
    def handle(self, *args, **options):
        for name in SEEDS:
            self.stdout.write(self.style.MIGRATE_HEADING(f"\n== {name} =="))
            call_command(name)

        self.stdout.write(self.style.MIGRATE_HEADING("\n== verification =="))
        problems = self._verify()
        if problems:
            raise CommandError(
                "Seed verification failed, nothing was saved:\n  - " + "\n  - ".join(problems)
            )

        active = Membership.objects.filter(end_date__isnull=True)
        on_bureau = active.filter(org_unit__code="executive-bureau").count()
        self.stdout.write(self.style.SUCCESS(
            f"OK: {OrgUnit.objects.filter(is_active=True).count()} org units, "
            f"{Role.objects.count()} roles, "
            f"{Member.objects.filter(code__isnull=False).count()} members, "
            f"{active.count()} active memberships ({on_bureau} on the Executive Bureau)."
        ))

    def _verify(self):
        problems = []
        seeded = Member.objects.filter(code__isnull=False)

        # 1. Every seeded member has exactly one active primary membership.
        bad = seeded.annotate(
            primaries=Count(
                "memberships",
                filter=Q(memberships__end_date__isnull=True, memberships__is_primary=True),
            )
        ).exclude(primaries=1)
        problems += [f"{m} has {m.primaries} active primary memberships" for m in bad]

        # 2. Every seeded department head (club or FS) is on the Executive Bureau.
        active = Membership.objects.filter(end_date__isnull=True, member__code__isnull=False)
        heads = set(
            active.filter(role__role_type=MemberRoleType.HEAD_OF_DEPARTMENT)
            .values_list("member_id", flat=True)
        )
        on_bureau = set(
            active.filter(org_unit__code="executive-bureau").values_list("member_id", flat=True)
        )
        problems += [
            f"{m} is a department head but not on the Executive Bureau"
            for m in Member.objects.filter(id__in=heads - on_bureau)
        ]
        return problems