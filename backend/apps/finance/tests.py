from datetime import UTC, date, datetime
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APITestCase

from apps.communication.models import Notification, NotificationKind
from apps.finance.access import BUREAU_UNIT, TREASURER_ROLE
from apps.finance.models import Budget, Expense, ExpenseCategory, Sponsorship, SponsorshipStatus
from apps.members.models import Member, MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.work_fixtures import build_team, person
from apps.purchasing.access import LOGISTICS_ROLE, OPERATIONS_UNIT
from apps.purchasing.models import (
    Part, PurchaseAction, PurchaseOrder, PurchaseRequest, PurchaseRequestEvent, PurchaseStatus, Supplier,
)


class ExpenseDateTests(TestCase):
    """The expense date is the day the money was spent, often before it is entered (bug #9)."""

    def setUp(self):
        unit = OrgUnit.objects.create(name="ENP Racing Team", code="enp-racing-team", type=OrgUnitType.ROOT)
        self.budget = Budget.objects.create(org_unit=unit, fiscal_year="2026-2027", allocated_amount=100000)
        self.member = Member.objects.create_user(
            email="treasurer@g.enp.edu.dz", first_name="Tre", last_name="Surer", password=None,
        )

    def test_past_expense_date_is_kept(self):
        expense = Expense.objects.create(
            budget=self.budget, amount=1500, recorded_by=self.member, recorded_at=date(2026, 9, 1),
        )
        expense.refresh_from_db()
        self.assertEqual(expense.recorded_at, date(2026, 9, 1))
        self.assertTrue(Expense._meta.get_field("recorded_at").editable)  # shown in the admin form

    def test_expense_date_defaults_to_today_in_algiers(self):
        # 23:30 UTC on 17/10 is already 18/10 in Algiers.
        with patch("django.utils.timezone.now", return_value=datetime(2026, 10, 17, 23, 30, tzinfo=UTC)):
            expense = Expense.objects.create(budget=self.budget, amount=1500, recorded_by=self.member)
        self.assertEqual(expense.recorded_at, date(2026, 10, 18))


class FinanceLabelsTests(TestCase):
    """Finance names and statuses are translated."""

    def test_expense_without_category_shows_a_translated_word(self):
        from django.utils import translation

        expense = Expense(amount=Decimal("1500.00"), category="")
        names = {}
        for language in ("en", "fr", "ar"):
            with translation.override(language):
                names[language] = str(expense)
        self.assertEqual(names["en"], "1500.00 - expense")
        self.assertEqual(len(set(names.values())), 3, names)

    def test_sponsorship_statuses_are_masculine_in_french(self):
        from django.utils import translation

        with translation.override("fr"):
            self.assertEqual(str(SponsorshipStatus.CONFIRMED.label), "Confirmé")  # le sponsor


class FinanceYearTests(SimpleTestCase):
    """The club's budget year runs from 1 September to 31 August (knowledge base: finance_design.md §10)."""

    def test_the_club_year_runs_from_september_to_august(self):
        from apps.finance.years import fiscal_year_bounds, fiscal_year_of

        self.assertEqual(fiscal_year_of(date(2026, 10, 15)), "2026-2027")
        self.assertEqual(fiscal_year_of(date(2026, 9, 1)), "2026-2027")
        self.assertEqual(fiscal_year_of(date(2026, 8, 31)), "2025-2026")
        self.assertEqual(fiscal_year_bounds("2026-2027"), (date(2026, 9, 1), date(2027, 8, 31)))

    def test_a_year_is_two_following_years(self):
        from apps.finance.years import is_fiscal_year

        self.assertTrue(is_fiscal_year("2026-2027"))
        for wrong in ("2026", "2026-2028", "2027-2026", "abcd-efgh", "2026/2027", ""):
            self.assertFalse(is_fiscal_year(wrong), wrong)


# --- The finance API (knowledge base: PROJECTS/ERP/finance_design.md §10, decision D-011) ---


