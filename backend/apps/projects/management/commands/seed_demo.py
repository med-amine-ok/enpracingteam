"""Demo data to try the ERP: projects, subsystems, tasks, purchases and stock, worked on by fictitious people.

Everything here is invented. The people have @example.invalid addresses (a domain reserved
for examples: no e-mail can ever be delivered there) and no leadership role, so the real
organisation (Executive Bureau, department heads) is left unchanged.

    python manage.py seed_demo           create the demo (or replace it)
    python manage.py seed_demo --clear   remove it

Development only: refused when DEBUG is off. Demo rows are recognised by their "demo-"
code (people, projects, subsystems); their tasks belong to demo projects; the demo suppliers'
names start with "[DEMO]"; the demo parts are described as such (DEMO_PART). Dates are relative to today, so the demo always looks current. Edit the
lists below to change it.

Purchases: the approvals of the head of Operations are left without a name in their history (no
fictitious person holds that role: in the development database it belongs to a real member).
"""

from datetime import timedelta

from datetime import datetime, time
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.communication.models import Notification, NotificationKind
from apps.finance.models import Expense
from apps.inventory.models import StockItem, StockMovement, StockMovementType
from apps.members.models import Member, Membership, OrgUnit, Role
from apps.projects.models import Project, ProjectCategory, ProjectMember, ProjectStatus
from apps.purchasing.models import (
    Currency, Part, PartCategory, PurchaseAction, PurchaseOrder, PurchasePriority, PurchaseRequest,
    PurchaseRequestEvent, PurchaseStatus, ShippingAddress, Supplier, SupplierStatus, SupplierType,
)
from apps.subsystems.models import LifecycleStep, MemberSubsystem, Subsystem, SubsystemStatus, SubsystemStepProgress
from apps.tasks.models import (
    Blocker, BlockerOrigin, BlockerSeverity, Task, TaskAssignee, TaskComment, TaskLink, TaskLinkType, TaskPriority,
    TaskStatus,
)

PREFIX = "demo-"
EMAIL_DOMAIN = "example.invalid"

# key, first name, skill, home org unit, role, level. Last name is always "Demo".
PEOPLE = [
    ("lina", "Lina", "Batteries, BMS", "fs-electronics", "fs-member", "main"),
    ("rayan", "Rayan", "CAO (SolidWorks)", "fs-electronics", "fs-member", "junior"),
    ("karim", "Karim", "Moteurs électriques", "fs-powertrain", "fs-member", "main"),
    ("sara", "Sara", "CFD", "fs-aerodynamics", "fs-member", "junior"),
    ("yacine", "Yacine", "Liaisons au sol", "fs-suspension-steering", "fs-member", "main"),
    ("nour", "Nour", "Ergonomie", "fs-chassis-ergonomics", "fs-member", "junior"),
    ("ines", "Ines", "Organisation d'événements", "dept-training-industry", "club-member", "main"),
    ("adam", "Adam", "Graphisme", "dept-media", "club-member", "junior"),
    ("mehdi", "Mehdi", "Logistique et achats", "dept-operations", "logistics-coordinator", "main"),
]

# code, name, category, org unit, status, (start, end) in days from today, manager, team.
PROJECTS = [
    ("demo-ev-2027", "[DEMO] EV 2027", ProjectCategory.EV, "fs-team", ProjectStatus.ACTIVE, (-45, 240),
     "lina", ["rayan", "karim", "sara", "yacine", "nour"]),
    ("demo-ic-2027", "[DEMO] IC 2027", ProjectCategory.IC, "fs-team", ProjectStatus.PLANNED, (30, 300),
     "yacine", ["karim", "nour"]),
    ("demo-open-day", "[DEMO] Journée portes ouvertes", ProjectCategory.CLUB, "dept-training-industry",
     ProjectStatus.ACTIVE, (-10, 20), "ines", ["adam"]),
]
# The prefix of each demo project's task references (EV27-001...).
PROJECT_KEYS = {"demo-ev-2027": "EV27", "demo-ic-2027": "IC27", "demo-open-day": "JPO"}

