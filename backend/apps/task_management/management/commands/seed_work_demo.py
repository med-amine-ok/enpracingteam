"""Demo data for the work module, worked on by the fictitious people of seed_demo (run it first).

    python manage.py seed_work_demo           create the demo (or replace it)
    python manage.py seed_work_demo --clear   remove it

Development only: refused when DEBUG is off. Everything goes through the services, so the states, the activity
and the notifications are those of real use. The Head's actions are done by a leader of the department if there is
one in the database, else by a superuser."""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.communication.notify import unit_leaders
from apps.members.models import Member, OrgUnit
from apps.projects.models import Project

from ...models import ActivityLog, Deliverable, DeliverableStatus, Season, WorkOrder
from ...services import blockers, deliverables, dependencies, submissions, work_orders

TITLE_PREFIX = "[DEMO] "


def person(key):
    return Member.objects.get(email=f"{key}.demo@example.invalid")


class Command(BaseCommand):
    help = "Create (or remove with --clear) the work module's demo data."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true")

    def handle(self, *args, clear=False, **options):
        if not settings.DEBUG:
            raise CommandError("Development only: DEBUG is off.")
        with transaction.atomic():
            self.clear()
            if not clear:
                self.create()
        self.stdout.write(self.style.SUCCESS("Work demo removed." if clear else "Work demo created."))

    def clear(self):
        demo = WorkOrder.objects.filter(title__startswith=TITLE_PREFIX)
        items = Deliverable.objects.filter(work_order__in=demo)
        from ...models import (
            Blocker, DependencyLink, FirstCompleteSubmissionSnapshot, ManualDependencyReleaseAudit, QualityInput,
            ReliefInterval, Review, ScoreSnapshot, Submission, TimeInput,
        )

        ScoreSnapshot.objects.filter(deliverable__in=items).delete()
        TimeInput.objects.filter(deliverable__in=items).delete()
        QualityInput.objects.filter(deliverable__in=items).delete()
        ReliefInterval.objects.filter(deliverable__in=items).delete()
        Blocker.objects.filter(work_order__in=demo).delete()
        ManualDependencyReleaseAudit.objects.filter(dependency_link__dependent__in=items).delete()
        DependencyLink.objects.filter(dependent__in=items).delete()
        DependencyLink.objects.filter(prerequisite__in=items).delete()
        FirstCompleteSubmissionSnapshot.objects.filter(deliverable__in=items).delete()
        Review.objects.filter(submission__deliverable__in=items).delete()
        Submission.objects.filter(deliverable__in=items).delete()
        ActivityLog.objects.filter(work_order__in=demo).delete()
        items.delete()
        demo.delete()

    def head_of(self, code):
        unit = OrgUnit.objects.get(code=code)
        leaders = unit_leaders(unit)
        return leaders[0] if leaders else Member.objects.filter(is_superuser=True).first()

    def create(self):
        if not Member.objects.filter(email="lina.demo@example.invalid").exists():
            raise CommandError("Run seed_demo first: the work demo uses its people.")
        call_command("seed_task_management", stdout=self.stdout)
        season = Season.objects.get(is_active=True)
        today = timezone.localdate()
        lina, rayan, karim, sara = person("lina"), person("rayan"), person("karim"), person("sara")
        head = self.head_of("fs-electronics")
        project = Project.objects.filter(code="demo-ev-2027").first()
        if project and project.season_id is None:
            project.season = season
            project.save(update_fields=["season"])
        electronics = OrgUnit.objects.get(code="fs-electronics")

        pack = work_orders.create(head, {
            "season": season, "department": electronics, "project": project,
            "title": TITLE_PREFIX + "HV battery pack", "priority": "high",
            "description": "Design, simulate and document the high-voltage battery pack of the EV.",
            "objectives": "A validated pack design ready for manufacturing.",
        })
        work_orders.set_rubric(head, pack, {"effort": 4, "complexity": 5, "uncertainty": 3, "responsibility": 4})
        work_orders.update(head, pack, {"budget_tier": 4})
        plan = [
            ("Cell selection", "Cell model chosen and justified (capacity, discharge, cost).", -40, -20, ["lina"], "25"),
            ("Pack CAD", "Complete pack CAD with modules, housing and fixings, reviewed.", -25, 10, ["rayan", "lina"], "35"),
            ("Thermal simulation", "Thermal simulation report at peak load, with margins.", -5, 25, ["lina"], "25"),
            ("Integration test plan", "Bench test plan for the pack in the chassis.", 0, 40, ["rayan"], "15"),
        ]
        items = []
        for title, criteria, start, due, people, _ in plan:
            items.append(deliverables.create(head, pack, {
                "title": title, "acceptance_criteria": criteria,
                "start_date": today + timedelta(days=start), "original_deadline": today + timedelta(days=due),
            }, [person(key) for key in people]))
        deliverables.set_weights(head, pack, {item.pk: Decimal(weight) for item, (*_, weight) in zip(items, plan, strict=True)})
        work_orders.activate(head, pack)
        cells, cad, thermal, integration = items
        for item in items[:3]:
            deliverables.mark_ready(head, item)

        # Cell selection: submitted, validated with its quality mark.
        deliverables.start(lina, cells)
        deliverables.update_progress(lina, cells, 100, "Cells chosen")
        evidence = [{"url": "https://drive.example.invalid/cells-study", "label": "Cell study", "link_type": "report"}]
        submissions.submit(lina, cells, "Study attached", evidence, True)
        reviewer = Member.objects.filter(is_superuser=True).exclude(pk=head.pk).first() or head
        from ...access import Access

        submissions.review(Access(reviewer), cells.submissions.get(), {"decision": "validated", "raw_quality": "4.5"})

        # Pack CAD: under way, with Milestones and a blocker.
        deliverables.start(rayan, cad)
        deliverables.update_progress(rayan, cad, 60, "Modules and housing modelled")
        for title, done in (("Module layout", True), ("Housing", True), ("Fixings", False), ("Design review", False)):
            milestone = deliverables.create_milestone(rayan, cad, title)
            if done:
                deliverables.set_completed(rayan, milestone, True)
        blockers.report(rayan, {
            "deliverable": cad, "severity": "medium", "impact": "partial", "origin": "resource",
            "description": "The fixing bolts' supplier datasheet is missing.",
            "required_action": "Ask Operations for the datasheet.",
        })

        # Thermal simulation waits for the CAD; started on its independent part.
        dependencies.create(head, cad, thermal, "blocks", "validated", reason="The simulation needs the final geometry")
        deliverables.start(lina, thermal)
        deliverables.update_progress(lina, thermal, 20, "Material data gathered")

        # A member's proposal awaiting the Head, and a proposed Deliverable.
        work_orders.propose(karim, {
            "season": season, "department": OrgUnit.objects.get(code="fs-powertrain"), "project": project,
            "title": TITLE_PREFIX + "Inverter cooling study", "description": "Size the cooling of the inverter.",
            "justification": "The inverter overheats on the bench.",
        })
        deliverables.propose(sara, pack, {
            "title": "Pack aerodynamic cover", "description": "A cover to guide the air over the pack.",
            "acceptance_criteria": "CFD shows a lower pack temperature.",
        }, justification="Helps the thermal margins.")
        assert integration.status == DeliverableStatus.DRAFT
