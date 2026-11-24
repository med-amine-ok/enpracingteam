from django.core.management.base import BaseCommand
from django.db import transaction

from apps.subsystems.models import STANDARD_STEPS, LifecycleStep

# Reference data: every subsystem goes through these steps. The list (names, translations, the
# validation step) lives in apps/subsystems/models.py, STANDARD_STEPS.


class Command(BaseCommand):
    help = "Create or update the standard lifecycle steps (safe to re-run)."

    @transaction.atomic
    def handle(self, *args, **options):
        for order, (name, _translated, requires_validation) in enumerate(STANDARD_STEPS, start=1):
            step, created = LifecycleStep.objects.update_or_create(
                step_order=order, defaults={"name": name, "requires_validation": requires_validation}
            )
            self.stdout.write(f"  {'created' if created else 'up to date'}: {step}")
        self.stdout.write(f"Done. {len(STANDARD_STEPS)} lifecycle steps.")