# code, name, project, technical department, parent, status, lifecycle steps done, people (key, level).
# At most 3 steps done: step 4 ("Validation par le chef") is left to a real department head.
SUBSYSTEMS = [
    ("demo-ev-hv", "HV System", "demo-ev-2027", "fs-electronics", None,
     SubsystemStatus.ACTIVE, 3, [("lina", "main")]),
    ("demo-ev-battery", "HV Battery & BMS", "demo-ev-2027", "fs-electronics", "demo-ev-hv",
     SubsystemStatus.ACTIVE, 3, [("lina", "main"), ("rayan", "junior")]),
    ("demo-ev-motor", "Motor & Inverter", "demo-ev-2027", "fs-powertrain", "demo-ev-hv",
     SubsystemStatus.ACTIVE, 2, [("karim", "main")]),
    ("demo-ev-steering", "Steering System", "demo-ev-2027", "fs-suspension-steering", None,
     SubsystemStatus.ACTIVE, 2, [("yacine", "main")]),
    ("demo-ev-front-wing", "Front Wing", "demo-ev-2027", "fs-aerodynamics", None,
     SubsystemStatus.BLOCKED, 1, [("sara", "junior")]),
    ("demo-ev-cockpit", "Chassis & Cockpit", "demo-ev-2027", "fs-chassis-ergonomics", None,
     SubsystemStatus.ACTIVE, 2, [("nour", "junior")]),
    ("demo-ic-engine", "Engine & Intake", "demo-ic-2027", "fs-powertrain", None,
     SubsystemStatus.PLANNED, 0, [("karim", "main")]),
    ("demo-ic-suspension", "Suspension", "demo-ic-2027", "fs-suspension-steering", None,
     SubsystemStatus.PLANNED, 1, [("yacine", "main")]),
    ("demo-ic-frame", "Tubular Frame", "demo-ic-2027", "fs-chassis-ergonomics", None,
     SubsystemStatus.PLANNED, 0, [("nour", "junior")]),
]

T, P = TaskStatus, TaskPriority
# A demo task "blocked": in progress, with a blocker declared by its main owner (BLOCKERS).
BLOCKED = "blocked"
# key, project, subsystem, lifecycle step, title, status, priority, due (days from today),
# assignees (the first one is the main owner), parent task. Without points, like the tasks of before
# 20/10/2026 (scored = False): they start without a leader's estimate.
TASKS = [
    ("cells", "demo-ev-2027", "demo-ev-battery", 1, "Choisir les cellules de la batterie",
     T.VALIDATED, P.HIGH, -20, ["lina", "rayan"], None),
    ("pack-cad", "demo-ev-2027", "demo-ev-battery", 2, "Modéliser le pack batterie en CAO",
     T.IN_PROGRESS, P.HIGH, 5, ["rayan", "lina"], None),
    ("pack-modules", "demo-ev-2027", "demo-ev-battery", 2, "Modules de cellules",
     T.VALIDATED, P.MEDIUM, -6, ["rayan"], "pack-cad"),
    ("pack-housing", "demo-ev-2027", "demo-ev-battery", 2, "Boîtier et fixations",
     T.IN_PROGRESS, P.MEDIUM, 5, ["rayan"], "pack-cad"),
    ("pack-thermal", "demo-ev-2027", "demo-ev-battery", 3, "Simulation thermique du pack",
     T.PLANNED, P.MEDIUM, 18, ["lina"], None),
    ("inverter-quote", "demo-ev-2027", "demo-ev-motor", 5, "Demander un devis pour l'onduleur",
     BLOCKED, P.HIGH, -3, ["karim"], None),
    ("steering-rack", "demo-ev-2027", "demo-ev-steering", 2, "Dimensionner la crémaillère",
     T.IN_PROGRESS, P.MEDIUM, 10, ["yacine"], None),
    ("wing-cfd", "demo-ev-2027", "demo-ev-front-wing", 3, "Simulation CFD de l'aileron avant",
     BLOCKED, P.MEDIUM, -7, ["sara"], None),
    ("driver-ergonomics", "demo-ev-2027", "demo-ev-cockpit", 1, "Mesures ergonomiques des pilotes",
     T.VALIDATED, P.LOW, -14, ["nour"], None),
    ("design-review", "demo-ev-2027", None, None, "Revue de conception EV (tous les départements)",
     T.PLANNED, P.HIGH, 25, ["lina", "karim", "yacine", "sara", "nour"], None),
    ("engine-choice", "demo-ic-2027", "demo-ic-engine", 1, "Comparer les moteurs monocylindres",
     T.PLANNED, P.MEDIUM, 40, ["karim"], None),
    ("suspension-geometry", "demo-ic-2027", "demo-ic-suspension", 1, "Géométrie de suspension (premier jet)",
     T.NEEDS_REVISION, P.LOW, 30, ["yacine"], None),
    ("room", "demo-open-day", None, None, "Réserver l'amphithéâtre",
     T.VALIDATED, P.HIGH, -2, ["ines"], None),
    ("poster", "demo-open-day", None, None, "Affiche de la journée portes ouvertes",
     T.SUBMITTED, P.MEDIUM, 4, ["adam"], None),
    ("sponsors", "demo-open-day", None, None, "Inviter les sponsors",
     T.PLANNED, P.HIGH, 7, ["ines", "adam"], None),
    ("simulator", "demo-open-day", None, None, "Préparer la démonstration du simulateur",
     T.PLANNED, P.LOW, 18, ["ines"], None),
]