def build_finance():
    """build_team() (apps/projects/work_fixtures.py) plus the people of the finance rules and three
    budgets for 2026-2027.

    Executive Bureau: `treasurer` holds the Treasurer role, `bureau` is a bureau member. Operations &
    Partnerships: `ops_head` heads it, `coordinator` is a logistics coordinator, `junior` a junior
    member. Budgets 2026-2027: FS Team 900 000 DA, Electronics 200 000 DA, Aerodynamics 100 000 DA; none
    for the Projects Office. `chassis`: a unit under the FS Team without a budget.
    """
    t = build_team()
    t.bureau_unit = OrgUnit.objects.create(code=BUREAU_UNIT, name="Executive Bureau", type=OrgUnitType.GOVERNING_BODY)
    t.operations = OrgUnit.objects.create(
        code=OPERATIONS_UNIT, name="Operations & Partnerships", type=OrgUnitType.CLUB_DEPARTMENT
    )
    t.chassis = OrgUnit.objects.create(code="t-chassis", name="Chassis", type=OrgUnitType.FS_DEPARTMENT, parent=t.fs_team)

    def role(code, name, role_type, leadership=False):
        return Role.objects.create(code=code, name=name, role_type=role_type, scope=RoleScope.CLUB, is_leadership=leadership)

    t.treasurer_role = role(TREASURER_ROLE, "Treasurer", MemberRoleType.ADMIN, leadership=True)
    bureau_role = role("t-bureau-member", "Executive Bureau Member", MemberRoleType.ADMIN, leadership=True)
    ops_lead = role("t-operations-lead", "Operations Lead", MemberRoleType.HEAD_OF_DEPARTMENT, leadership=True)
    logistics = role(LOGISTICS_ROLE, "Logistics Coordinator", MemberRoleType.MEMBER)
    club_member = role("t-club-member", "Member", MemberRoleType.MEMBER)

    t.treasurer, t.bureau, t.ops_head, t.coordinator, t.junior = (
        person("treasurer"), person("bureau"), person("opshead"), person("coordinator"), person("junior")
    )
    Membership.objects.create(member=t.treasurer, org_unit=t.bureau_unit, role=t.treasurer_role)
    Membership.objects.create(member=t.bureau, org_unit=t.bureau_unit, role=bureau_role)
    Membership.objects.create(member=t.ops_head, org_unit=t.operations, role=ops_lead)
    Membership.objects.create(member=t.coordinator, org_unit=t.operations, role=logistics, member_level="main")
    Membership.objects.create(member=t.junior, org_unit=t.operations, role=club_member, member_level="junior")

    year = "2026-2027"
    t.fs_budget = Budget.objects.create(org_unit=t.fs_team, fiscal_year=year, allocated_amount=900000)
    t.elec_budget = Budget.objects.create(org_unit=t.electronics, fiscal_year=year, allocated_amount=200000)
    t.aero_budget = Budget.objects.create(org_unit=t.aero, fiscal_year=year, allocated_amount=100000)
    t.supplier = Supplier.objects.create(name="Parts Co")
    return t


def ordered(t, unit, price="1000.00", quantity=2, ordered_on=date(2026, 10, 1), currency="DZD", rate="1"):
    """A purchase request for `unit`, ordered from t.supplier: `quantity` parts at `price` each (None:
    the price is not known)."""
    part = Part.objects.create(name=f"Part {Part.objects.count() + 1}")
    purchase = PurchaseRequest.objects.create(
        part=part, requested_by=t.engineer, quantity=quantity, org_unit=unit, status=PurchaseStatus.EN_COMMANDE
    )
    PurchaseOrder.objects.create(
        purchase_request=purchase, supplier=t.supplier, currency=currency, exchange_rate=Decimal(rate),
        unit_price=None if price is None else Decimal(price), ordered_at=ordered_on, status=PurchaseStatus.EN_COMMANDE,
    )
    return purchase


class FinanceApiTestCase(APITestCase):
    YEAR = "2026-2027"

    @classmethod
    def setUpTestData(cls):
        cls.t = build_finance()

    def as_member(self, member):
        self.client.force_authenticate(member)

    def get(self, member, url):
        self.as_member(member)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def send(self, member, method, url, data=None):
        self.as_member(member)
        return getattr(self.client, method)(url, data, format="json")

    def budgets(self, member, year=YEAR):
        listed = self.get(member, f"/api/finance/budgets/?year={year}")["results"]
        return {budget["org_unit"]["name"]: budget for budget in listed}

    def budget(self, member, budget):
        return self.get(member, f"/api/finance/budgets/{budget.id}/")

    def expenses(self, member, query=""):
        return self.get(member, f"/api/finance/expenses/{query}")["results"]

    def summary(self, member, year=YEAR):
        return self.get(member, f"/api/finance/summary/?year={year}")

    def receive(self, purchase, day, member=None):
        response = self.send(
            member or self.t.coordinator, "post", f"/api/purchasing/requests/{purchase.id}/receive/",
            {"actual_delivery_date": day.isoformat()},
        )
        self.assertEqual(response.status_code, 200, response.content)

    def expense_of(self, purchase):
        return Expense.objects.filter(purchase_order__purchase_request=purchase).first()


