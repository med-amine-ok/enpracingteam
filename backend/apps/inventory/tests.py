from datetime import UTC, datetime, timedelta

from django.core import mail
from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.communication.models import Notification, NotificationKind
from apps.inventory.access import WORKSHOP_ROLE
from apps.inventory.models import StockItem, StockMovement, StockMovementType
from apps.inventory.movements import line_for, record
from apps.members.models import Member, MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.work_fixtures import build_team, person
from apps.purchasing.access import LOGISTICS_ROLE, OPERATIONS_UNIT
from apps.purchasing.models import Part, PartCategory
from apps.tasks.models import Task


class StockMovementDateTests(TestCase):
    """A stock movement keeps the date the parts moved and, separately, when it was entered (bug #9)."""

    def setUp(self):
        self.item = StockItem.objects.create(part=Part.objects.create(name="M8 bolt"), quantity_available=10)
        self.member = Member.objects.create_user(
            email="storekeeper@g.enp.edu.dz", first_name="Store", last_name="Keeper", password=None,
        )

    def test_past_movement_date_is_kept_and_entry_time_is_recorded(self):
        moved = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
        movement = StockMovement.objects.create(
            stock_item=self.item, movement_type=StockMovementType.OUT, quantity=2,
            moved_by=self.member, moved_at=moved,
        )
        movement.refresh_from_db()
        self.assertEqual(movement.moved_at, moved)
        self.assertTrue(StockMovement._meta.get_field("moved_at").editable)  # shown in the admin form
        # Audit trail: when the line was typed into the ERP, set automatically.
        self.assertGreater(movement.created_at, moved)


class StockMovementLabelsTests(TestCase):
    """A movement shows its translated type (Sortie / إخراج), not the raw code ("out")."""

    def test_movement_name_uses_the_translated_type(self):
        from django.utils import translation

        movement = StockMovement(
            movement_type=StockMovementType.OUT, quantity=2, stock_item=StockItem(part=Part(name="M8 bolt")),
        )
        for language in ("fr", "ar", "en"):
            with translation.override(language):
                self.assertEqual(str(movement), f"{StockMovementType.OUT.label} 2 - M8 bolt")
                self.assertFalse(str(movement).startswith("out "), str(movement))  # not the raw code


def build_stock():
    """build_team() (apps/projects/work_fixtures.py) plus the stock managers and a few stock lines.

    Operations & Partnerships: `ops_head` heads it, `coordinator` is a logistics coordinator,
    `junior` a junior member (not a stock manager). `workshop` is the Manufacturing & Workshop Lead.
    Lines: 20 M8 bolts at "Workshop A3" (threshold 5), 2 heat-shrink rolls at "Cabinet E1" (threshold 2,
    so low), 0 cells at "Cabinet E1".
    """
    t = build_team()
    t.operations = OrgUnit.objects.create(
        code=OPERATIONS_UNIT, name="Operations & Partnerships", type=OrgUnitType.CLUB_DEPARTMENT
    )
    head_role = Role.objects.create(
        code="t-operations-lead", name="Operations Lead", role_type=MemberRoleType.HEAD_OF_DEPARTMENT,
        scope=RoleScope.CLUB, is_leadership=True,
    )
    logistics = Role.objects.create(
        code=LOGISTICS_ROLE, name="Logistics Coordinator", role_type=MemberRoleType.MEMBER, scope=RoleScope.CLUB
    )
    member_role = Role.objects.create(
        code="t-club-member", name="Member", role_type=MemberRoleType.MEMBER, scope=RoleScope.CLUB
    )
    workshop_role = Role.objects.create(
        code=WORKSHOP_ROLE, name="Manufacturing & Workshop Lead", role_type=MemberRoleType.ADMIN,
        scope=RoleScope.FS_TEAM, is_leadership=True,
    )
    t.ops_head, t.coordinator, t.junior, t.workshop = (
        person("opshead"), person("coordinator"), person("junior"), person("workshop")
    )
    Membership.objects.create(member=t.ops_head, org_unit=t.operations, role=head_role)
    Membership.objects.create(member=t.coordinator, org_unit=t.operations, role=logistics, member_level="main")
    Membership.objects.create(member=t.junior, org_unit=t.operations, role=member_role, member_level="junior")
    Membership.objects.create(member=t.workshop, org_unit=t.fs_team, role=workshop_role)

    t.bolts = StockItem.objects.create(
        part=Part.objects.create(name="M8 bolt", reference="ISO-4017", category=PartCategory.WORKSHOP),
        location="Workshop A3", min_threshold=5,
    )
    t.shrink = StockItem.objects.create(
        part=Part.objects.create(name="Heat-shrink sleeve", category=PartCategory.LOW_VOLTAGE),
        location="Cabinet E1", min_threshold=2,
    )
    t.cells = StockItem.objects.create(
        part=Part.objects.create(name="Li-ion cells", category=PartCategory.ENGINE_TRACTIVE), location="Cabinet E1"
    )
    record(t.bolts, StockMovementType.IN, 20, by=t.coordinator)
    record(t.shrink, StockMovementType.IN, 2, by=t.coordinator)
    t.task = Task.objects.create(project=t.ev, subsystem=t.battery, title="Wire the BMS")
    return t


class StockApiTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_stock()

    def as_member(self, member):
        self.client.force_authenticate(member)

    def act(self, item, verb, member, **data):
        self.as_member(member)
        return self.client.post(f"/api/inventory/items/{item.id}/{verb}/", data, format="json")

    def done(self, item, verb, member, **data):
        response = self.act(item, verb, member, **data)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def quantity(self, item):
        return StockItem.objects.get(pk=item.pk).quantity_available

    def assert_quantity_is_sum_of_movements(self, item):
        total = sum(
            -movement.quantity if movement.movement_type == StockMovementType.OUT else movement.quantity
            for movement in StockMovement.objects.filter(stock_item=item)
        )
        self.assertEqual(self.quantity(item), total)


class StockReadingTests(StockApiTestCase):
    """Every member sees the stock: low lines first."""

    def names(self, query=""):
        response = self.client.get(f"/api/inventory/items/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return [(item["part"]["name"], item["location"]) for item in response.json()["results"]]

    def test_needs_login(self):
        self.assertEqual(self.client.get("/api/inventory/items/").status_code, 401)

    def test_every_member_sees_the_lines_low_ones_first(self):
        self.as_member(self.t.outsider)
        self.assertEqual(self.names(), [
            ("Heat-shrink sleeve", "Cabinet E1"), ("Li-ion cells", "Cabinet E1"), ("M8 bolt", "Workshop A3"),
        ])
        bolts = self.client.get(f"/api/inventory/items/{self.t.bolts.id}/").json()
        self.assertEqual(
            (bolts["quantity_available"], bolts["min_threshold"], bolts["is_low"], bolts["part"]["reference"]),
            (20, 5, False, "ISO-4017"),
        )
        self.assertIsNotNone(bolts["last_moved_at"])
        self.assertEqual([(m["movement_type"], m["change"]) for m in bolts["movements"]], [("in", 20)])

    def test_filters(self):
        self.as_member(self.t.outsider)
        self.assertEqual(self.names("?low=true"), [("Heat-shrink sleeve", "Cabinet E1"), ("Li-ion cells", "Cabinet E1")])
        self.assertEqual(self.names("?search=iso"), [("M8 bolt", "Workshop A3")])
        self.assertEqual(self.names("?search=cabinet"), [("Heat-shrink sleeve", "Cabinet E1"), ("Li-ion cells", "Cabinet E1")])
        self.assertEqual(self.names("?category=workshop"), [("M8 bolt", "Workshop A3")])
        self.assertEqual(self.names(f"?part={self.t.cells.part_id}"), [("Li-ion cells", "Cabinet E1")])
        self.assertEqual(self.client.get("/api/inventory/items/?part=abc").status_code, 400)

    def test_summary_and_who_manages(self):
        expected = {
            self.t.coordinator: True, self.t.ops_head: True, self.t.workshop: True, self.t.admin: True,
            self.t.junior: False, self.t.lead: False, self.t.engineer: False, self.t.manager: False,
        }
        for member, manages in expected.items():
            self.as_member(member)
            summary = self.client.get("/api/inventory/items/summary/").json()
            self.assertEqual(summary, {"lines": 3, "low": 2, "can_manage": manages}, member.first_name)

    def test_the_list_costs_the_same_queries_for_3_or_20_lines(self):
        self.as_member(self.t.outsider)

        def queries():
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.client.get("/api/inventory/items/").status_code, 200)
            return len(captured)

        few = queries()
        for number in range(17):
            line = StockItem.objects.create(part=Part.objects.create(name=f"Part {number}"), location="Shelf")
            record(line, StockMovementType.IN, 3, by=self.t.coordinator)
        self.assertEqual(queries(), few)