# The blockers of the "blocked" demo tasks: task, description, origin, severity, required action.
BLOCKERS = [
    ("inverter-quote", "Le fournisseur de l'onduleur ne répond pas aux e-mails (démo).", BlockerOrigin.SUPPLIER,
     BlockerSeverity.HIGH, "Relancer par téléphone, ou demander un autre devis."),
    ("wing-cfd", "La licence du logiciel de CFD a expiré (démo).", BlockerOrigin.TECHNICAL, BlockerSeverity.MEDIUM,
     "Renouveler la licence étudiante."),
]

# task, author, text.
COMMENTS = [
    ("inverter-quote", "karim", "Le fournisseur n'a pas encore répondu, relance envoyée."),
    ("wing-cfd", "sara", "En attente de la licence du logiciel de simulation."),
    ("pack-cad", "lina", "Penser à laisser de la place pour le refroidissement."),
    ("pack-thermal", "rayan", "J'ai mis à jour le modèle thermique, à relire avant vendredi."),
]

# recipient, kind, actor, task, hours ago, read: as the team's actions would have created them
# (apps/communication/notify.py). The comment one matches Rayan's comment above.
NOTIFICATIONS = [
    ("lina", NotificationKind.TASK_COMMENTED, "rayan", "pack-thermal", 1, False),
    ("lina", NotificationKind.TASK_BLOCKED, "karim", "inverter-quote", 5, False),
    ("lina", NotificationKind.TASK_OVERDUE, None, "inverter-quote", 20, False),
    ("lina", NotificationKind.TASK_DONE, "rayan", "pack-modules", 48, True),
    ("rayan", NotificationKind.TASK_ASSIGNED, "lina", "pack-housing", 30, False),
]

# name, type, status, city, country, capabilities, contact e-mail, lead time (days). Contacted by Mehdi.
DEMO_SUPPLIER = "[DEMO] "
SUPPLIERS = [
    ("laser", "Atelier Laser Alger", SupplierType.SOUS_TRAITANT, SupplierStatus.VALIDEE, "Alger", "Algérie",
     "Découpe laser, pliage, soudure TIG", "laser@example.invalid", 7),
    ("cells", "Cellules & Batteries", SupplierType.FOURNISSEUR, SupplierStatus.EN_ATTENTE, "Lyon", "France",
     "Cellules Li-ion, connecteurs haute tension", "batteries@example.invalid", 21),
    ("machining", "Usinage Précision", SupplierType.USINAGE, SupplierStatus.VALIDEE, "Blida", "Algérie",
     "Tournage, fraisage 4 axes", "usinage@example.invalid", 10),
]