class BudgetVisibilityTests(FinanceApiTestCase):
    """The leaders see the budgets of their units; the bureau, Operations, the treasurer and the
    admins see them all; the other members see none."""

    def test_needs_login(self):
        self.assertEqual(self.client.get("/api/finance/budgets/").status_code, 401)

    def test_who_sees_which_budgets(self):
        everything = {"FS Team", "Electronics", "Aerodynamics"}
        expected = {
            self.t.admin: everything, self.t.treasurer: everything, self.t.bureau: everything,
            self.t.ops_head: everything, self.t.coordinator: everything,
            self.t.manager: everything,  # the project manager of a project of the FS Team, and below it
            self.t.lead: {"Electronics"},  # the leader of Electronics
            self.t.engineer: set(), self.t.teammate: set(), self.t.outsider: set(), self.t.junior: set(),
        }
        for member, units in expected.items():
            self.assertEqual(set(self.budgets(member)), units, member.first_name)
        self.as_member(self.t.lead)
        self.assertEqual(self.client.get(f"/api/finance/budgets/{self.t.aero_budget.id}/").status_code, 404)

    def test_a_budget_shows_what_is_left(self):
        electronics = self.budgets(self.t.lead)["Electronics"]
        self.assertEqual(
            {key: electronics[key] for key in ("fiscal_year", "allocated_amount", "spent", "committed", "remaining")},
            {"fiscal_year": "2026-2027", "allocated_amount": "200000.00", "spent": "0.00", "committed": "0.00",
             "remaining": "200000.00"},
        )
        self.assertEqual((electronics["spent_percent"], electronics["is_over"], electronics["will_exceed"]), (0.0, False, False))
        self.assertEqual(electronics["parent_unit_id"], self.t.fs_team.id)

    def test_the_summary_says_what_each_one_may_do(self):
        fields = ("can_manage", "can_see_all", "can_see_budgets", "can_see_sponsors", "can_manage_sponsors", "budgets")
        expected = {
            self.t.admin: (True, True, True, True, True, 3),
            self.t.treasurer: (True, True, True, True, False, 3),
            self.t.bureau: (False, True, True, True, False, 3),
            self.t.ops_head: (False, True, True, True, True, 3),
            self.t.coordinator: (False, True, True, True, True, 3),
            self.t.manager: (False, False, True, False, False, 3),
            self.t.lead: (False, False, True, False, False, 1),
            self.t.engineer: (False, False, False, False, False, 0),
            self.t.junior: (False, False, False, False, False, 0),
        }
        for member, rights in expected.items():
            summary = self.summary(member)
            self.assertEqual(tuple(summary[field] for field in fields), rights, member.first_name)
            self.assertEqual(summary["fiscal_year"], "2026-2027")
            self.assertEqual(summary["to_impute"], 0 if summary["can_see_all"] else None, member.first_name)

    def test_a_former_treasurer_manages_nothing(self):
        former = person("formertreasurer")
        Membership.objects.create(
            member=former, org_unit=self.t.bureau_unit, role=self.t.treasurer_role,
            start_date=date(2025, 9, 1), end_date=date(2026, 8, 31), is_primary=False,
        )
        self.assertFalse(self.summary(former)["can_manage"])
        self.assertEqual(self.budgets(former), {})