class StockManagingTests(StockApiTestCase):
    """The stock managers (Operations, the workshop lead, admins) create lines and change them."""

    def create(self, member, **data):
        self.as_member(member)
        return self.client.post("/api/inventory/items/", data, format="json")

    def test_managers_create_a_line_with_the_stock_already_there(self):
        part = Part.objects.create(name="Brake pad")
        for member in (self.t.junior, self.t.engineer, self.t.lead):
            self.assertEqual(self.create(member, part_id=part.id, location="Shelf B").status_code, 403, member.first_name)
        response = self.create(self.t.workshop, part_id=part.id, location="  Shelf   B ", min_threshold=4, initial_quantity=6)
        self.assertEqual(response.status_code, 201, response.content)
        line = response.json()
        self.assertEqual((line["location"], line["quantity_available"], line["min_threshold"]), ("Shelf B", 6, 4))
        self.assertEqual([(m["movement_type"], m["quantity"], m["moved_by"]["id"]) for m in line["movements"]],
                         [("in", 6, self.t.workshop.id)])
        self.assertTrue(line["movements"][0]["notes"])  # "stock already there…"
        # One line per part and place.
        self.assertEqual(self.create(self.t.coordinator, part_id=part.id, location="Shelf B").status_code, 400)

    def test_a_line_for_a_new_part(self):
        response = self.create(self.t.coordinator, new_part={"name": "Zip ties", "category": "workshop"}, location="Workshop A1")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual((response.json()["part"]["name"], response.json()["quantity_available"]), ("Zip ties", 0))
        self.assertEqual(self.create(self.t.coordinator, location="X").status_code, 400)  # no part at all

    def test_managers_change_the_place_and_the_threshold(self):
        self.as_member(self.t.engineer)
        url = f"/api/inventory/items/{self.t.bolts.id}/"
        self.assertEqual(self.client.patch(url, {"location": "Elsewhere"}, format="json").status_code, 403)
        self.as_member(self.t.ops_head)
        changed = self.client.patch(url, {"location": "Workshop B1", "min_threshold": 8}, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual((changed.json()["location"], changed.json()["min_threshold"]), ("Workshop B1", 8))
        self.assertEqual(self.client.patch(url, {"min_threshold": -1}, format="json").status_code, 400)

    def test_a_higher_threshold_that_makes_a_line_low_tells_the_managers(self):
        self.as_member(self.t.ops_head)
        self.client.patch(f"/api/inventory/items/{self.t.bolts.id}/", {"min_threshold": 25}, format="json")
        told = set(Notification.objects.filter(kind=NotificationKind.STOCK_LOW).values_list("member_id", flat=True))
        self.assertEqual(told, {self.t.coordinator.id, self.t.workshop.id})  # never the one who acted


class StockMovementTests(StockApiTestCase):
    """Exits (storekeeper), manual entries and counts: the quantity always follows the movements."""

    def test_managers_take_parts_out_for_a_task_handed_to_a_member(self):
        for member in (self.t.engineer, self.t.junior, self.t.lead):
            self.assertEqual(self.act(self.t.bolts, "take", member, quantity=1).status_code, 403, member.first_name)
        line = self.done(
            self.t.bolts, "take", self.t.coordinator, quantity=8, task_id=self.t.task.id,
            handed_to_id=self.t.engineer.id, notes="For the BMS box",
        )
        self.assertEqual(line["quantity_available"], 12)
        taken = line["movements"][0]
        self.assertEqual(
            (taken["movement_type"], taken["quantity"], taken["change"], taken["task"], taken["handed_to"]["id"]),
            ("out", 8, -8, {"id": self.t.task.id, "title": "Wire the BMS"}, self.t.engineer.id),
        )
        self.assertEqual(taken["moved_by"]["id"], self.t.coordinator.id)
        self.assert_quantity_is_sum_of_movements(self.t.bolts)

    def test_never_more_than_what_is_in_stock(self):
        refused = self.act(self.t.bolts, "take", self.t.coordinator, quantity=21)
        self.assertEqual(refused.status_code, 400)
        self.assertIn("20", refused.json()["quantity"][0])
        self.assertEqual(self.quantity(self.t.bolts), 20)
        self.assertEqual(StockMovement.objects.filter(stock_item=self.t.bolts).count(), 1)
        self.assertEqual(self.act(self.t.bolts, "take", self.t.coordinator, quantity=0).status_code, 400)

    def test_a_movement_is_not_in_the_future(self):
        later = (timezone.now() + timedelta(hours=2)).isoformat()
        self.assertEqual(self.act(self.t.bolts, "take", self.t.coordinator, quantity=1, moved_at=later).status_code, 400)
        earlier = timezone.now() - timedelta(days=3)
        self.done(self.t.bolts, "take", self.t.coordinator, quantity=1, moved_at=earlier.isoformat())
        self.assertEqual(StockMovement.objects.filter(movement_type="out").get().moved_at, earlier)

    def test_manual_entries_say_where_the_parts_come_from(self):
        self.assertEqual(self.act(self.t.cells, "add", self.t.workshop, quantity=10).status_code, 400)  # no notes
        line = self.done(self.t.cells, "add", self.t.workshop, quantity=10, notes="Gift from a sponsor")
        self.assertEqual((line["quantity_available"], line["movements"][0]["notes"]), (10, "Gift from a sponsor"))
        self.assertEqual(self.act(self.t.cells, "add", self.t.engineer, quantity=1, notes="x").status_code, 403)

    def test_a_count_becomes_an_adjustment(self):
        self.assertEqual(self.act(self.t.bolts, "count", self.t.ops_head, counted=17).status_code, 400)  # no notes
        same = self.act(self.t.bolts, "count", self.t.ops_head, counted=20, notes="Counted")
        self.assertEqual(same.status_code, 400)
        line = self.done(self.t.bolts, "count", self.t.ops_head, counted=17, notes="3 lost in the workshop")
        adjusted = line["movements"][0]
        self.assertEqual((line["quantity_available"], adjusted["movement_type"], adjusted["quantity"], adjusted["change"]),
                         (17, "adjustment", -3, -3))
        self.done(self.t.bolts, "count", self.t.ops_head, counted=19, notes="2 found in a drawer")
        self.assert_quantity_is_sum_of_movements(self.t.bolts)

    def test_crossing_the_threshold_tells_the_managers_once(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.done(self.t.bolts, "take", self.t.coordinator, quantity=10)  # 10 left, threshold 5: fine
        self.assertFalse(Notification.objects.filter(kind=NotificationKind.STOCK_LOW).exists())
        with self.captureOnCommitCallbacks(execute=True):
            self.done(self.t.bolts, "take", self.t.coordinator, quantity=5)  # 5 left: at the threshold
        told = Notification.objects.filter(kind=NotificationKind.STOCK_LOW)
        self.assertEqual(set(told.values_list("member_id", flat=True)), {self.t.ops_head.id, self.t.workshop.id})
        self.assertEqual(told.first().data, {"part": "M8 bolt", "location": "Workshop A3", "quantity": 5, "threshold": 5})
        self.assertEqual((told.first().related_entity_type, told.first().related_entity_id), ("stock_item", self.t.bolts.id))
        self.assertEqual(sorted(message.to[0] for message in mail.outbox),
                         ["opshead@example.invalid", "workshop@example.invalid"])
        self.assertIn(f"/stock/{self.t.bolts.id}", mail.outbox[0].body)
        self.done(self.t.bolts, "take", self.t.coordinator, quantity=1)  # still low: no new notification
        self.assertEqual(Notification.objects.filter(kind=NotificationKind.STOCK_LOW).count(), 2)

    def test_the_journal(self):
        self.done(self.t.bolts, "take", self.t.coordinator, quantity=2, task_id=self.t.task.id, handed_to_id=self.t.engineer.id)
        self.done(self.t.cells, "add", self.t.workshop, quantity=3, notes="Recovered")
        self.as_member(self.t.engineer)

        def journal(query=""):
            response = self.client.get(f"/api/inventory/movements/{query}")
            self.assertEqual(response.status_code, 200, response.content)
            return [(m["stock_item"]["part"], m["movement_type"], m["quantity"]) for m in response.json()["results"]]

        self.assertEqual(journal()[:2], [("Li-ion cells", "in", 3), ("M8 bolt", "out", 2)])
        self.assertEqual(journal(f"?task={self.t.task.id}"), [("M8 bolt", "out", 2)])
        self.assertEqual(journal("?mine=true"), [("M8 bolt", "out", 2)])  # handed to the engineer
        self.assertEqual(journal(f"?item={self.t.cells.id}&type=in"), [("Li-ion cells", "in", 3)])


class StockRecordTests(TestCase):
    """record(): the one way to change a quantity (the API and the purchasing module use it)."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_stock()

    def test_a_line_per_part_and_place(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            StockItem.objects.create(part=self.t.bolts.part, location="Workshop A3")

    def test_parts_go_to_the_line_of_their_place(self):
        part = self.t.bolts.part
        self.assertEqual(line_for(part), self.t.bolts)  # no place given: its first line
        self.assertEqual(line_for(part, "  Workshop   A3 "), self.t.bolts)
        other = line_for(part, "Container")
        self.assertNotEqual(other, self.t.bolts)
        self.assertEqual((other.location, other.quantity_available), ("Container", 0))
        fresh = line_for(Part.objects.create(name="Washer"))
        self.assertEqual((fresh.location, fresh.quantity_available), ("", 0))

    def test_the_admin_shows_the_movements_without_changing_them(self):
        from django.contrib import admin
        from django.test import RequestFactory

        request = RequestFactory().get("/admin/")
        request.user = self.t.admin
        movement_admin = admin.site._registry[StockMovement]
        self.assertFalse(movement_admin.has_add_permission(request))
        self.assertFalse(movement_admin.has_change_permission(request))
        self.assertIn("quantity_available", admin.site._registry[StockItem].get_readonly_fields(request))