PS, PP = PurchaseStatus, PurchasePriority
# key, part, category, material, process, quantity, priority, needed (days from today or None),
# subsystem, requester, status, asked (days ago), order: (supplier, currency, unit price, delivery,
# rate, ordered (days ago), expected (days from today), delivered (days ago) or None), reason.
# The steps of each request follow from its status (apps/purchasing/workflow.py).
PURCHASES = [
    ("cells", "Cellules Li-ion 21700", PartCategory.ENGINE_TRACTIVE, "", "", 120, PP.HIGH, 25, "demo-ev-battery",
     "lina", PS.A_VALIDER_OPERATIONS, 2, None, ""),
    ("bracket", "Support moteur", PartCategory.CHASSIS_BODY, "Acier S235", "Découpe laser + pliage", 2, PP.HIGH, 14,
     "demo-ev-motor", "karim", PS.A_VALIDER_CHEF, 0, None, ""),
    ("rod-ends", "Rotules de direction M10", PartCategory.STEERING, "", "", 4, PP.MEDIUM, 20, "demo-ev-steering",
     "yacine", PS.A_COMMANDER, 3, None, ""),
    ("plate", "Plaque aluminium 5 mm", PartCategory.CHASSIS_BODY, "Alu 2017 A", "Découpe laser", 1, PP.MEDIUM, 7,
     "demo-ev-cockpit", "nour", PS.EN_COMMANDE, 12, ("laser", Currency.DZD, "8500", "1500", "1", 5, 5, None), ""),
    ("connectors", "Connecteurs haute tension", PartCategory.ENGINE_TRACTIVE, "", "", 10, PP.HIGH, -15, "demo-ev-hv",
     "rayan", PS.LIVRE, 35, ("cells", Currency.EUR, "12.50", "30", "250", 30, -12, 10), ""),
    ("foam", "Mousse de siège", PartCategory.OTHER, "", "", 1, PP.LOW, None, "demo-ev-cockpit", "nour", PS.ANNULE, 4,
     None, "Il en reste à l'atelier."),
]
STOCK_LOCATION = "Armoire électronique (démo)"
DEMO_PART = "Demo data: fictitious part."

# key, part, category, reference, place, threshold, movements: (kind, quantity, days ago, handed to,
# task, notes), all recorded by Mehdi. The heat-shrink sleeve ends at its threshold (low).
STOCK = [
    ("bolts", "Vis M8 × 30", PartCategory.WORKSHOP, "ISO 4017", "Atelier — bac A3", 50, [
        ("in", 200, 20, None, None, "Stock de départ"),
        ("out", 80, 10, "yacine", "steering-rack", ""),
        ("out", 40, 4, "nour", None, "Gabarit du siège"),
    ]),
    ("shrink", "Gaine thermorétractable 6 mm (rouleau)", PartCategory.LOW_VOLTAGE, "", STOCK_LOCATION, 2, [
        ("in", 5, 15, None, None, "Don d'un sponsor (démo)"),
        ("out", 3, 6, "rayan", "pack-housing", ""),
    ]),
    ("cable", "Câble silicone 2,5 mm² (bobine de 10 m)", PartCategory.LOW_VOLTAGE, "", STOCK_LOCATION, 2, [
        ("in", 6, 25, None, None, "Stock de départ"),
        ("adjustment", -1, 3, None, None, "Une bobine entamée retrouvée vide"),
    ]),
]

# recipient, kind, actor, purchase, hours ago, read: as apps/communication/notify.py would have made them.
PURCHASE_NOTIFICATIONS = [
    ("lina", NotificationKind.PURCHASE_APPROVAL_REQUESTED, "karim", "bracket", 2, False),
    ("mehdi", NotificationKind.PURCHASE_TO_ORDER, None, "rod-ends", 50, False),
    ("nour", NotificationKind.PURCHASE_UPDATED, "lina", "foam", 70, False),
    ("rayan", NotificationKind.PURCHASE_UPDATED, "mehdi", "connectors", 240, True),
]