class BudgetManagingTests(FinanceApiTestCase):
    """The treasurer and the admins set the budgets."""

    def create(self, member, **data):
        return self.send(member, "post", "/api/finance/budgets/", data)

    def test_the_treasurer_and_the_admins_set_the_budgets(self):
        response = self.create(
            self.t.treasurer, org_unit=self.t.office.id, fiscal_year=self.YEAR, allocated_amount="50000",
            notes="Voted at the general assembly",
        )
        self.assertEqual(response.status_code, 201, response.content)
        created = response.json()
        self.assertEqual((created["org_unit"]["name"], created["allocated_amount"], created["spent"], created["notes"]),
                         ("Projects Office", "50000.00", "0.00", "Voted at the general assembly"))
        self.assertEqual(self.create(self.t.admin, org_unit=self.t.office.id, fiscal_year="2027-2028",
                                     allocated_amount="1").status_code, 201)
        for member in (self.t.ops_head, self.t.bureau, self.t.lead, self.t.manager):
            response = self.create(member, org_unit=self.t.aero.id, fiscal_year="2027-2028", allocated_amount="10")
            self.assertEqual(response.status_code, 403, member.first_name)

    def test_one_budget_per_unit_and_year_and_a_real_year_and_amount(self):
        self.assertEqual(self.create(self.t.treasurer, org_unit=self.t.electronics.id, fiscal_year=self.YEAR,
                                     allocated_amount="5").status_code, 400)
        for wrong in ("2026", "2026-2028"):
            response = self.create(self.t.treasurer, org_unit=self.t.office.id, fiscal_year=wrong, allocated_amount="5")
            self.assertEqual(response.status_code, 400, wrong)
            self.assertIn("fiscal_year", response.json())
        response = self.create(self.t.treasurer, org_unit=self.t.office.id, fiscal_year=self.YEAR, allocated_amount="-5")
        self.assertEqual(response.status_code, 400)

    def test_changing_the_amount_but_not_the_unit_or_the_year(self):
        url = f"/api/finance/budgets/{self.t.aero_budget.id}/"
        response = self.send(self.t.treasurer, "patch", url, {"allocated_amount": "120000", "fiscal_year": "2030-2031"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["allocated_amount"], response.json()["fiscal_year"]), ("120000.00", "2026-2027"))
        self.assertEqual(self.send(self.t.lead, "patch", url, {"allocated_amount": "1"}).status_code, 403)
        self.assertEqual(self.send(self.t.ops_head, "patch", url, {"allocated_amount": "1"}).status_code, 403)

    def test_a_budget_page_shows_its_units_below_and_the_total_with_them(self):
        detail = self.budget(self.t.manager, self.t.fs_budget)
        self.assertEqual([child["org_unit"]["name"] for child in detail["children"]], ["Aerodynamics", "Electronics"])
        self.assertEqual(detail["with_children"]["allocated_amount"], "1200000.00")
        self.assertEqual(detail["expenses"], [])
        self.assertEqual(detail["committed_orders"], [])
        # The leader of Electronics does not see the page of the FS Team above it.
        self.as_member(self.t.lead)
        self.assertEqual(self.client.get(f"/api/finance/budgets/{self.t.fs_budget.id}/").status_code, 404)
        self.assertEqual(self.budget(self.t.lead, self.t.elec_budget)["children"], [])


