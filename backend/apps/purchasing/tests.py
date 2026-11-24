import tempfile
from datetime import date, datetime, timedelta
from decimal import Decimal
from io import StringIO
from pathlib import Path
from unittest import mock

from django.core import mail
from django.core.management import CommandError, call_command
from django.db import IntegrityError, connection, transaction
from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone, translation
from openpyxl import Workbook
from rest_framework.test import APIClient, APITestCase

from apps.communication.models import Notification, NotificationKind
from apps.inventory.models import StockItem, StockMovement, StockMovementType
from apps.members.models import Member, MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.work_fixtures import build_team, person
from apps.purchasing.access import LOGISTICS_ROLE, OPERATIONS_UNIT
from apps.purchasing.management.commands.import_subcontracting_sheet import (
    CHOSEN_SUPPLIER_COMMENT, CONTACT_HOMONYM, CONTACT_SPELLING, IMPORT_COMMENT, MERGED, NAME_GUESSED, TYPE_GUESSED,
    SheetImport,
    chosen_supplier, guessed_type, normalize, part_category, significant, split_contact, split_reach, to_amount,
    to_day, to_lead_time, to_quantity,
)
from apps.purchasing.models import (
    Currency, Part, PartCategory, PurchaseAction, PurchaseOrder, PurchaseRequest, PurchaseRequestEvent,
    PurchaseStatus, ShippingAddress, Supplier, SupplierStatus, SupplierType,
)


class PurchasingLabelsTests(SimpleTestCase):
    """Purchasing words in French follow the team's subcontracting sheets, and the purchase order
    name (shown in the dropdowns of other apps) is translated."""

    def test_statuses_use_the_team_words_in_french(self):
        with translation.override("fr"):
            self.assertEqual(
                [str(label) for label in PurchaseStatus.labels],
                ["À valider (chef)", "À valider (Opérations)", "À commander", "En commande", "Livré", "Annulé"],
            )
            # Supplier status = state of the request sent to the supplier (la demande: feminine).
            self.assertEqual(str(SupplierStatus.REFUSEE.label), "Refusée")

    def test_purchase_order_name_is_translated(self):
        order = PurchaseOrder(pk=3, supplier=Supplier(name="ACME"))
        names = {}
        for language in ("en", "fr", "ar"):
            with translation.override(language):
                names[language] = str(order)
        self.assertEqual(names["en"], "PO #3 - ACME")
        self.assertEqual(len(set(names.values())), 3, names)
        self.assertTrue(all("3" in name and "ACME" in name for name in names.values()), names)


def build_purchasing():
    """build_team() (apps/projects/work_fixtures.py) plus the Operations & Partnerships department:
    `ops_head` heads it, `coordinator` is a logistics coordinator there. One supplier, one shipping
    address and one part already known (cells for the Battery subsystem)."""
    t = build_team()
    t.operations = OrgUnit.objects.create(
        code=OPERATIONS_UNIT, name="Operations & Partnerships", type=OrgUnitType.CLUB_DEPARTMENT
    )
    head_role = Role.objects.create(
        code="t-operations-lead", name="Operations Lead", role_type=MemberRoleType.HEAD_OF_DEPARTMENT,
        scope=RoleScope.CLUB, is_leadership=True,
    )
    coordinator_role = Role.objects.create(
        code=LOGISTICS_ROLE, name="Logistics Coordinator", role_type=MemberRoleType.MEMBER, scope=RoleScope.CLUB
    )
    t.ops_head = person("opshead")
    t.coordinator = person("coordinator")
    Membership.objects.create(member=t.ops_head, org_unit=t.operations, role=head_role)
    Membership.objects.create(member=t.coordinator, org_unit=t.operations, role=coordinator_role, member_level="main")
    t.supplier = Supplier.objects.create(
        name="Laser Cut Test", type=SupplierType.SOUS_TRAITANT, status=SupplierStatus.VALIDEE, city="Alger",
        country="Algérie", address="1 rue des Tests", contact_name="Contact Test", contact_role="Sales",
        email="sales@example.invalid", phone="+213 21 00 00 00", contacted_by=t.coordinator,
    )
    t.address = ShippingAddress.objects.create(country="France", address="2 avenue des Tests, Paris")
    t.cells = Part.objects.create(
        name="Li-ion cells", category=PartCategory.ENGINE_TRACTIVE, reference="LG-M50",
        subsystem=t.battery, org_unit=t.electronics,
    )
    return t


S = PurchaseStatus
A = PurchaseAction
OMIT = object()  # leaves a default field out of a request body


class PurchasingApiTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_purchasing()
        cls.today = timezone.localdate()

    def as_member(self, member):
        self.client.force_authenticate(member)

    def ask(self, member, **data):
        self.as_member(member)
        body = {"part_id": self.t.cells.id, "quantity": 4, "priority": "high", "subsystem_id": self.t.battery.id, **data}
        body = {key: value for key, value in body.items() if value is not OMIT}
        return self.client.post("/api/purchasing/requests/", body, format="json")

    def asked(self, member=None, **data):
        """The id of a request made through the API (by the engineer, for the Battery subsystem)."""
        response = self.ask(member or self.t.engineer, **data)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["id"]

    def act(self, purchase_id, verb, member, **data):
        self.as_member(member)
        return self.client.post(f"/api/purchasing/requests/{purchase_id}/{verb}/", data, format="json")

    def done(self, purchase_id, verb, member, **data):
        response = self.act(purchase_id, verb, member, **data)
        self.assertIn(response.status_code, (200, 201), response.content)
        return response.json()

    def to_order(self):
        """A request approved by the leader then by the head of Operations."""
        purchase_id = self.asked()
        self.done(purchase_id, "approve", self.t.lead)
        self.done(purchase_id, "approve", self.t.ops_head)
        return purchase_id

    ORDER = {"unit_price": "10.00", "currency": "EUR", "exchange_rate": "250", "delivery_cost": "5", "customs_cost": "2"}

    def ordered(self, **order):
        purchase_id = self.to_order()
        self.done(purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, **{**self.ORDER, **order})
        return purchase_id

    def make(self, name, status=S.A_VALIDER_CHEF, priority=None, needed_in=None, by=None, subsystem="battery", unit=None):
        """A request written straight to the database (for the lists)."""
        subsystem = getattr(self.t, subsystem) if subsystem else None
        return PurchaseRequest.objects.create(
            part=Part.objects.create(name=name), requested_by=by or self.t.engineer, quantity=1, priority=priority,
            requested_date=None if needed_in is None else self.today + timedelta(days=needed_in), status=status,
            subsystem=subsystem, org_unit=subsystem.org_unit if subsystem else unit,
        )

    def detail(self, purchase_id, member=None):
        if member is not None:
            self.as_member(member)
        response = self.client.get(f"/api/purchasing/requests/{purchase_id}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def history(self, purchase_id):
        return [
            (event.action, event.status, event.actor_id)
            for event in PurchaseRequestEvent.objects.filter(purchase_request_id=purchase_id).order_by("id")
        ]


class PurchaseRequestReadingTests(PurchasingApiTestCase):
    """Every member sees every request: open first, the most urgent and the soonest needed first."""

    def names(self, query=""):
        response = self.client.get(f"/api/purchasing/requests/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return [purchase["part"]["name"] for purchase in response.json()["results"]]

    def test_needs_login(self):
        self.assertEqual(self.client.get("/api/purchasing/requests/").status_code, 401)

    def test_open_requests_first_then_by_priority_and_date_needed(self):
        self.make("Bolts", S.A_COMMANDER, "high", needed_in=10)
        self.make("Wire", S.A_VALIDER_CHEF, "high", needed_in=3)
        self.make("Paint", S.EN_COMMANDE, "low")
        self.make("Seat", S.A_VALIDER_OPERATIONS)
        self.make("Old pump", S.LIVRE, "high")
        self.make("Wrong tube", S.ANNULE, "high")
        self.as_member(self.t.outsider)
        self.assertEqual(self.names(), ["Wire", "Bolts", "Paint", "Seat", "Old pump", "Wrong tube"])

    def test_a_listed_request_carries_its_part_unit_order_and_rights(self):
        purchase_id = self.ordered()
        self.as_member(self.t.outsider)
        listed = self.client.get("/api/purchasing/requests/").json()["results"][0]
        self.assertEqual(listed["id"], purchase_id)
        self.assertEqual(listed["part"]["name"], "Li-ion cells")
        self.assertEqual(listed["part"]["reference"], "LG-M50")
        self.assertEqual((listed["quantity"], listed["priority"], listed["status"]), (4, "high", "en_commande"))
        self.assertEqual(listed["requested_by"]["id"], self.t.engineer.id)
        self.assertEqual(listed["org_unit"]["id"], self.t.electronics.id)
        self.assertEqual(listed["subsystem"], {"id": self.t.battery.id, "name": "Battery"})
        self.assertEqual(listed["project"]["id"], self.t.ev.id)
        order = listed["order"]
        self.assertEqual(order["supplier"], {"id": self.t.supplier.id, "name": "Laser Cut Test", "type": "sous_traitant"})
        self.assertEqual((order["currency"], order["total_price"], order["total_price_dzd"]), ("EUR", "47.00", "11750.00"))
        self.assertEqual(listed["permissions"], {
            "edit": False, "approve": False, "cancel": False, "order": False, "manage_order": False, "cancel_order": False,
            "close_order": False,
        })

    def test_filters(self):
        wire = self.make("Wire", S.A_VALIDER_CHEF, needed_in=3)
        self.make("Bolts", S.A_VALIDER_OPERATIONS, by=self.t.teammate)
        self.make("Pump", S.LIVRE)
        self.make("Fins", S.A_VALIDER_CHEF, subsystem="engine", by=self.t.teammate)
        self.as_member(self.t.engineer)
        self.assertEqual(self.names("?status=livre"), ["Pump"])
        self.assertEqual(self.names("?status=livre,a_valider_operations"), ["Bolts", "Pump"])
        self.assertEqual(self.names("?open=true"), ["Wire", "Bolts", "Fins"])
        self.assertEqual(self.names("?mine=true"), ["Wire", "Pump"])
        self.assertEqual(self.names(f"?unit={self.t.aero.id}"), ["Fins"])
        self.assertEqual(self.names(f"?project={self.t.ic.id}"), ["Fins"])
        self.assertEqual(self.names(f"?subsystem={self.t.battery.id}"), ["Wire", "Bolts", "Pump"])
        self.assertEqual(self.names("?search=WIR"), ["Wire"])
        self.assertEqual(self.client.get("/api/purchasing/requests/?unit=abc").status_code, 400)
        # Awaiting my approval: the leader of Electronics, the project manager of EV, the head of Operations.
        self.assertEqual(self.names("?to_approve=true"), [])
        self.as_member(self.t.lead)
        self.assertEqual(self.names("?to_approve=true"), ["Wire"])
        self.as_member(self.t.manager)
        self.assertEqual(self.names("?to_approve=true"), ["Wire"])
        self.as_member(self.t.ops_head)
        self.assertEqual(self.names("?to_approve=true"), ["Bolts"])
        self.as_member(self.t.admin)
        self.assertEqual(self.names("?to_approve=true"), ["Wire", "Bolts", "Fins"])
        self.assertEqual(wire.status, S.A_VALIDER_CHEF)

    def test_the_list_costs_the_same_queries_for_2_or_20_requests(self):
        self.ordered()
        self.make("Wire")

        def queries():
            self.as_member(self.t.lead)
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.client.get("/api/purchasing/requests/").status_code, 200)
            return len(captured)

        few = queries()
        for number in range(9):
            self.make(f"Part {number}", subsystem="engine")
            self.ordered()
        self.assertEqual(queries(), few)

    def test_detail_shows_the_history_and_the_notes(self):
        purchase_id = self.asked(notes="For the second pack")
        self.done(purchase_id, "approve", self.t.lead, comment="OK for me")
        detail = self.detail(purchase_id, self.t.outsider)
        self.assertEqual(detail["notes"], "For the second pack")
        self.assertEqual(
            [(event["action"], event["status"], event["actor"]["id"], event["comment"]) for event in detail["events"]],
            [("requested", "a_valider_chef", self.t.engineer.id, ""), ("approved", "a_valider_operations", self.t.lead.id, "OK for me")],
        )

    def test_summary_counts_the_steps_my_approvals_and_my_open_requests(self):
        self.make("Wire", S.A_VALIDER_CHEF)
        self.make("Bolts", S.A_VALIDER_OPERATIONS)
        self.make("Pump", S.LIVRE)
        self.make("Fins", S.A_COMMANDER, subsystem="engine", by=self.t.teammate)
        self.as_member(self.t.engineer)
        summary = self.client.get("/api/purchasing/requests/summary/").json()
        self.assertEqual(summary["by_status"], {
            "a_valider_chef": 1, "a_valider_operations": 1, "a_commander": 1, "en_commande": 0, "livre": 1, "annule": 0,
        })
        self.assertEqual((summary["to_approve"], summary["mine"], summary["can_manage"]), (0, 2, False))
        self.as_member(self.t.lead)
        self.assertEqual(self.client.get("/api/purchasing/requests/summary/").json()["to_approve"], 1)
        self.as_member(self.t.coordinator)
        self.assertTrue(self.client.get("/api/purchasing/requests/summary/").json()["can_manage"])


class PurchaseRequestAskingTests(PurchasingApiTestCase):
    """A request is made for a unit (and maybe a subsystem) by someone involved there."""

    def test_people_involved_in_the_subsystem_ask_for_parts(self):
        response = self.ask(self.t.engineer, notes="Second pack", requested_date=str(self.today + timedelta(days=20)))
        self.assertEqual(response.status_code, 201, response.content)
        purchase = response.json()
        self.assertEqual((purchase["status"], purchase["org_unit"]["id"]), ("a_valider_chef", self.t.electronics.id))
        self.assertEqual(purchase["requested_by"]["id"], self.t.engineer.id)
        self.assertEqual(self.history(purchase["id"]), [(A.REQUESTED, S.A_VALIDER_CHEF, self.t.engineer.id)])
        self.assertEqual(purchase["permissions"], {
            "edit": True, "approve": False, "cancel": True, "order": False, "manage_order": False, "cancel_order": False,
            "close_order": False,
        })
        # In the project's team: allowed; working elsewhere: refused.
        self.assertEqual(self.ask(self.t.teammate).status_code, 201)
        refused = self.ask(self.t.outsider)
        self.assertEqual(refused.status_code, 403)
        self.assertIn("unité", refused.json()["detail"])  # French by default

    def test_members_ask_for_their_unit_and_the_units_above_it(self):
        mine = {"subsystem_id": None, "org_unit_id": self.t.aero.id}
        self.assertEqual(self.ask(self.t.outsider, **mine).status_code, 201)
        self.assertEqual(self.ask(self.t.outsider, subsystem_id=None, org_unit_id=self.t.fs_team.id).status_code, 201)
        self.assertEqual(self.ask(self.t.outsider, subsystem_id=None, org_unit_id=self.t.electronics.id).status_code, 403)
        # Operations ask for any unit.
        self.assertEqual(self.ask(self.t.coordinator, subsystem_id=None, org_unit_id=self.t.electronics.id).status_code, 201)

    def test_a_known_part_or_a_new_one(self):
        both = self.ask(self.t.engineer, new_part={"name": "Busbar"})
        self.assertEqual(both.status_code, 400)
        self.assertIn("part_id", both.json())
        neither = self.client.post("/api/purchasing/requests/", {"quantity": 1, "subsystem_id": self.t.battery.id}, format="json")
        self.assertEqual(neither.status_code, 400)
        new = self.ask(self.t.engineer, part_id=OMIT, new_part={
            "name": "Copper busbar", "category": "low_voltage", "material": "Copper", "process": "Découpe laser",
        })
        self.assertEqual(new.status_code, 201, new.content)
        part = Part.objects.get(name="Copper busbar")
        self.assertEqual((part.material, part.subsystem, part.org_unit), ("Copper", self.t.battery, self.t.electronics))

    def test_the_unit_is_the_subsystems_and_one_of_them_is_needed(self):
        purchase = self.ask(self.t.engineer, org_unit_id=self.t.aero.id).json()
        self.assertEqual(purchase["org_unit"]["id"], self.t.electronics.id)
        nowhere = self.ask(self.t.engineer, subsystem_id=None)
        self.assertEqual(nowhere.status_code, 400)
        self.assertIn("org_unit_id", nowhere.json())

    def test_a_quantity_is_positive(self):
        self.assertEqual(self.ask(self.t.engineer, quantity=0).status_code, 400)

    def test_the_request_is_changed_only_while_it_awaits_its_leader(self):
        purchase_id = self.asked()
        self.as_member(self.t.engineer)
        changed = self.client.patch(f"/api/purchasing/requests/{purchase_id}/", {"quantity": 6}, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(changed.json()["quantity"], 6)
        self.as_member(self.t.outsider)
        self.assertEqual(self.client.patch(f"/api/purchasing/requests/{purchase_id}/", {"quantity": 1}, format="json").status_code, 403)
        self.done(purchase_id, "approve", self.t.lead)
        self.as_member(self.t.engineer)
        late = self.client.patch(f"/api/purchasing/requests/{purchase_id}/", {"quantity": 60}, format="json")
        self.assertEqual(late.status_code, 409)
        self.assertEqual(PurchaseRequest.objects.get(pk=purchase_id).quantity, 6)

    def test_describing_the_part_again_switches_to_a_new_part(self):
        purchase_id = self.asked()
        self.as_member(self.t.engineer)
        response = self.client.patch(
            f"/api/purchasing/requests/{purchase_id}/", {"new_part": {"name": "Li-ion cells 21700"}}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["part"]["name"], "Li-ion cells 21700")
        self.assertTrue(Part.objects.filter(pk=self.t.cells.pk).exists())  # the known part stays


class PurchaseApprovalTests(PurchasingApiTestCase):
    """Two approvals before ordering: the leader, then the head of Operations (decided on 19/10/2026)."""

    def test_the_leader_then_the_head_of_operations_approve(self):
        purchase_id = self.asked()
        first = self.done(purchase_id, "approve", self.t.lead)
        self.assertEqual(first["status"], "a_valider_operations")
        second = self.done(purchase_id, "approve", self.t.ops_head)
        self.assertEqual(second["status"], "a_commander")
        self.assertEqual(self.history(purchase_id), [
            (A.REQUESTED, S.A_VALIDER_CHEF, self.t.engineer.id),
            (A.APPROVED, S.A_VALIDER_OPERATIONS, self.t.lead.id),
            (A.APPROVED, S.A_COMMANDER, self.t.ops_head.id),
        ])

    def test_the_project_manager_approves_as_leader(self):
        purchase_id = self.asked()
        self.assertEqual(self.done(purchase_id, "approve", self.t.manager)["status"], "a_valider_operations")

    def test_who_may_not_approve(self):
        purchase_id = self.asked()
        for member in (self.t.engineer, self.t.teammate, self.t.outsider, self.t.coordinator, self.t.ops_head):
            self.assertEqual(self.act(purchase_id, "approve", member).status_code, 403, member.first_name)
        self.done(purchase_id, "approve", self.t.lead)
        for member in (self.t.lead, self.t.manager, self.t.coordinator, self.t.engineer):
            self.assertEqual(self.act(purchase_id, "approve", member).status_code, 403, member.first_name)

    def test_a_leaders_own_request_awaits_operations_only(self):
        purchase_id = self.asked(self.t.lead)
        self.assertEqual(PurchaseRequest.objects.get(pk=purchase_id).status, S.A_VALIDER_OPERATIONS)
        self.assertEqual(self.history(purchase_id), [
            (A.REQUESTED, S.A_VALIDER_CHEF, self.t.lead.id), (A.APPROVED, S.A_VALIDER_OPERATIONS, self.t.lead.id),
        ])

    def test_a_club_admin_approves_both_steps_at_once(self):
        purchase_id = self.asked()
        self.assertEqual(self.done(purchase_id, "approve", self.t.admin)["status"], "a_commander")
        own = self.asked(self.t.admin)
        self.assertEqual(PurchaseRequest.objects.get(pk=own).status, S.A_COMMANDER)

    def test_refusing_needs_a_reason_and_ends_the_request(self):
        purchase_id = self.asked()
        self.assertEqual(self.act(purchase_id, "refuse", self.t.lead).status_code, 400)
        self.assertEqual(self.act(purchase_id, "refuse", self.t.lead, reason="   ").status_code, 400)
        refused = self.done(purchase_id, "refuse", self.t.lead, reason="Already in the workshop")
        self.assertEqual(refused["status"], "annule")
        self.assertEqual(self.history(purchase_id)[-1], (A.REFUSED, S.ANNULE, self.t.lead.id))
        self.assertEqual(refused["events"][-1]["comment"], "Already in the workshop")
        late = self.act(purchase_id, "approve", self.t.lead)
        self.assertEqual(late.status_code, 409)
        self.assertIn("validation", late.json()["detail"])  # French by default

    def test_an_unknown_request_is_404(self):
        self.assertEqual(self.act(999999, "approve", self.t.admin).status_code, 404)


class PurchaseCancellingTests(PurchasingApiTestCase):
    def test_the_author_cancels_until_the_part_is_ordered(self):
        purchase_id = self.to_order()
        self.assertEqual(self.act(purchase_id, "cancel", self.t.engineer).status_code, 400)  # no reason
        self.assertEqual(self.act(purchase_id, "cancel", self.t.outsider, reason="No").status_code, 403)
        cancelled = self.done(purchase_id, "cancel", self.t.engineer, reason="Found some in the workshop")
        self.assertEqual(cancelled["status"], "annule")
        self.assertEqual(self.history(purchase_id)[-1], (A.CANCELLED, S.ANNULE, self.t.engineer.id))

    def test_operations_cancel_an_order_in_progress(self):
        purchase_id = self.ordered()
        self.assertEqual(self.act(purchase_id, "cancel", self.t.engineer, reason="Too late").status_code, 403)
        self.done(purchase_id, "cancel", self.t.coordinator, reason="The project changed")
        self.assertEqual(PurchaseOrder.objects.get(purchase_request_id=purchase_id).status, S.ANNULE)
        self.assertEqual(self.act(purchase_id, "cancel", self.t.coordinator, reason="Again").status_code, 409)


class PurchaseOrderingTests(PurchasingApiTestCase):
    """Operations order, in the supplier's currency, at the rate actually paid; totals in dinars too."""

    def test_operations_order_in_a_currency_at_the_rate_paid(self):
        purchase_id = self.to_order()
        placed = self.done(
            purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, shipping_address_id=self.t.address.id,
            estimated_delivery_date=str(self.today + timedelta(days=12)), **self.ORDER,
        )
        self.assertEqual(placed["status"], "en_commande")
        order = placed["order"]
        # 4 cells × 10.00 + 5 delivery + 2 customs = 47.00 EUR; × 250 = 11 750.00 DA.
        self.assertEqual(
            (order["currency"], order["exchange_rate"], order["total_price"], order["total_price_dzd"]),
            ("EUR", "250.0000", "47.00", "11750.00"),
        )
        self.assertEqual(order["ordered_at"], str(self.today))
        self.assertEqual(order["shipping_address"]["country"], "France")
        self.assertEqual(self.history(purchase_id)[-1], (A.ORDERED, S.EN_COMMANDE, self.t.coordinator.id))
        # Others see the order, not the shipping address.
        self.assertIsNone(self.detail(purchase_id, self.t.engineer)["order"]["shipping_address"])

    def test_dinars_are_at_rate_one_and_a_foreign_currency_needs_its_rate(self):
        purchase_id = self.to_order()
        no_rate = self.act(purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, unit_price="10", currency="GBP")
        self.assertEqual(no_rate.status_code, 400)
        self.assertIn("exchange_rate", no_rate.json())
        order = self.done(
            purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, unit_price="1000",
            currency="DZD", exchange_rate="300",
        )["order"]
        self.assertEqual((order["exchange_rate"], order["total_price"], order["total_price_dzd"]), ("1.0000", "4000.00", "4000.00"))

    def test_the_delivery_is_not_expected_before_the_order(self):
        purchase_id = self.to_order()
        response = self.act(
            purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, unit_price="10",
            ordered_at=str(self.today), estimated_delivery_date=str(self.today - timedelta(days=1)),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("estimated_delivery_date", response.json())

    def test_only_operations_order_and_only_once_approved(self):
        purchase_id = self.asked()
        self.assertEqual(self.act(purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, unit_price="1").status_code, 409)
        self.done(purchase_id, "approve", self.t.lead)
        self.done(purchase_id, "approve", self.t.ops_head)
        for member in (self.t.engineer, self.t.lead, self.t.manager, self.t.outsider):
            self.assertEqual(
                self.act(purchase_id, "order", member, supplier_id=self.t.supplier.id, unit_price="1").status_code, 403,
                member.first_name,
            )
        self.assertEqual(self.act(purchase_id, "order", self.t.ops_head, supplier_id=self.t.supplier.id, unit_price="1").status_code, 201)

    def test_the_order_in_progress_can_be_changed(self):
        purchase_id = self.ordered()
        self.as_member(self.t.coordinator)
        response = self.client.patch(f"/api/purchasing/requests/{purchase_id}/order/", {"unit_price": "12.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["order"]["total_price_dzd"], "13750.00")  # (48 + 7) × 250
        self.as_member(self.t.engineer)
        self.assertEqual(self.client.patch(f"/api/purchasing/requests/{purchase_id}/order/", {"unit_price": "1"}, format="json").status_code, 403)

    def test_a_cancelled_order_sends_the_request_back_to_be_ordered(self):
        purchase_id = self.ordered()
        self.assertEqual(self.act(purchase_id, "cancel-order", self.t.coordinator).status_code, 400)  # no reason
        back = self.done(purchase_id, "cancel-order", self.t.coordinator, reason="The supplier cannot deliver")
        self.assertEqual((back["status"], back["order"]), ("a_commander", None))
        self.assertEqual(self.history(purchase_id)[-1], (A.ORDER_CANCELLED, S.A_COMMANDER, self.t.coordinator.id))
        again = self.done(purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, unit_price="9", currency="DZD")
        self.assertEqual(again["status"], "en_commande")
        self.assertEqual(
            sorted(PurchaseOrder.objects.filter(purchase_request_id=purchase_id).values_list("status", flat=True)),
            ["annule", "en_commande"],
        )


class PurchaseReceptionTests(PurchasingApiTestCase):
    """When the parts arrive, they enter the stock in the same step (the team's sheet had no link)."""

    def test_receiving_puts_the_parts_in_stock(self):
        purchase_id = self.ordered()
        received = self.done(purchase_id, "receive", self.t.coordinator, location="Shelf B2")
        self.assertEqual((received["status"], received["order"]["status"]), ("livre", "livre"))
        self.assertEqual(received["order"]["actual_delivery_date"], str(self.today))
        item = StockItem.objects.get(part=self.t.cells)
        self.assertEqual((item.quantity_available, item.location), (4, "Shelf B2"))
        movement = StockMovement.objects.get(stock_item=item)
        self.assertEqual(
            (movement.movement_type, movement.quantity, movement.related_purchase_order.purchase_request_id, movement.moved_by),
            (StockMovementType.IN, 4, purchase_id, self.t.coordinator),
        )
        self.assertEqual(self.history(purchase_id)[-1], (A.RECEIVED, S.LIVRE, self.t.coordinator.id))

    def test_receiving_adds_to_the_line_of_the_place_given(self):
        StockItem.objects.create(part=self.t.cells, quantity_available=3, location="Shelf A1")
        self.done(self.ordered(), "receive", self.t.coordinator)  # no place: the part's first line
        self.assertEqual(StockItem.objects.get(part=self.t.cells, location="Shelf A1").quantity_available, 7)
        self.done(self.ordered(), "receive", self.t.coordinator, location="Container")  # its own line
        self.assertEqual(StockItem.objects.get(part=self.t.cells, location="Container").quantity_available, 4)

    def test_the_delivery_date(self):
        purchase_id = self.ordered(ordered_at=str(self.today - timedelta(days=10)))
        future = self.act(purchase_id, "receive", self.t.coordinator, actual_delivery_date=str(self.today + timedelta(days=1)))
        self.assertEqual(future.status_code, 400)
        early = self.act(purchase_id, "receive", self.t.coordinator, actual_delivery_date=str(self.today - timedelta(days=11)))
        self.assertEqual(early.status_code, 400)
        self.done(purchase_id, "receive", self.t.coordinator, actual_delivery_date=str(self.today - timedelta(days=2)))
        moved = timezone.localtime(StockMovement.objects.get().moved_at)
        self.assertEqual((moved.date(), moved.hour), (self.today - timedelta(days=2), 12))

    def test_receiving_twice_or_by_others_is_refused(self):
        purchase_id = self.ordered()
        self.assertEqual(self.act(purchase_id, "receive", self.t.engineer).status_code, 403)
        self.done(purchase_id, "receive", self.t.coordinator)
        self.assertEqual(self.act(purchase_id, "receive", self.t.coordinator).status_code, 409)
        self.assertEqual(StockItem.objects.get(part=self.t.cells).quantity_available, 4)
        self.assertEqual(self.act(purchase_id, "cancel", self.t.coordinator, reason="Too late").status_code, 409)


class PurchaseNotificationTests(PurchasingApiTestCase):
    """Who must act next is told (and e-mailed); the requester follows the request in the ERP."""

    def kinds(self, member):
        return [
            (notification.kind, notification.data.get("level") or notification.data.get("action"))
            for notification in Notification.objects.filter(member=member).order_by("id")
        ]

    def test_each_step_tells_who_acts_next_and_the_requester(self):
        with self.captureOnCommitCallbacks(execute=True):
            purchase_id = self.asked()
        K = NotificationKind
        self.assertEqual(self.kinds(self.t.lead), [(K.PURCHASE_APPROVAL_REQUESTED, "leader")])
        self.assertEqual(self.kinds(self.t.manager), [(K.PURCHASE_APPROVAL_REQUESTED, "leader")])
        self.assertEqual(self.kinds(self.t.engineer), [])  # never the person who acted
        notification = Notification.objects.get(member=self.t.lead)
        self.assertEqual(
            (notification.related_entity_type, notification.related_entity_id), ("purchase_request", purchase_id)
        )
        self.assertEqual(notification.data["part"], "Li-ion cells")
        self.assertEqual(notification.data["quantity"], 4)
        self.assertEqual(notification.data["requester"], "Engineer Test")
        self.assertEqual(sorted(message.to[0] for message in mail.outbox), ["lead@example.invalid", "manager@example.invalid"])
        self.assertIn(f"/purchasing/requests/{purchase_id}", mail.outbox[0].body)

        with self.captureOnCommitCallbacks(execute=True):
            self.done(purchase_id, "approve", self.t.lead)
        self.assertEqual(self.kinds(self.t.ops_head), [(K.PURCHASE_APPROVAL_REQUESTED, "operations")])
        self.assertEqual(self.kinds(self.t.engineer), [(K.PURCHASE_UPDATED, "approved")])

        with self.captureOnCommitCallbacks(execute=True):
            self.done(purchase_id, "approve", self.t.ops_head)
        self.assertEqual(self.kinds(self.t.coordinator), [(K.PURCHASE_TO_ORDER, None)])
        self.assertEqual(mail.outbox[-1].to, ["coordinator@example.invalid"])
        self.assertEqual(self.kinds(self.t.engineer)[-1], (K.PURCHASE_UPDATED, "approved"))
        self.assertEqual(Notification.objects.filter(member=self.t.engineer).order_by("id").last().data["status"], "a_commander")

        self.done(purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, unit_price="1", currency="DZD")
        self.assertEqual(Notification.objects.filter(member=self.t.engineer).order_by("id").last().data["supplier"], "Laser Cut Test")
        self.done(purchase_id, "receive", self.t.coordinator)
        self.assertEqual(self.kinds(self.t.engineer)[-2:], [(K.PURCHASE_UPDATED, "ordered"), (K.PURCHASE_UPDATED, "received")])

    def test_a_refusal_tells_the_requester_why(self):
        purchase_id = self.asked()
        self.done(purchase_id, "refuse", self.t.lead, reason="Already in the workshop")
        notification = Notification.objects.get(member=self.t.engineer)
        self.assertEqual((notification.kind, notification.data["action"]), (NotificationKind.PURCHASE_UPDATED, "refused"))
        self.assertEqual(notification.data["reason"], "Already in the workshop")

    def test_cancelling_tells_operations_when_they_had_it_to_order(self):
        purchase_id = self.to_order()
        self.done(purchase_id, "cancel", self.t.engineer, reason="Not needed any more")
        self.assertEqual(self.kinds(self.t.coordinator)[-1], (NotificationKind.PURCHASE_UPDATED, "cancelled"))
        self.assertEqual(self.kinds(self.t.ops_head)[-1], (NotificationKind.PURCHASE_UPDATED, "cancelled"))

    def test_without_a_head_of_operations_the_club_admins_are_asked(self):
        Membership.objects.filter(member=self.t.ops_head).update(end_date=self.today)
        purchase_id = self.asked()
        self.done(purchase_id, "approve", self.t.lead)
        self.assertEqual(self.kinds(self.t.admin), [(NotificationKind.PURCHASE_APPROVAL_REQUESTED, "operations")])


class OperationsJuniorsTests(PurchasingApiTestCase):
    """"Operations" is the head of the department and its logistics coordinators, not its junior members
    (decided on 19/10/2026: "le chef et les coordinateurs logistiques")."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.junior = person("junior")
        member_role = Role.objects.create(
            code="t-club-member", name="Member", role_type=MemberRoleType.MEMBER, scope=RoleScope.CLUB
        )
        Membership.objects.create(member=cls.junior, org_unit=cls.t.operations, role=member_role, member_level="junior")

    def test_a_junior_of_operations_neither_orders_nor_is_asked_to(self):
        purchase_id = self.to_order()
        self.assertFalse(Notification.objects.filter(member=self.junior).exists())
        refused = self.act(purchase_id, "order", self.junior, supplier_id=self.t.supplier.id, unit_price="1")
        self.assertEqual(refused.status_code, 403)
        self.as_member(self.junior)
        self.assertFalse(self.client.get("/api/purchasing/requests/summary/").json()["can_manage"])
        self.assertEqual(self.client.post("/api/purchasing/suppliers/", {"name": "X"}, format="json").status_code, 403)
        self.assertEqual(self.client.get("/api/purchasing/shipping-addresses/").status_code, 403)
        self.assertIsNone(self.client.get("/api/purchasing/suppliers/").json()[0]["email"])  # contacts hidden


class UnitPurchaseTests(PurchasingApiTestCase):
    """A purchase for a unit itself, without a subsystem: approved by the unit's leaders (the club
    admins when neither it nor a unit above it has one), then ordered and received like the others."""

    def test_a_units_purchase_goes_through_every_step(self):
        purchase_id = self.asked(self.t.engineer, subsystem_id=None, org_unit_id=self.t.electronics.id)
        # No subsystem, so no project manager: the leader of Electronics approves.
        self.assertEqual(self.act(purchase_id, "approve", self.t.manager).status_code, 403)
        self.done(purchase_id, "approve", self.t.lead)
        self.done(purchase_id, "approve", self.t.ops_head)
        self.done(purchase_id, "order", self.t.coordinator, supplier_id=self.t.supplier.id, unit_price="3", currency="DZD")
        received = self.done(purchase_id, "receive", self.t.coordinator)
        self.assertEqual((received["status"], received["subsystem"], received["project"]), ("livre", None, None))
        self.assertEqual(received["org_unit"]["id"], self.t.electronics.id)
        self.assertEqual(StockItem.objects.get(part=self.t.cells).quantity_available, 4)

    def test_a_unit_without_leaders_is_approved_by_the_club_admins(self):
        # Neither Aerodynamics nor the FS team above it has a leader.
        purchase_id = self.asked(self.t.outsider, subsystem_id=None, org_unit_id=self.t.aero.id)
        asked = Notification.objects.get(kind=NotificationKind.PURCHASE_APPROVAL_REQUESTED)
        self.assertEqual((asked.member, asked.data["level"]), (self.t.admin, "leader"))
        self.assertEqual(self.act(purchase_id, "approve", self.t.lead).status_code, 403)  # leads Electronics only
        self.assertEqual(self.done(purchase_id, "approve", self.t.admin)["status"], "a_commander")


class SupplierApiTests(PurchasingApiTestCase):
    """Every member sees the suppliers; their contacts only Operations, club admins and unit leaders."""

    CONTACTS = ("address", "contact_name", "contact_role", "email", "phone")

    def supplier(self, member):
        self.as_member(member)
        response = self.client.get("/api/purchasing/suppliers/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()[0]

    def test_contacts_only_for_operations_admins_and_leaders(self):
        hidden = self.supplier(self.t.outsider)
        self.assertEqual((hidden["name"], hidden["city"], hidden["status"]), ("Laser Cut Test", "Alger", "validee"))
        self.assertEqual([hidden[field] for field in self.CONTACTS], [None] * 5)
        self.assertEqual(hidden["contacted_by"]["id"], self.t.coordinator.id)
        self.assertFalse(hidden["can_edit"])
        for member in (self.t.coordinator, self.t.ops_head, self.t.admin, self.t.lead):
            shown = self.supplier(member)
            self.assertEqual(shown["email"], "sales@example.invalid", member.first_name)
            self.assertEqual(shown["can_edit"], member != self.t.lead, member.first_name)

    def test_filters(self):
        Supplier.objects.create(name="Steel Test", type=SupplierType.FOURNISSEUR, status=SupplierStatus.EN_ATTENTE, city="Oran")
        self.as_member(self.t.outsider)

        def names(query):
            return [supplier["name"] for supplier in self.client.get(f"/api/purchasing/suppliers/{query}").json()]

        self.assertEqual(names(""), ["Laser Cut Test", "Steel Test"])
        self.assertEqual(names("?search=oran"), ["Steel Test"])
        self.assertEqual(names("?type=sous_traitant"), ["Laser Cut Test"])
        self.assertEqual(names("?status=en_attente"), ["Steel Test"])

    def test_operations_add_and_change_suppliers(self):
        self.as_member(self.t.engineer)
        self.assertEqual(self.client.post("/api/purchasing/suppliers/", {"name": "New"}, format="json").status_code, 403)
        self.as_member(self.t.coordinator)
        created = self.client.post(
            "/api/purchasing/suppliers/",
            {"name": "  Steel   Test  ", "type": "fournisseur", "city": "Oran", "contacted_by_id": self.t.coordinator.id},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual((created.json()["name"], created.json()["status"]), ("Steel Test", "pas_encore_envoyee"))
        duplicate = self.client.post("/api/purchasing/suppliers/", {"name": "laser cut test"}, format="json")
        self.assertEqual(duplicate.status_code, 400)
        changed = self.client.patch(f"/api/purchasing/suppliers/{created.json()['id']}/", {"status": "validee"}, format="json")
        self.assertEqual((changed.status_code, changed.json()["status"]), (200, "validee"))
        self.as_member(self.t.lead)
        self.assertEqual(self.client.patch(f"/api/purchasing/suppliers/{self.t.supplier.id}/", {"city": "X"}, format="json").status_code, 403)

    def test_shipping_addresses_only_for_operations(self):
        self.as_member(self.t.lead)
        self.assertEqual(self.client.get("/api/purchasing/shipping-addresses/").status_code, 403)
        self.as_member(self.t.coordinator)
        self.assertEqual(self.client.get("/api/purchasing/shipping-addresses/").json(), [
            {"id": self.t.address.id, "country": "France", "address": "2 avenue des Tests, Paris"}
        ])

    def test_known_parts_are_searched(self):
        Part.objects.create(name="M8 bolt", reference="ISO-4017")
        self.as_member(self.t.outsider)
        found = self.client.get("/api/purchasing/parts/?search=iso").json()["results"]
        self.assertEqual([part["name"] for part in found], ["M8 bolt"])


class PurchaseOrderModelTests(TestCase):
    """Totals computed by the order itself (team's formula), and in dinars for the budgets."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_purchasing()
        cls.purchase = PurchaseRequest.objects.create(
            part=cls.t.cells, requested_by=cls.t.engineer, quantity=3, org_unit=cls.t.electronics, status=S.EN_COMMANDE
        )

    def test_totals_in_the_order_currency_and_in_dinars(self):
        order = PurchaseOrder.objects.create(
            purchase_request=self.purchase, supplier=self.t.supplier, unit_price=Decimal("2.10"),
            delivery_cost=Decimal("1.00"), customs_cost=Decimal("0.33"), currency=Currency.GBP,
            exchange_rate=Decimal("290.1234"),
        )
        self.assertEqual(order.total_price, Decimal("7.63"))  # 3 × 2.10 + 1.00 + 0.33
        self.assertEqual(order.total_price_dzd, Decimal("2213.64"))  # 7.63 × 290.1234 = 2213.6415…

    def test_one_order_in_progress_per_request(self):
        PurchaseOrder.objects.create(purchase_request=self.purchase, supplier=self.t.supplier, unit_price=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            PurchaseOrder.objects.create(purchase_request=self.purchase, supplier=self.t.supplier, unit_price=1)

    def test_dinars_are_at_rate_one(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            PurchaseOrder.objects.create(
                purchase_request=self.purchase, supplier=self.t.supplier, currency=Currency.DZD, exchange_rate=2
            )


# --- Import of the team's subcontracting workbook (manage.py import_subcontracting_sheet) ---
# The tests write a small fictitious workbook with the titles of the real one. The real one holds the
# contacts of people outside the club: it is never read by the tests, and never committed.

PARTS_TITLES = [
    "", "Nom de la pièce", "Description", "Quantité", "Matière", "Process (Usinage / Impression 3D / Découpe / finition)",
    "Fournisseur choisi", "Prix unitaire", "Delivery cost + custom cost", "Prix total", "Priorité", "Date demandée",
    "Date de livraison estimée", "Statut", "Statut", "Remarques",
]
# category, name, description, quantity, material, process, chosen supplier, unit price, delivery + customs,
# total, priority, needed by, expected delivery, status (first column), status, remarks
PART_ROWS = [
    ["BRK", "Disque de frein", "Ø 220 mm", 2, "Acier", "Découpe laser", "Tôlerie Fictive", 1500, 300, 3300, "P1",
     datetime(2026, 9, 1), None, None, "Livré", "Reçu en avance"],
    # The same part bought twice.
    ["BRK", "Disque de frein", "Ø 220 mm", 2, "Acier", "Découpe laser", "Tôlerie Fictive", 1500, 300, 3300, "P1",
     None, None, None, "Livré", None],
    ["SUS", "Rotule M8", None, 4.0, None, "Tournage", "Roulements Nouveaux", "250", None, 1000, "P2", None, None, None,
     "En commande", None],
    ["STR", "Crémaillère", "Course 60 mm", 1, "Alu", "Usinage", "usinage fictif", "1 200 da", 500, 1700, "P3",
     "15/11/2026", None, None, "A commander", None],
    ["Workshop", "Forets", None, "Plusieurs", None, None, "https://fr.aliexpress.com/item/123.html", None, None, None,
     None, None, None, None, None, None],
    ["Mystère", "Tube carré", None, "2 x 1 m", "Acier", None, None, None, None, None, "P1", None, None, None, "Livré",
     None],
    ["OP", "Cartons", None, 10, None, None, "Ets Fournitures Exemple", None, None, "#VALUE!", "P2", None, None, None,
     "En commande", None],
    ["chassis & body", "Plaque", "5 mm", 1, "Alu 5754", "Découpe laser", "TÔLERIE FICTIVE", 800, None, 900, "P1",
     None, None, "urgent", "Livré", "Payé en espèces"],
    ["Low voltage", "Câble", None, 2.5, None, None, None, None, None, None, "P3", "bientôt", None, None, "Livré", None],
    ["BRK", None, "Sans nom", 1, None, None, None, None, None, None, None, None, None, None, "Livré", None],
]
SUPPLIERS_TITLES = [
    "Statut", "Nom du fournisseur / Soustraitant", "type", "Capacités techniques", "Adresse / Ville / pays",
    "Contact / poste", "Email / TLF", "contacté par :", "Délai moyen", "Commentaires",
]
SUPPLIER_ROWS = [
    ["Validée", "Tôlerie Fictive", "sous-traitant", "Découpe laser, pliage", "Rouiba", "Karim Fictif / Commercial",
     "tolerie@example.invalid / 0555 00 01 02", "ines", 10, "Livre vite"],
    ["En attente", "  Usinage   Fictif ", "Usinage", "Tournage", None, "Atelier", 555000111, "Exemple Yanis",
     "15 jours", None],
    ["Refusée", "Pièces Exemple", "Mixte", None, "Lyon, France", None, "achats@example.invalid", "Yanis",
     "2 semaines", None],
    ["Pas encore envoyée", "Transport Fictif", "logistique", None, None, None, None, "Modele", datetime(2026, 3, 2),
     None],
    [None, "Fournitures Exemple", "Fournisseur", None, None, None, "+33 1 00 00 00 00", "Lina", None, None],
    ["En attente", "Atelier Bricole", "Bricolage", None, None, None, None, "Sofiane M.", None, None],
    ["Validée", "TOLERIE fictive", "Fournisseur", None, None, None, None, None, None, None],  # repeated
    # No name: a provisional one from its capabilities (Excel row 9); "Sofianne" is written for Sofiane.
    ["En attente", None, "Fournisseur", "Peinture, sablage", None, None, None, "Sofianne", None, None],
    ["Validée", "laser cut test", "Fournisseur", None, None, None, None, None, None, None],  # already in the ERP
    [None, None, None, None, "Quelque part", None, None, None, None, None],  # no name, nothing to name it by
]
ADDRESSES_TITLES = ["County ", "Adress to ship in ", "contacted par : "]
ADDRESS_ROWS = [
    ["France ", "3 rue de l'Exemple, Lyon", "ines"],
    ["Chine", "Entrepôt fictif, Shenzhen", "Quelqu'un"],
    ["Turquie", None, "Yanis"],
    ["France", "2 avenue des Tests, Paris", None],  # already in the ERP
]
# Never in the output: names, contacts, remarks (lower case).
SECRETS = [
    "tôlerie", "tolerie", "fictif", "fictive", "exemple", "bricole", "karim", "commercial", "example.invalid", "0555",
    "+33", "livre vite", "inès", "yanis", "sofiane", "modele", "lina", "rouiba", "lyon", "shenzhen", "avance",
    "espèces", "disque", "rotule", "crémaillère", "forets", "cartons", "plaque", "câble", "aliexpress", "roulements",
    "mystère", "journaliste", "quelqu", "peinture", "sablage", "sofianne",
]


class SheetValueTests(SimpleTestCase):
    """How the workbook's cells are read: numbers typed as text, missing leading zeros, links…"""

    def test_words_are_compared_without_case_accents_or_punctuation(self):
        self.assertEqual(normalize("  Pièces & Commandes "), "pieces commandes")
        self.assertEqual(normalize("Sous-traitant"), "sous traitant")
        self.assertEqual(normalize(None), "")
        # Letters of every script count: a name in Arabic is not an empty name.
        self.assertEqual(normalize("Atelier « ورشة »"), "atelier ورشة")

    def test_drivertrain_is_transmission(self):  # a typo of the team's sheet
        self.assertEqual(part_category("Drivertrain"), (PartCategory.DRIVETRAIN, ""))

    def test_the_words_that_tell_suppliers_apart(self):
        self.assertEqual(significant("Ets Transport Fictif"), {"transport", "fictif"})
        self.assertEqual(significant("aliexpress.com"), {"aliexpress"})
        self.assertEqual(significant("SARL"), set())

    def test_a_supplier_type_from_the_processes_asked(self):
        self.assertEqual(guessed_type(["Usinage CNC"]), SupplierType.USINAGE)
        self.assertEqual(guessed_type(["Découpe laser", None]), SupplierType.SOUS_TRAITANT)
        self.assertEqual(guessed_type([]), SupplierType.FOURNISSEUR)

    def test_amounts(self):
        self.assertEqual(to_amount(1500), Decimal("1500"))
        self.assertEqual(to_amount(12.5), Decimal("12.50"))
        self.assertEqual(to_amount("1 200 da"), Decimal("1200"))
        self.assertEqual(to_amount("1 200,50 DA"), Decimal("1200.50"))
        self.assertEqual(to_amount("1.500"), Decimal("1500"))  # a dot before groups of 3 digits: thousands
        self.assertEqual(to_amount("12.50"), Decimal("12.50"))
        for nothing in (None, "", "#VALUE!", "gratuit", -3, True):
            self.assertIsNone(to_amount(nothing), nothing)

    def test_quantities(self):
        self.assertEqual(to_quantity(4.0), (4, ""))
        self.assertEqual(to_quantity(" 12 "), (12, ""))
        self.assertEqual(to_quantity("Plusieurs"), (1, "Quantité dans la fiche : Plusieurs"))
        self.assertEqual(to_quantity(2.5), (1, "Quantité dans la fiche : 2,5"))
        self.assertEqual(to_quantity(0), (1, "Quantité dans la fiche : 0"))
        self.assertEqual(to_quantity(None), (1, "Quantité absente de la fiche."))

    def test_days(self):
        self.assertEqual(to_day(datetime(2026, 9, 1, 0, 0)), date(2026, 9, 1))
        self.assertEqual(to_day("15/11/2026"), date(2026, 11, 15))
        self.assertEqual(to_day("2026-11-15"), date(2026, 11, 15))
        self.assertIsNone(to_day("bientôt"))
        self.assertIsNone(to_day(None))

    def test_lead_times_only_as_a_number_of_days(self):
        self.assertEqual(to_lead_time(10), 10)
        self.assertEqual(to_lead_time("15 jours"), 15)
        self.assertEqual(to_lead_time("8 j"), 8)
        for not_days in ("2 semaines", "1-2 mois", datetime(2026, 3, 2), -2, None):
            self.assertIsNone(to_lead_time(not_days), not_days)

    def test_contact_and_position(self):
        self.assertEqual(split_contact("Karim Fictif / Commercial"), ("Karim Fictif", "Commercial"))
        self.assertEqual(split_contact("Atelier"), ("Atelier", ""))

    def test_email_and_phone(self):
        self.assertEqual(split_reach("tolerie@example.invalid / 0555 00 01 02"), ("tolerie@example.invalid", "0555 00 01 02"))
        self.assertEqual(split_reach(555000111), ("", "0555000111"))  # Excel dropped the 0 of a mobile number
        self.assertEqual(split_reach(21000000.0), ("", "021000000"))  # and of a landline
        self.assertEqual(split_reach(33100000000), ("", "33100000000"))
        self.assertEqual(split_reach("a@example.invalid b@example.invalid"), ("a@example.invalid", "b@example.invalid"))
        self.assertEqual(split_reach("par Facebook"), ("", "par Facebook"))

    def test_chosen_supplier_name_or_web_site(self):
        self.assertEqual(chosen_supplier("  Tôlerie   Fictive "), ("Tôlerie Fictive", False))
        self.assertEqual(chosen_supplier("https://fr.aliexpress.com/item/123.html"), ("aliexpress.com", True))
        self.assertEqual(chosen_supplier("www.amazon.co.uk/dp/B000"), ("amazon.co.uk", True))
        self.assertEqual(chosen_supplier("voir https://shop.example.com/p/1 (moins cher)"), ("example.com", True))


class SubcontractingSheetImportTests(TestCase):
    """manage.py import_subcontracting_sheet: the team's workbook becomes suppliers, shipping addresses,
    parts with their purchase requests and, for the ordered or delivered ones with a supplier and a
    price, their orders. Safe to run again, in one transaction, counts only in the output."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_purchasing()
        people = Member.objects.create_user
        cls.ines = people(email="ines.fictive@example.invalid", password=None, first_name="Inès", last_name="Fictive")
        cls.yanis = people(email="yanis.exemple@example.invalid", password=None, first_name="Yanis", last_name="Exemple")
        cls.yanis_autre = people(
            email="yanis.autre@example.invalid", password=None, first_name="Yanis", last_name="Autre"
        )
        cls.sofiane = people(email="sofiane.modele@example.invalid", password=None, first_name="Sofiane", last_name="Modele")
        # A fictitious person of the demo (seed_demo): never taken for a real member.
        people(email="lina.demo@example.invalid", password=None, first_name="Lina", last_name="Demo", code="demo-lina")

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.parts = [list(row) for row in PART_ROWS]
        self.suppliers = [list(row) for row in SUPPLIER_ROWS]
        self.addresses = [list(row) for row in ADDRESS_ROWS]

    def sheets(self):
        return [
            ("Pièces & Commandes", PARTS_TITLES, self.parts),
            ("Fournisseurs  entreprises", SUPPLIERS_TITLES, self.suppliers),
            ("Journalistes  medias", ["Nom du journaliste / influenceur", "la chaine"], [["Journaliste Fictif", "TV"]]),
            ("shipping adress", ADDRESSES_TITLES, self.addresses),
        ]

    def workbook(self, name="fiche.xlsx", sheets=None):
        book = Workbook()
        book.remove(book.active)
        for title, titles, rows in self.sheets() if sheets is None else sheets:
            sheet = book.create_sheet(title)
            sheet.append(titles)
            for row in rows:
                sheet.append(row)
        path = self.folder / name
        book.save(path)
        return path

    def run_import(self, *options, path=None):
        out, err = StringIO(), StringIO()
        call_command("import_subcontracting_sheet", str(path or self.workbook()), *options, stdout=out, stderr=err)
        return out.getvalue() + err.getvalue()

    def counts(self):
        return [
            model.objects.count()
            for model in (Supplier, ShippingAddress, Part, PurchaseRequest, PurchaseRequestEvent, PurchaseOrder)
        ]

    def test_a_dry_run_shows_the_counts_and_saves_nothing(self):
        before = self.counts()
        output = self.run_import("--dry-run")
        self.assertEqual(self.counts(), before)
        for line in [
            "Workbook: fiche.xlsx",
            "Suppliers - added: 7, already in the ERP: 1, repeated in the sheet: 1, without a name: 2",
            "  without a name - added under a provisional name: 1, left out (nothing to name them by): 1",
            "Shipping addresses - added: 2, already in the ERP: 1, without an address: 1",
            "Purchase requests - added: 9, imported before: 0, rows without a part name: 1",
            "Purchase orders - added: 4 (in DA, rate 1), total different from the sheet: 1",
            f"Requested by: member #{self.t.ops_head.pk} (head of Operations)",
            "Dry run: nothing was saved.",
        ]:
            self.assertIn(line, output)

    def test_the_output_never_shows_names_contacts_or_remarks(self):
        output = (self.run_import("--dry-run") + self.run_import()).lower()
        for secret in SECRETS:
            self.assertNotIn(secret, output)

    def test_suppliers_take_the_erp_words(self):
        output = self.run_import()
        self.assertIn("Import saved.", output)
        self.assertIn("  not recognised (kept in the comments) - statuses: 0, types: 1", output)
        found = {supplier.name: supplier for supplier in Supplier.objects.all()}
        # The six of the sheet, one under a provisional name, the one already known, and two named only in
        # "Fournisseur choisi" (the third one is the sheet's "Fournitures Exemple").
        self.assertEqual(len(found), 10)
        chosen = found["Roulements Nouveaux"]
        self.assertEqual((chosen.status, chosen.email), (SupplierStatus.PAS_ENCORE_ENVOYEE, ""))
        self.assertEqual(chosen.comments.splitlines(), [
            "Ajouté par l'import de la fiche de sous-traitance (colonne « Fournisseur choisi »).", TYPE_GUESSED,
        ])
        tolerie = found["Tôlerie Fictive"]
        self.assertEqual((tolerie.status, tolerie.type), (SupplierStatus.VALIDEE, SupplierType.SOUS_TRAITANT))
        self.assertEqual((tolerie.technical_capabilities, tolerie.address), ("Découpe laser, pliage", "Rouiba"))
        self.assertEqual((tolerie.contact_name, tolerie.contact_role), ("Karim Fictif", "Commercial"))
        self.assertEqual((tolerie.email, tolerie.phone), ("tolerie@example.invalid", "0555 00 01 02"))
        self.assertEqual((tolerie.average_lead_time_days, tolerie.comments), (10, "Livre vite"))
        usinage = found["Usinage Fictif"]
        self.assertEqual((usinage.status, usinage.type), (SupplierStatus.EN_ATTENTE, SupplierType.USINAGE))
        self.assertEqual((usinage.contact_name, usinage.contact_role, usinage.phone), ("Atelier", "", "0555000111"))
        self.assertEqual(usinage.average_lead_time_days, 15)
        pieces = found["Pièces Exemple"]
        self.assertEqual((pieces.status, pieces.type, pieces.email), (SupplierStatus.REFUSEE, SupplierType.MIXTE, "achats@example.invalid"))
        self.assertEqual((pieces.average_lead_time_days, pieces.comments), (None, "Délai moyen indiqué dans la fiche : 2 semaines"))
        transport = found["Transport Fictif"]
        self.assertEqual((transport.status, transport.type), (SupplierStatus.PAS_ENCORE_ENVOYEE, SupplierType.LOGISTIQUE))
        self.assertIsNone(transport.average_lead_time_days)  # Excel turned it into a date
        fournitures = found["Fournitures Exemple"]
        self.assertEqual((fournitures.status, fournitures.type), (SupplierStatus.PAS_ENCORE_ENVOYEE, SupplierType.FOURNISSEUR))
        self.assertEqual((fournitures.email, fournitures.phone), ("", "+33 1 00 00 00 00"))
        bricole = found["Atelier Bricole"]
        self.assertEqual((bricole.type, bricole.comments), (None, "Type dans la fiche : Bricolage"))
        # Already in the ERP: left as it was.
        self.assertEqual(Supplier.objects.get(pk=self.t.supplier.pk).type, SupplierType.SOUS_TRAITANT)
        self.assertIn("  average lead time - kept: 2, not a number of days (left empty): 2", output)

    def test_contacted_by_is_a_member_found_by_name_or_left_empty(self):
        output = self.run_import()
        contacted = dict(Supplier.objects.values_list("name", "contacted_by"))
        self.assertEqual(contacted["Tôlerie Fictive"], self.ines.pk)  # "ines": the first name, any case or accent
        self.assertEqual(contacted["Usinage Fictif"], self.yanis.pk)  # "Exemple Yanis": the full name
        self.assertIsNone(contacted["Pièces Exemple"])  # "Yanis": two members have this first name
        self.assertEqual(contacted["Transport Fictif"], self.sofiane.pk)  # "Modele": the last name
        self.assertIsNone(contacted["Fournitures Exemple"])  # "Lina": only the demo's fictitious person
        self.assertEqual(contacted["Atelier Bricole"], self.sofiane.pk)  # "Sofiane M.": first name and initial
        self.assertIn(
            "  contacted by - linked to a member: 4, guessed (marked to check): 1, several possible members "
            "(left empty): 1, no member found (left empty): 1",
            output,
        )
        self.assertEqual(ShippingAddress.objects.get(address="3 rue de l'Exemple, Lyon").contacted_by, self.ines)
        self.assertIsNone(ShippingAddress.objects.get(address="Entrepôt fictif, Shenzhen").contacted_by)
        self.assertIn(
            "  contacted by - linked to a member: 1, guessed (marked to check): 0, several possible members "
            "(left empty): 0, no member found (left empty): 1",
            output,
        )

    def test_shipping_addresses(self):
        self.run_import()
        self.assertEqual(sorted(ShippingAddress.objects.values_list("country", "address")), [
            ("Chine", "Entrepôt fictif, Shenzhen"),
            ("France", "2 avenue des Tests, Paris"),
            ("France", "3 rue de l'Exemple, Lyon"),
        ])

    def test_parts_and_purchase_requests(self):
        output = self.run_import()
        for line in [
            "  status - delivered: 5, ordered: 1, to order: 3, cancelled: 0",
            "  to order because - no known status in the sheet: 1, ordered in the sheet without a supplier or a price: 1",
            "  priority - P1: 4, P2: 2, P3: 2, none: 1",
            "  notes from the sheet - remarks: 2, quantities: 3, categories: 1, priorities: 0, dates: 1, web links: 1, "
            "prices without an order: 1, other statuses: 1",
        ]:
            self.assertIn(line, output)
        purchases = PurchaseRequest.objects.select_related("part", "suggested_supplier")
        # Who asked is not in the sheet: the head of Operations, for no unit.
        self.assertEqual({(p.requested_by_id, p.org_unit_id, p.subsystem_id) for p in purchases}, {(self.t.ops_head.pk, None, None)})
        for purchase in purchases:
            self.assertEqual(
                list(purchase.events.values_list("action", "status", "actor", "comment")),
                [(PurchaseAction.REQUESTED, purchase.status, None, IMPORT_COMMENT)],
            )
        brakes = purchases.filter(part__name="Disque de frein").order_by("id")
        self.assertEqual([(p.status, p.priority, p.quantity, p.requested_date, p.notes) for p in brakes], [
            (S.LIVRE, "high", 2, date(2026, 9, 1), "Reçu en avance"),
            (S.LIVRE, "high", 2, None, ""),
        ])
        part = brakes[0].part
        self.assertEqual(
            (part.category, part.description, part.material, part.process, part.subsystem, part.org_unit),
            (PartCategory.BRAKES, "Ø 220 mm", "Acier", "Découpe laser", None, None),
        )
        rack = purchases.get(part__name="Crémaillère")
        self.assertEqual((rack.status, rack.priority, rack.quantity, rack.requested_date), (S.A_COMMANDER, "low", 1, date(2026, 11, 15)))
        self.assertEqual((rack.part.category, rack.suggested_supplier.name), (PartCategory.STEERING, "Usinage Fictif"))
        self.assertEqual(rack.notes, "Prix dans la fiche : 1200 DA l'unité, 500 DA de livraison et de douane.")
        drills = purchases.get(part__name="Forets")
        self.assertEqual((drills.status, drills.priority, drills.quantity), (S.A_COMMANDER, None, 1))
        self.assertEqual((drills.part.category, drills.suggested_supplier.name), (PartCategory.WORKSHOP, "aliexpress.com"))
        self.assertEqual(drills.notes.splitlines(), [
            "Quantité dans la fiche : Plusieurs",
            "Fournisseur choisi dans la fiche : https://fr.aliexpress.com/item/123.html",
            "Statut absent de la fiche.",
        ])
        tube = purchases.get(part__name="Tube carré")
        self.assertEqual((tube.status, tube.quantity, tube.part.category), (S.LIVRE, 1, PartCategory.OTHER))
        self.assertEqual(tube.notes.splitlines(), ["Quantité dans la fiche : 2 x 1 m", "Catégorie dans la fiche : Mystère"])
        boxes = purchases.get(part__name="Cartons")
        self.assertEqual((boxes.status, boxes.quantity, boxes.part.category), (S.A_COMMANDER, 10, PartCategory.OPERATIONS))
        self.assertEqual(boxes.suggested_supplier.name, "Fournitures Exemple")  # "Ets Fournitures Exemple"
        self.assertEqual(
            boxes.notes,
            "Indiquée « En commande » dans la fiche, sans fournisseur ou sans prix : la commande est à saisir dans l'ERP.",
        )
        plate = purchases.get(part__name="Plaque")
        self.assertEqual((plate.part.category, plate.part.material), (PartCategory.CHASSIS_BODY, "Alu 5754"))
        self.assertEqual(plate.notes.splitlines(), ["Payé en espèces", "Autre statut dans la fiche : urgent"])
        cable = purchases.get(part__name="Câble")
        self.assertEqual((cable.status, cable.priority, cable.quantity, cable.part.category), (S.LIVRE, "low", 1, PartCategory.LOW_VOLTAGE))
        self.assertEqual(cable.notes.splitlines(), ["Quantité dans la fiche : 2,5", "Date demandée dans la fiche : bientôt"])
        self.assertEqual(purchases.get(part__name="Rotule M8").part.category, PartCategory.SUSPENSION)

    def test_orders_for_the_ordered_and_delivered_rows_with_a_supplier_and_a_price(self):
        output = self.run_import()
        self.assertIn('  suppliers added from "Fournisseur choisi": 2 (from a web link: 1)', output)
        orders = PurchaseOrder.objects.select_related("purchase_request__part", "supplier").order_by("id")
        self.assertEqual(
            [
                (o.purchase_request.part.name, o.supplier.name, o.status, o.unit_price, o.delivery_cost, o.customs_cost,
                 o.total_price, o.total_price_dzd, o.currency, o.exchange_rate, o.ordered_at, o.actual_delivery_date)
                for o in orders
            ],
            [
                ("Disque de frein", "Tôlerie Fictive", S.LIVRE, 1500, 300, 0, 3300, 3300, Currency.DZD, 1, None, None),
                ("Disque de frein", "Tôlerie Fictive", S.LIVRE, 1500, 300, 0, 3300, 3300, Currency.DZD, 1, None, None),
                ("Rotule M8", "Roulements Nouveaux", S.EN_COMMANDE, 250, 0, 0, 1000, 1000, Currency.DZD, 1, None, None),
                # 1 × 800: the sheet said 900.
                ("Plaque", "Tôlerie Fictive", S.LIVRE, 800, 0, 0, 800, 800, Currency.DZD, 1, None, None),
            ],
        )
        for order in orders:
            self.assertEqual(order.purchase_request.status, order.status)
        # The past deliveries are not put in stock: they may well be used up.
        self.assertFalse(StockMovement.objects.exists())

    def test_an_imported_order_is_received_in_the_erp(self):
        self.run_import()
        ball_joints = PurchaseRequest.objects.get(part__name="Rotule M8")
        client = APIClient()
        client.force_authenticate(self.t.coordinator)
        response = client.post(f"/api/purchasing/requests/{ball_joints.pk}/receive/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(StockItem.objects.get(part=ball_joints.part).quantity_available, 4)

    def test_a_supplier_named_in_another_script_is_imported(self):
        self.suppliers.append(["Validée", "ورشة الأمثلة", "Usinage", None, None, None, None, None, None, None])
        output = self.run_import()
        self.assertIn("Suppliers - added: 8, already in the ERP: 1, repeated in the sheet: 1, without a name: 2", output)
        self.assertEqual(Supplier.objects.get(name="ورشة الأمثلة").type, SupplierType.USINAGE)

    def test_a_value_too_long_for_its_field_is_shortened_and_flagged(self):
        self.suppliers[0][6] = "tolerie@example.invalid / " + " / ".join(["0555 00 01 02"] * 5)
        self.parts[2][1] = "Rotule M8 " + "à rotule " * 40
        output = self.run_import()
        self.assertIn("Values shortened to fit the ERP's fields: 2", output)
        tolerie = Supplier.objects.get(name="Tôlerie Fictive")
        self.assertEqual((len(tolerie.phone), tolerie.phone[-1]), (50, "…"))
        flag = "Texte raccourci à l'import (trop long pour l'ERP) : voir la fiche de sous-traitance."
        self.assertEqual(tolerie.comments.splitlines(), ["Livre vite", flag])
        ball_joints = PurchaseRequest.objects.get(part__name__startswith="Rotule M8")
        self.assertEqual(len(ball_joints.part.name), 255)
        self.assertEqual(ball_joints.notes, flag)
        # Shortened the same way next time: not imported twice.
        self.assertIn("Purchase requests - added: 0, imported before: 9", self.run_import())

    def test_a_web_link_goes_to_the_site_s_supplier_when_it_is_known(self):
        known = Supplier.objects.create(name="AliExpress")
        output = self.run_import()
        self.assertEqual(PurchaseRequest.objects.get(part__name="Forets").suggested_supplier, known)
        self.assertIn('  suppliers added from "Fournisseur choisi": 1 (from a web link: 0)', output)

    def test_a_supplier_without_a_name_gets_a_provisional_one(self):
        output = self.run_import()
        self.assertIn("  without a name - added under a provisional name: 1, left out (nothing to name them by): 1", output)
        provisional = Supplier.objects.get(name="Peinture – sans nom (fiche, ligne 9)")
        self.assertEqual((provisional.type, provisional.technical_capabilities), (SupplierType.FOURNISSEUR, "Peinture, sablage"))
        self.assertIn(NAME_GUESSED, provisional.comments.splitlines())
        self.run_import()  # found again by its name: not added twice
        self.assertEqual(Supplier.objects.filter(name__contains="sans nom").count(), 1)

    def test_contacted_by_is_guessed_and_marked_to_check(self):
        # The only Yanis in Operations; "Sofianne" written for Sofiane.
        Membership.objects.create(
            member=self.yanis_autre, org_unit=self.t.operations, role=Role.objects.get(code=LOGISTICS_ROLE),
        )
        output = self.run_import()
        pieces = Supplier.objects.get(name="Pièces Exemple")
        self.assertEqual(pieces.contacted_by, self.yanis_autre)
        self.assertIn(CONTACT_HOMONYM, pieces.comments.splitlines())
        provisional = Supplier.objects.get(name__contains="sans nom")
        self.assertEqual(provisional.contacted_by, self.sofiane)
        self.assertEqual(provisional.comments.splitlines()[-2:], [NAME_GUESSED, CONTACT_SPELLING])
        self.assertIsNone(Supplier.objects.get(name="Fournitures Exemple").contacted_by)  # "Lina": the demo's only
        self.assertIn(
            "  contacted by - linked to a member: 4, guessed (marked to check): 2, several possible members "
            "(left empty): 0, no member found (left empty): 1",
            output,
        )
        self.assertIn("  contacted by, guessed - the only homonym in Operations: 1, written differently: 1", output)

    def test_a_chosen_supplier_close_to_a_sheet_supplier_is_that_one(self):
        output = self.run_import()
        boxes = PurchaseRequest.objects.get(part__name="Cartons")
        self.assertEqual(boxes.suggested_supplier.name, "Fournitures Exemple")
        self.assertFalse(Supplier.objects.filter(name="Ets Fournitures Exemple").exists())
        transport = Supplier.objects.get(name="Fournitures Exemple")
        self.assertIn(MERGED.format(name="Ets Fournitures Exemple"), transport.comments.splitlines())
        self.assertIn(
            "  \"Fournisseur choisi\" taken for the sheet's supplier of a close name (marked to check): 1", output
        )
        self.run_import()  # once only
        self.assertEqual(Supplier.objects.get(pk=transport.pk).comments, transport.comments)

    def test_a_close_name_is_merged_only_when_it_fits_one_supplier(self):
        self.run_import()
        work = SheetImport(requester=None)
        self.assertIsNone(work.close_supplier("Ets Fictif"))  # "Usinage Fictif" and "Transport Fictif": no guess
        self.assertEqual(work.close_supplier("Fournitures Exemple SARL").name, "Fournitures Exemple")

    def test_the_type_of_the_other_chosen_suppliers_is_guessed(self):
        output = self.run_import()
        found = dict(Supplier.objects.filter(comments__startswith=CHOSEN_SUPPLIER_COMMENT).values_list("name", "type"))
        self.assertEqual(found, {"Roulements Nouveaux": SupplierType.USINAGE, "aliexpress.com": SupplierType.FOURNISSEUR})
        self.assertIn("  type guessed for the others (marked to check) - supplier: 1, subcontractor: 0, machining: 1", output)

    def test_running_it_again_adds_only_what_is_missing(self):
        self.run_import()
        before = self.counts()
        output = self.run_import()
        self.assertEqual(self.counts(), before)
        for line in [
            "Suppliers - added: 0, already in the ERP: 8, repeated in the sheet: 1, without a name: 2",
            "Shipping addresses - added: 0, already in the ERP: 3, without an address: 1",
            "Purchase requests - added: 0, imported before: 9, rows without a part name: 1",
            "Purchase orders - added: 0 (in DA, rate 1), total different from the sheet: 0",
        ]:
            self.assertIn(line, output)
        # The sheet goes on: the brake disc a third time, a new part, a status changed on an imported row.
        self.parts.append(list(PART_ROWS[0]))
        self.parts.append(["SUS", "Ressort", None, 2, None, None, None, None, None, None, "P2", None, None, None,
                           "A commander", None])
        self.parts[3][14] = "Livré"
        output = self.run_import()
        self.assertIn("Purchase requests - added: 2, imported before: 9, rows without a part name: 1", output)
        self.assertEqual(PurchaseRequest.objects.filter(part__name="Disque de frein").count(), 3)
        self.assertTrue(PurchaseRequest.objects.filter(part__name="Ressort").exists())
        self.assertEqual(PurchaseRequest.objects.get(part__name="Crémaillère").status, S.A_COMMANDER)  # left as it was

    def test_another_requester_may_be_named(self):
        output = self.run_import("--requested-by", "COORDINATOR@example.invalid")
        self.assertEqual(set(PurchaseRequest.objects.values_list("requested_by", flat=True)), {self.t.coordinator.pk})
        self.assertIn(f"Requested by: member #{self.t.coordinator.pk} (--requested-by)", output)
        with self.assertRaisesMessage(CommandError, "No member has this e-mail address"):
            self.run_import("--requested-by", "nobody@example.invalid")

    def test_without_a_single_head_of_operations_the_requester_must_be_named(self):
        Membership.objects.filter(member=self.t.ops_head).update(end_date=timezone.localdate())
        with self.assertRaisesMessage(CommandError, "--requested-by"):
            self.run_import("--dry-run")

    def test_a_failure_saves_nothing(self):
        before = self.counts()
        with mock.patch.object(PurchaseOrder, "save", side_effect=RuntimeError("disk full")):
            with self.assertRaises(RuntimeError):
                self.run_import()
        self.assertEqual(self.counts(), before)

    def test_an_unreadable_or_changed_workbook_is_refused(self):
        with self.assertRaisesMessage(CommandError, "File not found"):
            self.run_import(path=self.folder / "missing.xlsx")
        text = self.folder / "notes.xlsx"
        text.write_text("not a workbook", encoding="utf-8")
        with self.assertRaisesMessage(CommandError, "Not an Excel workbook"):
            self.run_import(path=text)
        with self.assertRaisesMessage(CommandError, 'Sheet "shipping adress" not found'):
            self.run_import(path=self.workbook("partial.xlsx", self.sheets()[:2]))
        titles = list(PARTS_TITLES)
        titles[3] = "Qté"
        changed = self.workbook("changed.xlsx", [("Pièces & Commandes", titles, self.parts), *self.sheets()[1:]])
        with self.assertRaisesMessage(CommandError, 'column D: expected a title starting with "quantite", found "Qté"'):
            self.run_import(path=changed)
        self.assertFalse(PurchaseRequest.objects.exists())