# task, added by, url, label, type. example.com is reserved for examples.
LINKS = [
    ("pack-cad", "rayan", "https://example.com/demo/cad/battery-pack", "Maquette CAO (démo)", TaskLinkType.CAD),
    ("cells", "lina", "https://example.com/demo/reports/cell-comparison", "Comparatif des cellules (démo)",
     TaskLinkType.REPORT),
]


class Command(BaseCommand):
    help = "Create (or replace) demo projects, subsystems and tasks with fictitious people. --clear removes them."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Remove the demo data and stop.")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                "seed_demo only runs in development (DEBUG=True): demo data must never reach a real database."
            )
        with transaction.atomic():
            if options["clear"]:
                self._clear()
                self.stdout.write(self.style.SUCCESS("Demo data removed."))
                return
            units, roles, steps = self._prerequisites()
            self._clear()
            self._create(units, roles, steps)

    def _prerequisites(self):
        unit_codes = {p[3] for p in PEOPLE} | {p[3] for p in PROJECTS} | {s[3] for s in SUBSYSTEMS}
        role_codes = {p[4] for p in PEOPLE}
        units = {u.code: u for u in OrgUnit.objects.filter(code__in=unit_codes)}
        roles = {r.code: r for r in Role.objects.filter(code__in=role_codes)}
        steps = {s.step_order: s for s in LifecycleStep.objects.all()}
        missing = sorted(unit_codes - units.keys()) + sorted(role_codes - roles.keys())
        if len(steps) < max(t[3] or 0 for t in TASKS):
            missing.append("lifecycle steps")
        if missing:
            raise CommandError("Run 'python manage.py seed_all' first. Missing: " + ", ".join(missing))
        return units, roles, steps

    def _clear(self):
        self._clear_purchases()
        projects = Project.objects.filter(code__startswith=PREFIX)
        # Notifications about the demo (those of the demo people go with them, below).
        Notification.objects.filter(
            related_entity_type="task", related_entity_id__in=Task.objects.filter(project__in=projects).values("pk")
        ).delete()
        Notification.objects.filter(
            related_entity_type="subsystem",
            related_entity_id__in=Subsystem.objects.filter(code__startswith=PREFIX).values("pk"),
        ).delete()
        Task.objects.filter(project__in=projects).delete()  # with assignees, comments, links, subtasks
        # Subsystems point to their parent (PROTECT): remove the leaves first.
        while True:
            leaves = Subsystem.objects.filter(code__startswith=PREFIX, children__isnull=True)
            if not leaves.exists():
                break
            leaves.delete()
        projects.delete()
        people = Member.objects.filter(code__startswith=PREFIX, email__endswith="@" + EMAIL_DOMAIN)
        Membership.objects.filter(member__in=people).delete()
        people.delete()

    def _clear_purchases(self):
        """The purchases asked by the demo people, for the demo subsystems or from the demo suppliers,
        with their orders, stock lines, movements and notifications; then the demo suppliers and parts."""
        people = Member.objects.filter(code__startswith=PREFIX, email__endswith="@" + EMAIL_DOMAIN)
        subsystems = Subsystem.objects.filter(code__startswith=PREFIX)
        suppliers = Supplier.objects.filter(name__startswith=DEMO_SUPPLIER)
        purchases = PurchaseRequest.objects.filter(
            Q(requested_by__in=people) | Q(subsystem__in=subsystems) | Q(orders__supplier__in=suppliers)
        ).distinct()
        parts = (
            set(purchases.values_list("part_id", flat=True))
            | set(Part.objects.filter(subsystem__in=subsystems).values_list("pk", flat=True))
            | set(Part.objects.filter(description=DEMO_PART).values_list("pk", flat=True))
        )
        Notification.objects.filter(
            related_entity_type="purchase_request", related_entity_id__in=purchases.values("pk")
        ).delete()
        orders = PurchaseOrder.objects.filter(purchase_request__in=purchases)
        Expense.objects.filter(purchase_order__in=orders).delete()  # a demo order received in the ERP
        StockMovement.objects.filter(
            Q(related_purchase_order__in=orders) | Q(moved_by__in=people) | Q(stock_item__part_id__in=parts)
        ).delete()
        orders.delete()
        PurchaseRequest.objects.filter(pk__in=list(purchases.values_list("pk", flat=True))).delete()
        # The parts of these requests that nothing else uses any more, with their (now empty) stock lines.
        unused = Part.objects.filter(pk__in=parts, purchase_requests__isnull=True)
        StockItem.objects.filter(part__in=unused, movements__isnull=True).delete()
        unused.filter(stock_items__isnull=True).delete()
        suppliers.delete()
        ShippingAddress.objects.filter(contacted_by__in=people, orders__isnull=True).delete()
        # Real suppliers and addresses a demo person said they contacted stay, without the name.
        Supplier.objects.filter(contacted_by__in=people).update(contacted_by=None)
        ShippingAddress.objects.filter(contacted_by__in=people).update(contacted_by=None)

    def _create(self, units, roles, steps):
        today = timezone.localdate()

        people = {}
        for key, first_name, skill, unit, role, level in PEOPLE:
            people[key] = Member.objects.create_user(
                email=f"{key}.demo@{EMAIL_DOMAIN}", password=None, code=f"{PREFIX}{key}",
                first_name=first_name, last_name="Demo", skill=skill, join_date=today - timedelta(days=60),
            )
            Membership.objects.create(
                member=people[key], org_unit=units[unit], role=roles[role], member_level=level, is_primary=True,
            )

        projects = {}
        for code, name, category, unit, status, (start, end), manager, team in PROJECTS:
            projects[code] = Project.objects.create(
                code=code, key=PROJECT_KEYS[code], name=name, category=category, org_unit=units[unit], status=status,
                start_date=today + timedelta(days=start), end_date=today + timedelta(days=end),
                project_manager=people[manager], description="Demo data: fictitious project.",
            )
            ProjectMember.objects.create(project=projects[code], member=people[manager], role="Project manager")
            for key in team:
                ProjectMember.objects.create(project=projects[code], member=people[key], role="Member")

        subsystems = {}
        for code, name, project, unit, parent, status, steps_done, assigned in SUBSYSTEMS:
            subsystems[code] = subsystem = Subsystem.objects.create(
                code=code, name=name, project=projects[project], org_unit=units[unit],
                parent_subsystem=subsystems.get(parent), status=status,
            )
            for key, level in assigned:
                MemberSubsystem.objects.create(
                    subsystem=subsystem, member=people[key], member_level=level,
                    start_date=today - timedelta(days=40),
                )
            for order, step in steps.items():
                done = order <= steps_done
                SubsystemStepProgress.objects.create(
                    subsystem=subsystem, lifecycle_step=step, is_complete=done,
                    completed_at=timezone.now() - timedelta(days=10 * (steps_done - order + 1)) if done else None,
                    notes="Waiting for the head's validation." if order == steps_done + 1 == 4 else "",
                )

        tasks = {}
        for key, project, subsystem, step, title, status, priority, due, assignees, parent in TASKS:
            tasks[key] = task = Task.objects.create(
                project=projects[project], subsystem=subsystems.get(subsystem), lifecycle_step=steps.get(step),
                parent_task=tasks.get(parent), title=title, priority=priority, scored=False,
                status=T.IN_PROGRESS if status == BLOCKED else status,
                due_date=today + timedelta(days=due), created_by=projects[project].project_manager,
            )
            for i, person in enumerate(assignees):
                TaskAssignee.objects.create(task=task, member=people[person], is_primary=(i == 0))
        owners = {key: assignees[0] for key, *_rest, assignees, _parent in TASKS}
        for task, description, origin, severity, action in BLOCKERS:
            Blocker.objects.create(
                task=tasks[task], description=description, origin=origin, severity=severity, required_action=action,
                reported_by=people[owners[task]], known_since=today - timedelta(days=5),
            )
        for task, author, text in COMMENTS:
            TaskComment.objects.create(task=tasks[task], author=people[author], content=text)
        for task, author, url, label, link_type in LINKS:
            TaskLink.objects.create(task=tasks[task], added_by=people[author], url=url, label=label,
                                    link_type=link_type)
        comments = {task: text for task, _author, text in COMMENTS}
        for recipient, kind, actor, key, hours_ago, read in NOTIFICATIONS:
            task = tasks[key]
            data = {"task": task.title, "project": task.project.name}
            if kind == NotificationKind.TASK_COMMENTED:
                data["excerpt"] = comments[key]
            elif kind == NotificationKind.TASK_ASSIGNED:
                data["primary_id"] = people[recipient].pk
            elif kind == NotificationKind.TASK_OVERDUE:
                data["due_date"] = task.due_date.isoformat()
            notification = Notification.objects.create(
                member=people[recipient], kind=kind, actor=people.get(actor), data=data, is_read=read,
                related_entity_type="task", related_entity_id=task.pk,
            )
            Notification.objects.filter(pk=notification.pk).update(
                created_at=timezone.now() - timedelta(hours=hours_ago)
            )

        purchases = self._create_purchases(people, subsystems)
        stock = self._create_stock(people, tasks)

        self.stdout.write(self.style.SUCCESS(
            f"Demo ready: {len(projects)} projects, {len(subsystems)} subsystems, {len(tasks)} tasks, "
            f"{len(purchases)} purchase requests, {len(stock)} more stock lines, "
            f"{len(people)} fictitious people (@{EMAIL_DOMAIN}). Remove it with: seed_demo --clear"
        ))

    def _create_purchases(self, people, subsystems):
        """Purchase requests at every step, with the history, orders, stock and notifications the
        ERP would have made (apps/purchasing/workflow.py, apps/communication/notify.py)."""
        today = timezone.localdate()
        now = timezone.now()
        suppliers = {
            key: Supplier.objects.create(
                name=DEMO_SUPPLIER + name, type=kind, status=status, city=city, country=country,
                technical_capabilities=capabilities, contact_name="Contact (démo)", email=email,
                contacted_by=people["mehdi"], average_lead_time_days=lead_time,
                comments="Demo data: fictitious supplier.",
            )
            for key, name, kind, status, city, country, capabilities, email, lead_time in SUPPLIERS
        }
        address = ShippingAddress.objects.create(
            country="France", address="[DEMO] 1 rue de l'Exemple, Lyon", contacted_by=people["mehdi"]
        )

        def noon(days_ago):
            """Noon that day (but never later than now: today's noon may still be ahead)."""
            return min(now, timezone.make_aware(datetime.combine(today - timedelta(days=days_ago), time(12, 0))))

        purchases = {}
        for (key, name, category, material, process, quantity, priority, needed, subsystem_code, requester, status,
             asked, order, reason) in PURCHASES:
            subsystem = subsystems[subsystem_code]
            part = Part.objects.create(
                name=name, category=category, material=material, process=process, subsystem=subsystem,
                org_unit=subsystem.org_unit, description=DEMO_PART,
            )
            purchase = purchases[key] = PurchaseRequest.objects.create(
                part=part, requested_by=people[requester], quantity=quantity, priority=priority, status=status,
                requested_date=None if needed is None else today + timedelta(days=needed),
                subsystem=subsystem, org_unit=subsystem.org_unit,
            )
            PurchaseRequest.objects.filter(pk=purchase.pk).update(created_at=noon(asked))
            # The history this status implies: asked, approved by the project manager (Lina) then by
            # Operations (left without a name), ordered and received by Mehdi; or refused by Lina.
            manager = subsystem.project.project_manager
            steps = [(PurchaseAction.REQUESTED, PS.A_VALIDER_CHEF, people[requester], "", asked)]
            if status == PS.ANNULE:
                steps.append((PurchaseAction.REFUSED, PS.ANNULE, manager, reason, asked - 1))
            elif status != PS.A_VALIDER_CHEF:
                steps.append((PurchaseAction.APPROVED, PS.A_VALIDER_OPERATIONS, manager, "", asked))
                if status != PS.A_VALIDER_OPERATIONS:
                    steps.append((PurchaseAction.APPROVED, PS.A_COMMANDER, None, "", max(asked - 1, 0)))
            if order is not None:
                supplier, currency, unit_price, delivery, rate, ordered, expected, delivered = order
                placed = PurchaseOrder.objects.create(
                    purchase_request=purchase, supplier=suppliers[supplier], currency=currency,
                    exchange_rate=Decimal(rate), unit_price=Decimal(unit_price), delivery_cost=Decimal(delivery),
                    ordered_at=today - timedelta(days=ordered), estimated_delivery_date=today + timedelta(days=expected),
                    shipping_address=address if currency != Currency.DZD else None,
                    status=PS.LIVRE if delivered is not None else PS.EN_COMMANDE,
                    actual_delivery_date=None if delivered is None else today - timedelta(days=delivered),
                    quantity_received=purchase.quantity if delivered is not None else 0,
                )
                steps.append((PurchaseAction.ORDERED, PS.EN_COMMANDE, people["mehdi"], "", ordered))
                if delivered is not None:
                    item = StockItem.objects.create(
                        part=part, quantity_available=quantity, location=STOCK_LOCATION, min_threshold=4
                    )
                    StockMovement.objects.create(
                        stock_item=item, movement_type=StockMovementType.IN, quantity=quantity,
                        related_purchase_order=placed, moved_by=people["mehdi"], moved_at=noon(delivered),
                    )
                    steps.append((PurchaseAction.RECEIVED, PS.LIVRE, people["mehdi"], "", delivered))
            for action, reached, actor, comment, days_ago in steps:
                event = PurchaseRequestEvent.objects.create(
                    purchase_request=purchase, action=action, status=reached, actor=actor, comment=comment
                )
                PurchaseRequestEvent.objects.filter(pk=event.pk).update(created_at=noon(days_ago))

        for recipient, kind, actor, key, hours_ago, read in PURCHASE_NOTIFICATIONS:
            purchase = purchases[key]
            requester = purchase.requested_by
            data = {"part": purchase.part.name, "quantity": purchase.quantity,
                    "requester": f"{requester.first_name} {requester.last_name}"}
            if kind == NotificationKind.PURCHASE_APPROVAL_REQUESTED:
                data["level"] = "leader"
            elif kind == NotificationKind.PURCHASE_UPDATED:
                last = purchase.events.order_by("-created_at", "-id").first()
                data.update(action=last.action, status=purchase.status)
                if last.comment:
                    data["reason"] = last.comment
            notification = Notification.objects.create(
                member=people[recipient], kind=kind, actor=people.get(actor), data=data, is_read=read,
                related_entity_type="purchase_request", related_entity_id=purchase.pk,
            )
            Notification.objects.filter(pk=notification.pk).update(created_at=now - timedelta(hours=hours_ago))
        return purchases

    def _create_stock(self, people, tasks):
        """Consumables in stock with their history (entries, exits for the demo tasks, a count); the
        quantity is the sum of the movements, as the ERP keeps it (apps/inventory/movements.py)."""
        now = timezone.now()
        kinds = {"in": StockMovementType.IN, "out": StockMovementType.OUT, "adjustment": StockMovementType.ADJUSTMENT}
        lines = {}
        for key, name, category, reference, place, threshold, moves in STOCK:
            part = Part.objects.create(name=name, category=category, reference=reference, description=DEMO_PART)
            line = lines[key] = StockItem.objects.create(part=part, location=place, min_threshold=threshold)
            for kind, quantity, days_ago, handed_to, task, notes in moves:
                StockMovement.objects.create(
                    stock_item=line, movement_type=kinds[kind], quantity=quantity, moved_by=people["mehdi"],
                    moved_at=now - timedelta(days=days_ago), handed_to=people.get(handed_to),
                    related_task=tasks.get(task), notes=notes,
                )
                line.quantity_available += -quantity if kind == "out" else quantity
            line.save(update_fields=["quantity_available"])
        return lines