class ExpenseFromDeliveryTests(FinanceApiTestCase):
    """An order becomes an expense of its unit's budget when it is delivered; before, it is committed."""

    def test_a_delivered_order_becomes_an_expense_of_its_unit(self):
        purchase = ordered(self.t, self.t.electronics)
        electronics = self.budgets(self.t.lead)["Electronics"]
        self.assertEqual((electronics["spent"], electronics["committed"], electronics["remaining"]),
                         ("0.00", "2000.00", "198000.00"))
        self.assertEqual(self.budget(self.t.lead, self.t.elec_budget)["committed_orders"][0]["purchase_request_id"], purchase.id)

        self.receive(purchase, date(2026, 10, 15))
        expense = self.expense_of(purchase)
        self.assertEqual(
            (expense.budget, expense.amount, expense.category, expense.recorded_at, expense.recorded_by),
            (self.t.elec_budget, Decimal("2000.00"), ExpenseCategory.PURCHASE, date(2026, 10, 15), self.t.coordinator),
        )
        electronics = self.budgets(self.t.lead)["Electronics"]
        self.assertEqual((electronics["spent"], electronics["committed"], electronics["spent_percent"]),
                         ("2000.00", "0.00", 1.0))
        [listed] = self.expenses(self.t.lead, f"?purchase_request={purchase.id}")
        self.assertEqual((listed["amount"], listed["category"], listed["part"], listed["supplier"], listed["budget"]["id"]),
                         ("2000.00", "purchase", purchase.part.name, "Parts Co", self.t.elec_budget.id))

    def test_a_foreign_currency_counts_in_dinars(self):
        purchase = ordered(self.t, self.t.electronics, price="10.00", quantity=3, currency="EUR", rate="250")
        self.receive(purchase, date(2026, 10, 15))
        self.assertEqual(self.expense_of(purchase).amount, Decimal("7500.00"))

    def test_the_unit_above_pays_when_a_unit_has_no_budget_that_year(self):
        purchase = ordered(self.t, self.t.chassis)
        self.receive(purchase, date(2026, 10, 15))
        self.assertEqual(self.expense_of(purchase).budget, self.t.fs_budget)

    def test_the_year_of_the_delivery_decides(self):
        old = Budget.objects.create(org_unit=self.t.electronics, fiscal_year="2025-2026", allocated_amount=1000)
        purchase = ordered(self.t, self.t.electronics, ordered_on=date(2026, 8, 1))
        self.receive(purchase, date(2026, 8, 31))
        self.assertEqual(self.expense_of(purchase).budget, old)

    def test_without_any_budget_it_waits_to_be_imputed(self):
        purchase = ordered(self.t, self.t.office)
        self.receive(purchase, date(2026, 10, 15))
        expense = self.expense_of(purchase)
        self.assertIsNone(expense.budget)
        [waiting] = self.expenses(self.t.treasurer, "?to_impute=true")
        self.assertEqual((waiting["id"], waiting["budget"], waiting["suggested_unit"]["name"], waiting["fiscal_year"]),
                         (expense.id, None, "Projects Office", "2026-2027"))
        self.assertEqual(self.summary(self.t.treasurer)["to_impute"], 1)
        self.assertEqual(self.expenses(self.t.manager, "?to_impute=true"), [])  # for those who see everything

    def test_one_expense_per_order_and_none_without_a_price(self):
        purchase = ordered(self.t, self.t.electronics, price=None)
        self.receive(purchase, date(2026, 10, 15))
        self.assertIsNone(self.expense_of(purchase))
        priced = ordered(self.t, self.t.electronics)
        self.receive(priced, date(2026, 10, 15))
        order = PurchaseOrder.objects.get(purchase_request=priced)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Expense.objects.create(budget=self.t.elec_budget, purchase_order=order, amount=1, recorded_by=self.t.admin)


