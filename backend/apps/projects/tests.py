from io import StringIO

from django.core.management import call_command
from django.db.models import F
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APITestCase

from apps.communication.models import Notification
from apps.inventory.models import StockItem, StockMovement, StockMovementType
from apps.members.models import Member, Membership, OrgUnit, OrgUnitType
from apps.projects.models import Project, ProjectCategory, ProjectStatus
from apps.projects.work_fixtures import build_team
from apps.purchasing.models import (
    Part, PurchaseOrder, PurchaseRequest, PurchaseRequestEvent, PurchaseStatus, ShippingAddress, Supplier,
)
from apps.subsystems.models import LifecycleStep, MemberSubsystem, Subsystem, SubsystemStepProgress
from apps.tasks.models import Blocker, Task, TaskAssignee, TaskStatus

DEMO_EMAIL_DOMAIN = "@example.invalid"


def run_demo(*args):
    call_command("seed_demo", *args, stdout=StringIO())


def demo_projects():
    return Project.objects.filter(code__startswith="demo-")


def demo_tasks():
    return Task.objects.filter(project__code__startswith="demo-")


@override_settings(DEBUG=True)
class SeedDemoTests(TestCase):
    """seed_demo: realistic projects, subsystems and tasks to try the ERP, with fictitious people only."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_all", stdout=StringIO())

    def test_creates_projects_subsystems_and_tasks(self):
        run_demo()
        self.assertEqual(
            set(demo_projects().values_list("category", flat=True)),
            {ProjectCategory.EV, ProjectCategory.IC, ProjectCategory.CLUB},
        )
        demo_subsystems = Subsystem.objects.filter(code__startswith="demo-")
        self.assertTrue(demo_subsystems.filter(parent_subsystem__isnull=False).exists())
        self.assertTrue(
            SubsystemStepProgress.objects.filter(subsystem__in=demo_subsystems, is_complete=True).exists()
        )
        self.assertGreaterEqual(demo_tasks().count(), 10)
        self.assertEqual(set(demo_tasks().values_list("status", flat=True)), set(TaskStatus.values))
        self.assertTrue(demo_tasks().filter(parent_task__isnull=False).exists())

    def test_follows_the_data_rules(self):
        run_demo()
        # Subsystems belong to technical (fs_department) units only.
        self.assertFalse(
            Subsystem.objects.filter(code__startswith="demo-")
            .exclude(org_unit__type=OrgUnitType.FS_DEPARTMENT).exists()
        )
        for task in demo_tasks():
            task.full_clean()  # e.g. a subtask belongs to the same project as its parent
            self.assertEqual(task.assignees.filter(is_primary=True).count(), 1, task)

    def test_uses_only_fictitious_people(self):
        real_ids = set(Member.objects.values_list("id", flat=True))
        run_demo()
        people = Member.objects.exclude(id__in=real_ids)
        self.assertTrue(people.exists())
        self.assertFalse(people.exclude(email__endswith=DEMO_EMAIL_DOMAIN).exists())

        # Everyone the demo refers to is one of these fictitious people.
        referenced = set(TaskAssignee.objects.filter(task__in=demo_tasks()).values_list("member_id", flat=True))
        referenced |= set(demo_tasks().values_list("created_by_id", flat=True))
        referenced |= set(demo_projects().values_list("project_manager_id", flat=True))
        referenced |= set(
            MemberSubsystem.objects.filter(subsystem__code__startswith="demo-").values_list("member_id", flat=True)
        )
        referenced |= set(PurchaseRequest.objects.values_list("requested_by_id", flat=True))
        referenced |= set(PurchaseRequestEvent.objects.values_list("actor_id", flat=True))
        referenced |= set(StockMovement.objects.values_list("moved_by_id", flat=True))
        referenced |= set(Supplier.objects.values_list("contacted_by_id", flat=True))
        referenced.discard(None)
        self.assertTrue(referenced)
        self.assertLessEqual(referenced, set(people.values_list("id", flat=True)))

        # No leadership role: the Executive Bureau is left untouched.
        self.assertFalse(Membership.objects.filter(member__in=people, role__is_leadership=True).exists())
        self.assertFalse(Membership.objects.filter(member__in=people, org_unit__code="executive-bureau").exists())

    def test_running_it_again_replaces_the_demo(self):
        def counts():
            return (Project.objects.count(), Subsystem.objects.count(), Task.objects.count(),
                    Member.objects.count(), Membership.objects.count())

        run_demo()
        first = counts()
        run_demo()
        self.assertEqual(counts(), first)

    def test_gives_the_fictitious_people_a_few_notifications(self):
        run_demo()
        lina = Member.objects.get(email="lina.demo" + DEMO_EMAIL_DOMAIN)
        self.assertTrue(Notification.objects.filter(member=lina, is_read=False).exists())
        self.assertFalse(Notification.objects.exclude(member__email__endswith=DEMO_EMAIL_DOMAIN).exists())
        first = Notification.objects.count()
        run_demo()
        self.assertEqual(Notification.objects.count(), first)  # replaced, not added
        run_demo("--clear")
        self.assertFalse(Notification.objects.exists())

    def test_gives_purchases_at_every_step(self):
        run_demo()
        purchases = PurchaseRequest.objects.all()
        self.assertEqual(set(purchases.values_list("status", flat=True)), set(PurchaseStatus.values))
        for purchase in purchases:
            # The history ends where the request is, and the unit is the subsystem's.
            self.assertEqual(purchase.events.order_by("created_at", "id").last().status, purchase.status, purchase)
            self.assertEqual(purchase.org_unit, purchase.subsystem.org_unit, purchase)
        delivered = purchases.get(status=PurchaseStatus.LIVRE)
        order = delivered.orders.get()
        self.assertEqual((order.currency, order.total_price_dzd), ("EUR", 38750))  # (10 × 12.50 + 30) × 250
        item = StockItem.objects.get(part=delivered.part)
        self.assertEqual(item.quantity_available, delivered.quantity)
        self.assertEqual(item.movements.get().related_purchase_order, order)
        self.assertEqual(item.movements.get().movement_type, StockMovementType.IN)
        # The stock: every quantity is the sum of its movements, and one line is low.
        for item in StockItem.objects.all():
            total = sum(
                -movement.quantity if movement.movement_type == StockMovementType.OUT else movement.quantity
                for movement in item.movements.all()
            )
            self.assertEqual(item.quantity_available, total, item)
        self.assertTrue(StockItem.objects.filter(quantity_available__lte=F("min_threshold")).exists())
        self.assertTrue(StockMovement.objects.filter(movement_type=StockMovementType.OUT, related_task__isnull=False).exists())
        # Fictitious suppliers only.
        self.assertTrue(Supplier.objects.exists())
        self.assertFalse(Supplier.objects.exclude(name__startswith="[DEMO] ").exists())
        self.assertFalse(Supplier.objects.exclude(email__endswith=DEMO_EMAIL_DOMAIN).exists())

    def test_running_it_again_or_clearing_it_handles_the_purchases(self):
        def counts():
            return [model.objects.count() for model in (
                PurchaseRequest, PurchaseRequestEvent, PurchaseOrder, Supplier, Part, ShippingAddress, StockItem,
                StockMovement,
            )]

        run_demo()
        first = counts()
        run_demo()
        self.assertEqual(counts(), first)
        # A real supplier a demo person contacted stays, without that name.
        mehdi = Member.objects.get(email="mehdi.demo" + DEMO_EMAIL_DOMAIN)
        real = Supplier.objects.create(name="Real supplier", contacted_by=mehdi)
        run_demo("--clear")
        self.assertEqual(counts(), [0, 0, 0, 1, 0, 0, 0, 0])
        real.refresh_from_db()
        self.assertIsNone(real.contacted_by)

    def test_clear_removes_only_the_demo(self):
        real_project = Project.objects.create(
            name="Real project", category=ProjectCategory.EV,
            org_unit=OrgUnit.objects.get(code="fs-team"), status=ProjectStatus.ACTIVE,
        )
        real_task = Task.objects.create(project=real_project, title="Real task")
        members, memberships = Member.objects.count(), Membership.objects.count()

        run_demo()
        run_demo("--clear")

        self.assertFalse(demo_projects().exists())
        self.assertFalse(Subsystem.objects.filter(code__startswith="demo-").exists())
        self.assertFalse(Member.objects.filter(email__endswith=DEMO_EMAIL_DOMAIN).exists())
        self.assertEqual((Member.objects.count(), Membership.objects.count()), (members, memberships))
        self.assertTrue(Task.objects.filter(pk=real_task.pk).exists())
        self.assertTrue(LifecycleStep.objects.exists())  # reference data, not demo

    @override_settings(DEBUG=False)
    def test_refuses_to_run_outside_development(self):
        with self.assertRaisesMessage(CommandError, "DEBUG"):
            run_demo()
        self.assertFalse(demo_projects().exists())


@override_settings(DEBUG=True)
class SeedDemoPrerequisitesTests(TestCase):
    def test_asks_for_seed_all_first(self):
        with self.assertRaisesMessage(CommandError, "seed_all"):
            run_demo()


class ProjectApiTests(APITestCase):
    """/api/projects/: every member sees every project; the rules of apps/projects/access.py decide
    who changes what."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        for title, status in (("Done", TaskStatus.VALIDATED), ("Blocked", TaskStatus.IN_PROGRESS), ("To do", TaskStatus.PLANNED)):
            task = Task.objects.create(project=cls.t.ev, title=title, status=status)
            if title == "Blocked":
                Blocker.objects.create(task=task, description="Waiting for the supplier")

    def as_member(self, member):
        self.client.force_authenticate(member)

    def names(self, query=""):
        return [project["name"] for project in self.client.get(f"/api/projects/{query}").json()["results"]]

    def test_needs_login(self):
        self.assertEqual(self.client.get("/api/projects/").status_code, 401)

    def test_every_member_sees_every_project_with_its_figures(self):
        self.as_member(self.t.outsider)
        results = self.client.get("/api/projects/").json()["results"]
        self.assertEqual([project["name"] for project in results], ["EV Test", "IC Test"])  # active first
        ev = results[0]
        self.assertEqual(
            (ev["tasks_total"], ev["tasks_done"], ev["tasks_blocked"], ev["subsystems_count"]), (3, 1, 1, 1)
        )
        self.assertEqual(ev["org_unit"], {"id": self.t.fs_team.id, "code": "t-fs-team", "name": "FS Team",
                                          "type": "fs_team"})
        # The manager is shown by name only: never contact details.
        self.assertEqual(
            ev["project_manager"], {"id": self.t.manager.id, "first_name": "Manager", "last_name": "Test"}
        )

    def test_a_project_may_have_no_manager(self):
        """The API then sends null: the schema, and so the frontend types, must say so."""
        self.as_member(self.t.outsider)
        self.assertIsNone(self.client.get(f"/api/projects/{self.t.ic.id}/").json()["project_manager"])
        schemas = SchemaGenerator().get_schema(request=None, public=True)["components"]["schemas"]
        for schema in ("Project", "ProjectDetail"):
            self.assertIs(schemas[schema]["properties"]["project_manager"].get("nullable"), True, schema)

    def test_says_what_each_person_may_do(self):
        expected = {
            self.t.admin: {"edit": True, "create_task": True, "estimate_tasks": True},
            self.t.manager: {"edit": True, "create_task": True, "estimate_tasks": True},
            self.t.teammate: {"edit": False, "create_task": True, "estimate_tasks": False},  # in the project's team
            self.t.engineer: {"edit": False, "create_task": True, "estimate_tasks": False},  # in one of its subsystems
            # Leads the unit of one of its subsystems: estimates the tasks of that subsystem only (its permissions).
            self.t.lead: {"edit": False, "create_task": True, "estimate_tasks": False},
            self.t.outsider: {"edit": False, "create_task": False, "estimate_tasks": False},
        }
        for member, permissions in expected.items():
            self.as_member(member)
            ev = self.client.get(f"/api/projects/{self.t.ev.id}/").json()
            self.assertEqual(ev["permissions"], permissions, member.first_name)

    def test_filters(self):
        self.as_member(self.t.teammate)
        self.assertEqual(self.names("?mine=true"), ["EV Test"])
        self.assertEqual(self.names("?status=planned"), ["IC Test"])
        self.assertEqual(self.names("?category=ev"), ["EV Test"])
        self.as_member(self.t.outsider)
        self.assertEqual(self.names("?mine=true"), [])

    def test_detail_shows_the_current_team(self):
        self.as_member(self.t.outsider)
        team = self.client.get(f"/api/projects/{self.t.ev.id}/").json()["team"]
        self.assertEqual([row["member"]["first_name"] for row in team], ["Teammate"])

    def test_only_club_admins_create_projects(self):
        data = {"name": "Club Test", "category": "club_project", "status": "planned", "org_unit_id": self.t.office.id}
        self.as_member(self.t.manager)
        self.assertEqual(self.client.post("/api/projects/", data).status_code, 403)
        self.as_member(self.t.admin)
        response = self.client.post("/api/projects/", data)
        self.assertEqual(response.status_code, 201)
        self.assertEqual((response.json()["name"], response.json()["tasks_total"]), ("Club Test", 0))

    def test_the_manager_changes_the_project_but_not_its_manager_or_unit(self):
        self.as_member(self.t.manager)
        response = self.client.patch(f"/api/projects/{self.t.ev.id}/", {"status": "on_hold"})
        self.assertEqual((response.status_code, response.json()["status"]), (200, "on_hold"))
        for change in ({"project_manager_id": self.t.lead.id}, {"org_unit_id": self.t.office.id}):
            self.assertEqual(self.client.patch(f"/api/projects/{self.t.ev.id}/", change).status_code, 403, change)

    def test_others_cannot_change_a_project(self):
        for member in (self.t.teammate, self.t.lead, self.t.outsider):
            self.as_member(member)
            response = self.client.patch(f"/api/projects/{self.t.ev.id}/", {"status": "completed"})
            self.assertEqual(response.status_code, 403, member.first_name)
        self.t.ev.refresh_from_db()
        self.assertEqual(self.t.ev.status, ProjectStatus.ACTIVE)

    def test_checks_dates_and_who_may_manage_a_project(self):
        self.as_member(self.t.admin)
        url = f"/api/projects/{self.t.ev.id}/"
        response = self.client.patch(url, {"start_date": "2026-10-01", "end_date": "2026-09-01"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("end_date", response.json())
        # The Board names the project managers (charter art. 2 and 6): one without a role that allows it gets the
        # Project Manager role, in the Project Department for the cars' projects (decision D-025).
        department = OrgUnit.objects.create(
            code="dept-projet", name="Project Department", type=OrgUnitType.CLUB_DEPARTMENT
        )
        self.assertEqual(self.client.patch(url, {"project_manager_id": self.t.engineer.id}).status_code, 200)
        given = Membership.objects.get(member=self.t.engineer, org_unit=department, end_date__isnull=True)
        self.assertEqual((given.role.can_be_project_manager, given.is_primary), (True, False))
        self.assertEqual(self.client.patch(url, {"project_manager_id": self.t.manager.id}).status_code, 200)
        self.assertEqual(Membership.objects.filter(member=self.t.manager, org_unit=department).count(), 0)  # had one
