"""Seeds the work module: the scoring formula v1.0 (specification §7–9) and the current season (the first scored one).
Safe to re-run: nothing that exists is changed."""

from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.task_management.models import FormulaVersion, Season


def season_of(today):
    """The club's year runs from September: 2026-27 starts in September 2026."""
    start = today.year if today.month >= 9 else today.year - 1
    return start, f"{start}–{start + 1}"


class Command(BaseCommand):
    help = "Seed the scoring formula v1.0 and the current season (safe to re-run)."

    @transaction.atomic
    def handle(self, *args, **options):
        formula, created = FormulaVersion.objects.get_or_create(
            code="v1.0",
            defaults={"description": "ENP Racing scoring formula, specification of the task module (v1.0)."},
        )
        if not FormulaVersion.objects.filter(is_current=True).exists():
            formula.is_current = True
            formula.save(update_fields=["is_current"])
        self.stdout.write(f"  {'created' if created else 'ok'}: formula {formula.code}")
        if not Season.objects.filter(is_active=True).exists():
            year, label = season_of(timezone.localdate())
            cutoff = datetime.combine(datetime(year + 1, 7, 31).date(), time(23, 59), tzinfo=ZoneInfo("Africa/Algiers"))
            season, created = Season.objects.get_or_create(
                code=f"season-{year}", defaults={"year": year, "label": label, "scoring_cutoff_at": cutoff}
            )
            season.is_active = True
            season.save(update_fields=["is_active"])
            self.stdout.write(f"  {'created' if created else 'ok'}: current season {season.label}")
        self.stdout.write(self.style.SUCCESS("Work module seeded."))