class BudgetAlertTests(FinanceApiTestCase):
    """When the expenses go above a budget, its unit's leaders, the treasurer and the admins are told
    once, in the ERP and by e-mail; never the person who acted."""

    def told(self):
        return set(Notification.objects.filter(kind=NotificationKind.BUDGET_EXCEEDED).values_list("member__first_name", flat=True))

    def test_going_over_the_budget_tells_them_once(self):
        self.receive(ordered(self.t, self.t.electronics, price="199000.00", quantity=1), date(2026, 10, 10))
        self.assertEqual(self.told(), set())  # 99.5 %
        with self.captureOnCommitCallbacks(execute=True):
            self.receive(ordered(self.t, self.t.electronics, price="2000.00", quantity=1), date(2026, 10, 12))
        self.assertEqual(self.told(), {"Lead", "Treasurer", "Admin"})
        alert = Notification.objects.filter(kind=NotificationKind.BUDGET_EXCEEDED).first()
        self.assertEqual((alert.related_entity_type, alert.related_entity_id), ("budget", self.t.elec_budget.id))
        self.assertEqual((alert.data["unit"], alert.data["fiscal_year"], alert.data["allocated"], alert.data["spent"]),
                         ("Electronics", "2026-2027", "200000.00", "201000.00"))
        self.assertEqual(sorted(message.to[0] for message in mail.outbox),
                         ["admin@example.invalid", "lead@example.invalid", "treasurer@example.invalid"])
        self.assertIn(f"/finance/budgets/{self.t.elec_budget.id}", mail.outbox[0].body)

        self.receive(ordered(self.t, self.t.electronics, price="500.00", quantity=1), date(2026, 10, 14))
        self.assertEqual(Notification.objects.filter(kind=NotificationKind.BUDGET_EXCEEDED).count(), 3)  # not again
        self.assertTrue(self.budgets(self.t.lead)["Electronics"]["is_over"])

    def test_an_expense_entered_by_hand_can_go_over_too(self):
        response = self.send(self.t.treasurer, "post", "/api/finance/expenses/", {
            "budget": self.t.elec_budget.id, "amount": "250000", "category": "tooling", "description": "Oscilloscope",
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self.told(), {"Lead", "Admin"})  # not the treasurer, who entered it


class ManualExpenseTests(FinanceApiTestCase):
    """The treasurer and the admins enter the other expenses (registration, transport...), with their
    reason; the expense of an order follows its order, but can be imputed to another budget."""

    def add(self, member, **data):
        return self.send(member, "post", "/api/finance/expenses/", data)

    def test_the_treasurer_records_an_expense_with_its_reason(self):
        response = self.add(self.t.treasurer, budget=self.t.fs_budget.id, amount="45000", category="registration",
                            recorded_at="2026-10-05", description="Formula Student registration")
        self.assertEqual(response.status_code, 201, response.content)
        created = response.json()
        self.assertEqual(
            (created["amount"], created["category"], created["recorded_at"], created["description"],
             created["recorded_by"]["id"], created["purchase_request_id"]),
            ("45000.00", "registration", "2026-10-05", "Formula Student registration", self.t.treasurer.id, None),
        )
        self.assertEqual(self.budgets(self.t.treasurer)["FS Team"]["spent"], "45000.00")
        self.assertEqual(self.add(self.t.treasurer, budget=self.t.fs_budget.id, amount="10", category="transport").status_code,
                         400)  # no reason
        self.assertEqual(self.add(self.t.treasurer, budget=self.t.fs_budget.id, amount="10", category="purchase",
                                  description="x").status_code, 400)  # only an order makes a purchase
        for member in (self.t.lead, self.t.ops_head, self.t.bureau):
            response = self.add(member, budget=self.t.fs_budget.id, amount="10", category="transport", description="Bus")
            self.assertEqual(response.status_code, 403, member.first_name)

    def test_changing_and_deleting_an_expense_entered_by_hand(self):
        created = self.add(self.t.treasurer, budget=self.t.fs_budget.id, amount="1000", category="transport",
                           description="Bus").json()
        url = f"/api/finance/expenses/{created['id']}/"
        response = self.send(self.t.treasurer, "patch", url, {"amount": "1200", "category": "accommodation"})
        self.assertEqual((response.status_code, response.json()["amount"], response.json()["category"]),
                         (200, "1200.00", "accommodation"))
        self.assertEqual(self.send(self.t.lead, "delete", url).status_code, 403)
        self.assertEqual(self.send(self.t.admin, "delete", url).status_code, 204)
        self.assertFalse(Expense.objects.filter(pk=created["id"]).exists())

    def test_the_expense_of_an_order_follows_its_order(self):
        purchase = ordered(self.t, self.t.electronics)
        self.receive(purchase, date(2026, 10, 15))
        url = f"/api/finance/expenses/{self.expense_of(purchase).id}/"
        self.assertEqual(self.send(self.t.treasurer, "patch", url, {"amount": "1"}).status_code, 400)
        self.assertEqual(self.send(self.t.treasurer, "delete", url).status_code, 400)
        response = self.send(self.t.treasurer, "patch", url, {"budget": self.t.fs_budget.id})
        self.assertEqual((response.status_code, response.json()["budget"]["id"]), (200, self.t.fs_budget.id))

    def test_imputing_an_expense_that_waited(self):
        purchase = ordered(self.t, self.t.office)
        self.receive(purchase, date(2026, 10, 15))
        url = f"/api/finance/expenses/{self.expense_of(purchase).id}/"
        self.assertEqual(self.send(self.t.ops_head, "patch", url, {"budget": self.t.fs_budget.id}).status_code, 403)
        self.assertEqual(self.send(self.t.treasurer, "patch", url, {"budget": None}).status_code, 400)
        self.assertEqual(self.send(self.t.treasurer, "patch", url, {"budget": self.t.fs_budget.id}).status_code, 200)
        self.assertEqual(self.expenses(self.t.treasurer, "?to_impute=true"), [])
        self.assertEqual(self.summary(self.t.treasurer)["to_impute"], 0)

    def test_the_journal_its_filters_and_what_each_one_sees(self):
        self.receive(ordered(self.t, self.t.electronics), date(2026, 10, 15))
        self.receive(ordered(self.t, self.t.aero), date(2026, 10, 16))
        self.add(self.t.treasurer, budget=self.t.fs_budget.id, amount="300", category="transport",
                 recorded_at="2026-10-17", description="Taxi")

        def amounts(member, query=""):
            return [(e["category"], e["amount"]) for e in self.expenses(member, query)]

        self.assertEqual(amounts(self.t.treasurer), [("transport", "300.00"), ("purchase", "2000.00"), ("purchase", "2000.00")])
        self.assertEqual(amounts(self.t.lead), [("purchase", "2000.00")])  # Electronics only
        self.assertEqual(amounts(self.t.engineer), [])
        self.assertEqual(amounts(self.t.treasurer, "?source=manual"), [("transport", "300.00")])
        self.assertEqual(len(amounts(self.t.treasurer, "?source=purchase")), 2)
        self.assertEqual(amounts(self.t.treasurer, "?category=transport"), [("transport", "300.00")])
        self.assertEqual(len(amounts(self.t.treasurer, f"?unit={self.t.aero.id}")), 1)
        self.assertEqual(amounts(self.t.treasurer, "?year=2025-2026"), [])
        self.assertEqual(len(amounts(self.t.treasurer, "?year=2026-2027")), 3)
        self.as_member(self.t.treasurer)
        self.assertEqual(self.client.get("/api/finance/expenses/?unit=abc").status_code, 400)


class InvoiceTests(FinanceApiTestCase):
    """The treasurer notes the supplier's invoice on the expense of a delivered order."""

    def test_the_invoice_of_a_delivered_order(self):
        purchase = ordered(self.t, self.t.electronics)
        self.receive(purchase, date(2026, 10, 15))
        expense = self.expense_of(purchase)
        url = f"/api/finance/expenses/{expense.id}/invoice/"
        invoice = {"reference": "F-2026-118", "total_amount": "2000.00", "issued_at": "2026-10-16"}
        self.assertEqual(self.send(self.t.lead, "post", url, invoice).status_code, 403)
        response = self.send(self.t.treasurer, "post", url, invoice)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["invoice"]["reference"], "F-2026-118")
        expense.refresh_from_db()
        self.assertEqual((expense.invoice.supplier, expense.invoice.total_amount), (self.t.supplier, Decimal("2000.00")))
        self.assertEqual(self.send(self.t.treasurer, "post", url, invoice).status_code, 400)  # already noted

        manual = self.send(self.t.treasurer, "post", "/api/finance/expenses/", {
            "budget": self.t.fs_budget.id, "amount": "10", "category": "other", "description": "Stamps",
        }).json()
        response = self.send(self.t.treasurer, "post", f"/api/finance/expenses/{manual['id']}/invoice/", invoice)
        self.assertEqual(response.status_code, 400)  # an invoice belongs to an order's supplier


