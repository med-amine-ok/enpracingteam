"""Grouped orders and partial deliveries (decision D-023): several requests ordered together from one
supplier, and the parts of an order arriving in several deliveries."""

from decimal import Decimal

from django.test import SimpleTestCase

from apps.communication.models import Notification, NotificationKind
from apps.finance.models import Expense
from apps.inventory.models import StockItem, StockMovement

from .models import Part, PartCategory, PurchaseAction, PurchaseOrder, PurchaseRequestEvent, Supplier
from .tests import A, S, PurchasingApiTestCase
from .workflow import shares


class SharesTests(SimpleTestCase):
    """The costs paid once for a grouped order are shared out to the centime, never more nor less."""

    def test_in_proportion_to_the_prices(self):
        self.assertEqual(shares(Decimal("16.00"), [Decimal(40), Decimal(120)]), [Decimal("4.00"), Decimal("12.00")])

    def test_evenly_while_no_price_is_known_the_last_share_taking_the_rest(self):
        self.assertEqual(
            shares(Decimal("10.00"), [Decimal(0)] * 3), [Decimal("3.33"), Decimal("3.33"), Decimal("3.34")]
        )

    def test_never_a_negative_share(self):
        result = shares(Decimal("0.01"), [Decimal(1), Decimal(1), Decimal(0)])
        self.assertEqual(sum(result), Decimal("0.01"))
        self.assertTrue(all(share >= 0 for share in result), result)


class PartialDeliveryTests(PurchasingApiTestCase):
    """The parts of an order may arrive in several deliveries: each one enters the stock at once."""

    def events(self, purchase_id):
        return [
            (event.action, event.status, event.quantity)
            for event in PurchaseRequestEvent.objects.filter(purchase_request_id=purchase_id).order_by("id")
        ][-2:]

    def test_the_parts_arrive_in_several_deliveries(self):
        purchase_id = self.ordered()  # 4 cells
        first = self.done(purchase_id, "receive", self.t.coordinator, quantity=1, location="Shelf B2")
        self.assertEqual((first["status"], first["order"]["status"], first["order"]["quantity_received"]),
                         ("en_commande", "en_commande", 1))
        self.assertEqual(StockItem.objects.get(part=self.t.cells).quantity_available, 1)
        self.assertFalse(Expense.objects.exists())  # paid once complete
        too_many = self.act(purchase_id, "receive", self.t.coordinator, quantity=4)
        self.assertEqual(too_many.status_code, 400)
        self.assertIn("3", too_many.json()["quantity"])
        rest = self.done(purchase_id, "receive", self.t.coordinator, location="Shelf B2")  # the 3 still to come
        self.assertEqual((rest["status"], rest["order"]["quantity_received"]), ("livre", 4))
        self.assertEqual(StockItem.objects.get(part=self.t.cells).quantity_available, 4)
        self.assertEqual(StockMovement.objects.filter(related_purchase_order__purchase_request_id=purchase_id).count(), 2)
        self.assertEqual(self.events(purchase_id), [(A.PARTLY_RECEIVED, S.EN_COMMANDE, 1), (A.RECEIVED, S.LIVRE, 3)])
        self.assertEqual(Expense.objects.get().amount, Decimal("11750.00"))  # (4 x 10 + 5 + 2) EUR x 250

    def test_the_requester_is_told_what_arrived(self):
        purchase_id = self.ordered()
        self.done(purchase_id, "receive", self.t.coordinator, quantity=3)
        told = Notification.objects.filter(member=self.t.engineer, kind=NotificationKind.PURCHASE_UPDATED).latest("id")
        self.assertEqual((told.data["action"], told.data["received"], told.data["quantity"]), ("partly_received", 3, 4))

    def test_once_parts_arrived_the_order_is_closed_with_them_not_cancelled(self):
        purchase_id = self.ordered()
        self.assertEqual(self.act(purchase_id, "close-order", self.t.coordinator, reason="x").status_code, 409)
        self.done(purchase_id, "receive", self.t.coordinator, quantity=3)
        rights = self.detail(purchase_id, self.t.coordinator)["permissions"]
        self.assertEqual((rights["cancel"], rights["cancel_order"], rights["close_order"]), (False, False, True))
        self.assertEqual(self.act(purchase_id, "cancel", self.t.coordinator, reason="x").status_code, 409)
        self.assertEqual(self.act(purchase_id, "cancel-order", self.t.coordinator, reason="x").status_code, 409)
        self.assertEqual(self.act(purchase_id, "close-order", self.t.engineer, reason="x").status_code, 403)
        self.assertEqual(self.act(purchase_id, "close-order", self.t.coordinator).status_code, 400)  # no reason

        closed = self.done(purchase_id, "close-order", self.t.coordinator, reason="The last cell is out of stock")
        self.assertEqual((closed["status"], closed["order"]["status"]), ("livre", "livre"))
        # Only the 3 cells that arrived are paid: 3 x 10 + 5 + 2 EUR, at 250 DA.
        self.assertEqual((closed["order"]["total_price"], closed["order"]["total_price_dzd"]), ("37.00", "9250.00"))
        self.assertEqual(Expense.objects.get().amount, Decimal("9250.00"))
        last = PurchaseRequestEvent.objects.filter(purchase_request_id=purchase_id).latest("id")
        self.assertEqual(
            (last.action, last.status, last.quantity, last.comment),
            (A.CLOSED_SHORT, S.LIVRE, 3, "The last cell is out of stock"),
        )