class SponsorshipTests(FinanceApiTestCase):
    """Operations and the admins follow the sponsors; the bureau and the treasurer see them and the
    totals, without the contacts; the others do not see them."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        Sponsorship.objects.create(
            sponsor_name="Steel Works", amount=300000, status=SponsorshipStatus.CONFIRMED,
            confirmed_at=date(2026, 10, 2), contact_name="Sam Contact", contact_email="sam@sponsor.example",
        )
        Sponsorship.objects.create(sponsor_name="Tyre Shop", status=SponsorshipStatus.PROSPECT)

    def sponsors(self, member):
        return {s["sponsor_name"]: s for s in self.get(member, "/api/finance/sponsorships/")["results"]}

    def test_who_sees_the_sponsors_and_their_contacts(self):
        for member in (self.t.ops_head, self.t.coordinator, self.t.admin):
            self.assertEqual(self.sponsors(member)["Steel Works"]["contact_email"], "sam@sponsor.example", member.first_name)
        for member in (self.t.bureau, self.t.treasurer):
            steel = self.sponsors(member)["Steel Works"]
            self.assertEqual((steel["contact_name"], steel["contact_email"], steel["amount"]), (None, None, "300000.00"))
        for member in (self.t.lead, self.t.engineer, self.t.junior):
            self.as_member(member)
            self.assertEqual(self.client.get("/api/finance/sponsorships/").status_code, 403, member.first_name)

    def test_operations_follow_a_sponsor_through_its_stages(self):
        response = self.send(self.t.coordinator, "post", "/api/finance/sponsorships/", {
            "sponsor_name": "Paint Factory", "status": "contacted", "in_kind_description": "Paint for the car",
        })
        self.assertEqual(response.status_code, 201, response.content)
        created = response.json()
        self.assertEqual((created["managed_by"]["id"], created["confirmed_at"]), (self.t.coordinator.id, None))
        url = f"/api/finance/sponsorships/{created['id']}/"
        with patch("django.utils.timezone.now", return_value=datetime(2026, 10, 20, 10, tzinfo=UTC)):
            confirmed = self.send(self.t.ops_head, "patch", url, {"status": "confirmed", "amount": "50000"}).json()
        self.assertEqual((confirmed["status"], confirmed["confirmed_at"]), ("confirmed", "2026-10-20"))
        declined = self.send(self.t.ops_head, "patch", url, {"status": "declined"}).json()
        self.assertEqual(declined["confirmed_at"], None)
        self.assertEqual(self.send(self.t.treasurer, "post", "/api/finance/sponsorships/", {"sponsor_name": "X"}).status_code, 403)
        self.assertEqual(self.send(self.t.bureau, "patch", url, {"notes": "x"}).status_code, 403)
        self.assertEqual(self.send(self.t.admin, "delete", url).status_code, 204)

    def test_the_stages_and_the_confirmed_total_of_the_year(self):
        summary = self.get(self.t.bureau, f"/api/finance/sponsorships/summary/?year={self.YEAR}")
        self.assertEqual(summary["by_status"], {"prospect": 1, "contacted": 0, "negotiating": 0, "confirmed": 1, "declined": 0})
        self.assertEqual((summary["confirmed_total"], summary["fiscal_year"], summary["can_manage"]),
                         ("300000.00", "2026-2027", False))
        self.assertEqual(self.get(self.t.bureau, "/api/finance/sponsorships/summary/?year=2025-2026")["confirmed_total"], "0.00")


class ImputeDeliveredOrdersTests(TestCase):
    """manage.py impute_delivered_orders: the orders delivered before the Finance module (the imported
    sheet) become expenses, as if they had been received in the ERP. Run once the budgets exist."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_finance()

    def delivered(self, unit, price="1000.00", receiver=None):
        purchase = ordered(self.t, unit, price=price)
        purchase.status = PurchaseStatus.LIVRE
        purchase.save()
        PurchaseOrder.objects.filter(purchase_request=purchase).update(
            status=PurchaseStatus.LIVRE, actual_delivery_date=date(2026, 10, 10)
        )
        if receiver is not None:
            PurchaseRequestEvent.objects.create(
                purchase_request=purchase, action=PurchaseAction.RECEIVED, status=PurchaseStatus.LIVRE, actor=receiver
            )
        return purchase

    def run_command(self, *args):
        out = StringIO()
        call_command("impute_delivered_orders", *args, stdout=out)
        return out.getvalue()

    def test_the_orders_delivered_before_become_expenses(self):
        received = self.delivered(self.t.electronics, receiver=self.t.coordinator)
        imported = self.delivered(self.t.office)  # no budget, no reception in the ERP
        self.delivered(self.t.aero, price=None)  # no price

        printed = self.run_command("--dry-run")
        self.assertEqual(Expense.objects.count(), 0)
        self.assertIn("2 expense(s) to create: 1 imputed to a budget, 1 to impute", printed)
        self.assertIn("1 delivered order(s) without a price", printed)

        self.run_command()
        self.assertEqual(
            {(e.purchase_order.purchase_request_id, e.budget_id, e.recorded_by_id, e.recorded_at) for e in Expense.objects.all()},
            {(received.id, self.t.elec_budget.id, self.t.coordinator.id, date(2026, 10, 10)),
             (imported.id, None, self.t.engineer.id, date(2026, 10, 10))},  # the requester when nobody received it
        )
        self.assertIn("0 expense(s) to create", self.run_command())  # nothing twice