class GroupedOrderTests(PurchasingApiTestCase):
    """Operations order several requests together from one supplier; the costs paid once are shared."""

    def two_to_order(self):
        motors = Part.objects.create(
            name="Motor mounts", category=PartCategory.CHASSIS_BODY, subsystem=self.t.battery, org_unit=self.t.electronics
        )
        first = self.to_order()  # 4 cells
        second = self.asked(part_id=motors.id)  # 4 mounts
        self.done(second, "approve", self.t.lead)
        self.done(second, "approve", self.t.ops_head)
        return first, second

    def order_together(self, member, lines, **shared):
        self.as_member(member)
        body = {
            "supplier_id": self.t.supplier.id, "currency": "DZD", "delivery_cost": "16", "customs_cost": "8",
            "lines": lines, **shared,
        }
        return self.client.post("/api/purchasing/order-batches/", body, format="json")

    def test_operations_order_several_requests_together_and_share_the_costs(self):
        first, second = self.two_to_order()
        response = self.order_together(
            self.t.coordinator, [{"request_id": first, "unit_price": "10"}, {"request_id": second, "unit_price": "30"}]
        )
        self.assertEqual(response.status_code, 201, response.content)
        batch = response.json()
        self.assertEqual([row["id"] for row in batch["requests"]], [first, second])
        self.assertEqual(batch["supplier"]["id"], self.t.supplier.id)
        orders = {order.purchase_request_id: order for order in PurchaseOrder.objects.filter(batch_id=batch["id"])}
        # Values 40 and 120: a quarter and three quarters of the delivery (16) and of the customs (8).
        self.assertEqual(
            [(orders[pk].delivery_cost, orders[pk].customs_cost, orders[pk].total_price) for pk in (first, second)],
            [(Decimal("4.00"), Decimal("2.00"), Decimal("46.00")), (Decimal("12.00"), Decimal("6.00"), Decimal("138.00"))],
        )
        detail = self.detail(first)
        self.assertEqual((detail["status"], detail["order"]["batch"]), ("en_commande", batch["id"]))
        self.assertEqual([row["part"] for row in detail["grouped_order"]["requests"]], ["Li-ion cells", "Motor mounts"])
        self.assertEqual(self.history(second)[-1], (A.ORDERED, S.EN_COMMANDE, self.t.coordinator.id))

    def test_only_operations_and_only_requests_to_order(self):
        first, second = self.two_to_order()
        lines = [{"request_id": first, "unit_price": "10"}, {"request_id": second, "unit_price": "30"}]
        self.assertEqual(self.order_together(self.t.engineer, lines).status_code, 403)
        self.assertEqual(self.order_together(self.t.coordinator, lines[:1]).status_code, 400)  # one: order it alone
        self.assertEqual(self.order_together(self.t.coordinator, [lines[0], lines[0]]).status_code, 400)
        waiting = self.asked()  # still awaits its leader
        late = self.order_together(self.t.coordinator, [lines[0], {"request_id": waiting, "unit_price": "1"}])
        self.assertEqual(late.status_code, 409)
        self.assertFalse(PurchaseOrder.objects.exists())  # nothing ordered

    def test_what_the_requests_share_changes_for_all_of_them(self):
        first, second = self.two_to_order()
        batch = self.order_together(
            self.t.coordinator, [{"request_id": first, "unit_price": "10"}, {"request_id": second, "unit_price": "30"}]
        ).json()
        other = Supplier.objects.create(name="Other Test Supplier")
        self.as_member(self.t.coordinator)
        changed = self.client.patch(
            f"/api/purchasing/requests/{first}/order/", {"supplier_id": other.id, "unit_price": "12"}, format="json"
        )
        self.assertEqual(changed.status_code, 200, changed.content)
        orders = {order.purchase_request_id: order for order in PurchaseOrder.objects.filter(batch_id=batch["id"])}
        self.assertEqual((orders[first].supplier, orders[second].supplier), (other, other))
        self.assertEqual((orders[first].unit_price, orders[second].unit_price), (Decimal("12.00"), Decimal("30.00")))

    def test_the_whole_grouped_order_is_received_at_once(self):
        first, second = self.two_to_order()
        batch = self.order_together(
            self.t.coordinator, [{"request_id": first, "unit_price": "10"}, {"request_id": second, "unit_price": "30"}]
        ).json()
        self.done(first, "receive", self.t.coordinator, quantity=1)
        url = f"/api/purchasing/order-batches/{batch['id']}/receive/"
        self.as_member(self.t.engineer)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 403)
        self.as_member(self.t.coordinator)
        received = self.client.post(url, {"location": "Shelf C1"}, format="json")
        self.assertEqual(received.status_code, 200, received.content)
        self.assertEqual(
            [(row["status"], row["quantity_received"]) for row in received.json()["requests"]], [("livre", 4), ("livre", 4)]
        )
        self.assertFalse(received.json()["can_receive"])
        self.assertEqual(StockItem.objects.get(part=self.t.cells, location="Shelf C1").quantity_available, 3)
        self.assertEqual(Expense.objects.count(), 2)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 409)
        self.assertEqual(
            PurchaseRequestEvent.objects.filter(action=PurchaseAction.RECEIVED).count(), 2
        )
