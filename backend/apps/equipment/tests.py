from datetime import UTC, datetime, timedelta
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.communication import notify
from apps.communication.models import Notification, NotificationKind as Kind
from apps.equipment.models import (
    Equipment, EquipmentCategory, EquipmentLoan, EquipmentMaintenance, EquipmentReservation, EquipmentStatus,
    LoanStatus, ReservationStatus,
)
from apps.inventory.access import WORKSHOP_ROLE
from apps.members.models import Member, MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.work_fixtures import build_team, person
from apps.purchasing.access import LOGISTICS_ROLE, OPERATIONS_UNIT


class MaintenanceDateTests(TestCase):
    """The maintenance date is when the work was done, often before it is entered (bug #9)."""

    def setUp(self):
        self.equipment = Equipment.objects.create(name="Torque wrench")
        self.member = Member.objects.create_user(
            email="mechanic@g.enp.edu.dz", first_name="Me", last_name="Chanic", password=None,
        )

    def test_past_maintenance_date_is_kept(self):
        done = datetime(2026, 9, 1, 14, 0, tzinfo=UTC)
        maintenance = EquipmentMaintenance.objects.create(
            equipment=self.equipment, performed_by=self.member, performed_at=done,
        )
        maintenance.refresh_from_db()
        self.assertEqual(maintenance.performed_at, done)
        self.assertTrue(EquipmentMaintenance._meta.get_field("performed_at").editable)  # shown in the admin form

    def test_maintenance_date_defaults_to_now(self):
        maintenance = EquipmentMaintenance.objects.create(equipment=self.equipment, performed_by=self.member)
        self.assertIsNotNone(maintenance.performed_at)


class EquipmentLabelsTests(TestCase):
    """Equipment names and statuses are translated, with the right gender."""

    def test_maintenance_name_is_translated(self):
        from django.utils import translation

        maintenance = EquipmentMaintenance(equipment=Equipment(name="Lathe"))
        names = {}
        for language in ("en", "fr", "ar"):
            with translation.override(language):
                names[language] = str(maintenance)
        self.assertEqual(names["en"], "Maintenance on Lathe")
        self.assertEqual(len(set(names.values())), 3, names)
        self.assertTrue(all("Lathe" in name for name in names.values()), names)

    def test_confirmed_agrees_with_sponsor_and_reservation(self):
        from django.utils import translation

        from apps.finance.models import SponsorshipStatus

        with translation.override("fr"):
            self.assertEqual(str(ReservationStatus.CONFIRMED.label), "Confirmée")  # la réservation
            self.assertEqual(str(ReservationStatus.CANCELLED.label), "Annulée")
            self.assertEqual(str(SponsorshipStatus.CONFIRMED.label), "Confirmé")  # le sponsor
            self.assertEqual(str(LoanStatus.CANCELLED.label), "Annulé")  # le prêt


def build_workshop():
    """build_team() (apps/projects/work_fixtures.py) plus the workshop.

    Operations & Partnerships: `ops_head` heads it, `coordinator` is a logistics coordinator: equipment managers.
    `workshop` is the Manufacturing & Workshop Lead: a manager, who certifies the members.
    Equipment: a lathe (certification required, stays in the workshop), a drill and a caliper (both may go out).
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
    workshop_role = Role.objects.create(
        code=WORKSHOP_ROLE, name="Manufacturing & Workshop Lead", role_type=MemberRoleType.ADMIN,
        scope=RoleScope.FS_TEAM, is_leadership=True,
    )
    t.ops_head, t.coordinator, t.workshop = person("opshead"), person("coordinator"), person("workshop")
    Membership.objects.create(member=t.ops_head, org_unit=t.operations, role=head_role)
    Membership.objects.create(member=t.coordinator, org_unit=t.operations, role=logistics, member_level="main")
    Membership.objects.create(member=t.workshop, org_unit=t.fs_team, role=workshop_role)
    t.lathe = Equipment.objects.create(
        name="Lathe", category=EquipmentCategory.MACHINE, location="Workshop", requires_certification=True,
        loanable=False,
    )
    t.drill = Equipment.objects.create(name="Drill", category=EquipmentCategory.POWER_TOOL, location="Cabinet A")
    t.caliper = Equipment.objects.create(name="Caliper", category=EquipmentCategory.MEASURING, location="Cabinet B")
    return t


def notified(kind):
    return sorted(Notification.objects.filter(kind=kind).values_list("member__first_name", flat=True))


def moment(hours):
    return (timezone.now() + timedelta(hours=hours)).isoformat()


class WorkshopTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.t = build_workshop()

    def send(self, member, method, url, data=None):
        self.client.force_authenticate(member)
        with self.captureOnCommitCallbacks(execute=True):
            return getattr(self.client, method)(url, data or {}, format="json")

    def ok(self, member, method, url, data=None, status=200):
        response = self.send(member, method, url, data)
        self.assertEqual(response.status_code, status, response.content[:500])
        return response.json() if response.content else None

    def reserve(self, member, equipment, start=1, hours=2, status=201, **extra):
        body = {"reserved_from": moment(start), "reserved_to": moment(start + hours), "purpose": "Brackets", **extra}
        return self.ok(member, "post", f"/api/equipment/{equipment.id}/reservations/", body, status=status)

    def borrow(self, member, equipment, days=3, status=201):
        body = {"reason": "Measure the uprights at home", "due_date": str(timezone.localdate() + timedelta(days=days))}
        return self.ok(member, "post", f"/api/equipment/{equipment.id}/loans/", body, status=status)

    def names(self, member, query=""):
        return [row["name"] for row in self.ok(member, "get", f"/api/equipment/{query}")["results"]]


class EquipmentApiTests(WorkshopTestCase):
    def test_every_member_sees_the_equipment_the_managers_add_it(self):
        t = self.t
        self.assertEqual(self.names(t.engineer), ["Caliper", "Drill", "Lathe"])
        self.assertEqual(self.names(t.engineer, "?category=machine"), ["Lathe"])
        self.assertEqual(self.names(t.engineer, "?q=dri"), ["Drill"])
        body = {"name": "Milling machine", "category": "machine", "location": "Workshop",
                "requires_certification": True, "loanable": False}
        self.assertEqual(self.send(t.engineer, "post", "/api/equipment/", body).status_code, 403)
        for manager in (t.ops_head, t.coordinator, t.workshop, t.admin):
            data = self.ok(manager, "post", "/api/equipment/", {**body, "name": f"Mill {manager.first_name}"}, 201)
            self.assertEqual((data["status"], data["requires_certification"]), ("available", True))

    def test_the_rights_of_the_viewer(self):
        t = self.t
        for member, rights in ((t.engineer, (False, False)), (t.coordinator, (True, False)),
                               (t.workshop, (True, True)), (t.admin, (True, True))):
            data = self.ok(member, "get", "/api/equipment/rights/")
            self.assertEqual((data["manage"], data["certify"]), rights, member.first_name)

    def test_maintenance_cancels_the_coming_reservations_and_tells_their_authors(self):
        t = self.t
        reservation = self.reserve(t.engineer, t.drill, start=2)
        self.assertEqual(self.send(t.engineer, "patch", f"/api/equipment/{t.drill.id}/", {"status": "maintenance"})
                         .status_code, 403)
        self.ok(t.coordinator, "patch", f"/api/equipment/{t.drill.id}/", {"status": "maintenance"})
        self.assertEqual(EquipmentReservation.objects.get(pk=reservation["id"]).status, ReservationStatus.CANCELLED)
        self.assertEqual(notified(Kind.RESERVATION_CANCELLED), ["Engineer"])
        self.assertEqual(len(mail.outbox), 1)
        # "Borrowed" comes from the loans only.
        response = self.send(t.coordinator, "patch", f"/api/equipment/{t.drill.id}/", {"status": "borrowed"})
        self.assertEqual(response.status_code, 400)

    def test_managers_record_the_maintenance_its_cost_shown_to_them_only(self):
        t = self.t
        url = f"/api/equipment/{t.lathe.id}/maintenance/"
        body = {"performed_at": "2026-10-20T10:00:00+01:00", "description": "New belt", "cost": "1500.00",
                "status": "out_of_service"}
        self.assertEqual(self.send(t.engineer, "post", url, body).status_code, 403)
        self.ok(t.workshop, "post", url, body, status=201)
        t.lathe.refresh_from_db()
        self.assertEqual((str(t.lathe.last_maintenance_at), t.lathe.status), ("2026-10-20", "out_of_service"))
        detail = self.ok(t.engineer, "get", f"/api/equipment/{t.lathe.id}/")
        self.assertEqual((detail["maintenance"][0]["description"], detail["maintenance"][0]["cost"]), ("New belt", None))
        detail = self.ok(t.coordinator, "get", f"/api/equipment/{t.lathe.id}/")
        self.assertEqual(detail["maintenance"][0]["cost"], "1500.00")


class CertificationTests(WorkshopTestCase):
    def test_the_workshop_lead_certifies_a_member_who_may_then_reserve_the_machine(self):
        t = self.t
        self.reserve(t.engineer, t.lathe, status=403)
        url = f"/api/equipment/{t.lathe.id}/certifications/"
        self.assertEqual(self.send(t.coordinator, "post", url, {"member_id": t.engineer.id}).status_code, 403)
        certification = self.ok(t.workshop, "post", url, {"member_id": t.engineer.id, "note": "Trained"}, status=201)
        self.assertEqual(notified(Kind.CERTIFICATION_GRANTED), ["Engineer"])
        self.assertEqual(self.send(t.workshop, "post", url, {"member_id": t.engineer.id}).status_code, 400)
        detail = self.ok(t.engineer, "get", f"/api/equipment/{t.lathe.id}/")
        self.assertTrue(detail["certified"])
        self.assertTrue(detail["permissions"]["reserve"])
        self.assertEqual([row["member"]["first_name"] for row in detail["certifications"]], ["Engineer"])
        self.reserve(t.engineer, t.lathe, start=1)
        self.ok(t.workshop, "post", f"{url}{certification['id']}/revoke/")
        self.reserve(t.engineer, t.lathe, start=5, status=403)
        self.assertEqual(self.ok(t.engineer, "get", f"/api/equipment/{t.lathe.id}/")["certifications"], [])


class ReservationTests(WorkshopTestCase):
    def test_a_free_slot_is_confirmed_at_once_an_overlapping_one_refused(self):
        t = self.t
        data = self.reserve(t.engineer, t.drill, start=1, hours=2)
        self.assertEqual(data["status"], ReservationStatus.CONFIRMED)
        self.reserve(t.teammate, t.drill, start=2, hours=2, status=400)
        self.reserve(t.teammate, t.drill, start=3, hours=1)  # right after it
        detail = self.ok(t.outsider, "get", f"/api/equipment/{t.drill.id}/")
        self.assertEqual([row["reserved_by"]["first_name"] for row in detail["reservations"]], ["Engineer", "Teammate"])

    def test_the_slot_must_be_to_come_short_enough_and_the_equipment_usable(self):
        t = self.t
        self.reserve(t.engineer, t.drill, start=-2, status=400)
        self.reserve(t.engineer, t.drill, start=1, hours=24 * 8, status=400)
        self.reserve(t.engineer, t.drill, start=3, hours=-1, status=400)
        Equipment.objects.filter(pk=t.drill.pk).update(status=EquipmentStatus.OUT_OF_SERVICE)
        self.reserve(t.engineer, t.drill, start=1, status=400)

    def test_its_author_or_a_manager_cancels_it(self):
        t = self.t
        first = self.reserve(t.engineer, t.drill, start=1)
        url = f"/api/equipment-reservations/{first['id']}/cancel/"
        self.assertEqual(self.send(t.teammate, "post", url).status_code, 403)
        self.assertEqual(self.ok(t.engineer, "post", url)["status"], ReservationStatus.CANCELLED)
        self.assertEqual(notified(Kind.RESERVATION_CANCELLED), [])  # their own
        second = self.reserve(t.engineer, t.drill, start=5)
        self.ok(t.coordinator, "post", f"/api/equipment-reservations/{second['id']}/cancel/",
                {"reason": "Needed for the chassis"})
        self.assertEqual(notified(Kind.RESERVATION_CANCELLED), ["Engineer"])
        self.assertEqual(len(mail.outbox), 1)

    def test_the_week_calendar_shows_every_member_the_slots_of_a_week(self):
        # The team's Figma (decision D-022): the week's slots of all the equipment, as each machine's sheet shows them.
        t = self.t
        today = timezone.localdate()
        monday = today - timedelta(days=today.weekday())

        def at(day, hour):
            return timezone.make_aware(datetime.combine(monday + timedelta(days=day), datetime.min.time())) + \
                timedelta(hours=hour)

        def slot(member, equipment, start, end, status=ReservationStatus.CONFIRMED):
            return EquipmentReservation.objects.create(
                equipment=equipment, reserved_by=member, reserved_from=start, reserved_to=end, purpose="Brackets",
                status=status,
            )

        tuesday = slot(t.engineer, t.drill, at(1, 10), at(1, 12))
        overnight = slot(t.teammate, t.lathe, at(-1, 23), at(0, 1))  # from Sunday night: it overlaps the week
        slot(t.engineer, t.caliper, at(2, 9), at(2, 10), status=ReservationStatus.CANCELLED)
        slot(t.engineer, t.drill, at(7, 9), at(7, 10))  # next week
        rows = self.ok(t.outsider, "get", f"/api/equipment-reservations/week/?start={monday.isoformat()}")
        self.assertEqual([row["id"] for row in rows], [overnight.id, tuesday.id])
        self.assertEqual(rows[1]["reserved_by"]["first_name"], "Engineer")
        drill_only = self.ok(t.outsider, "get", f"/api/equipment-reservations/week/?start={monday}&equipment={t.drill.id}")
        self.assertEqual([row["id"] for row in drill_only], [tuesday.id])
        self.assertEqual([row["id"] for row in self.ok(t.outsider, "get", "/api/equipment-reservations/week/")],
                         [overnight.id, tuesday.id])  # this week by default
        self.assertEqual(self.send(t.outsider, "get", "/api/equipment-reservations/week/?start=monday").status_code, 400)

    def test_each_member_lists_their_reservations(self):
        t = self.t
        self.reserve(t.engineer, t.drill, start=1)
        self.reserve(t.teammate, t.caliper, start=1)
        rows = self.ok(t.engineer, "get", "/api/equipment-reservations/")["results"]
        self.assertEqual([row["equipment"]["name"] for row in rows], ["Drill"])


class LoanTests(WorkshopTestCase):
    def test_a_member_asks_a_manager_hands_it_out_then_receives_it_back(self):
        t = self.t
        loan = self.borrow(t.engineer, t.caliper)
        self.assertEqual(loan["status"], LoanStatus.REQUESTED)
        self.assertEqual(notified(Kind.LOAN_REQUESTED), ["Coordinator", "Opshead", "Workshop"])
        self.assertEqual(len(mail.outbox), 3)
        url = f"/api/equipment-loans/{loan['id']}"
        self.assertEqual(self.send(t.teammate, "post", f"{url}/approve/").status_code, 404)  # not theirs to see
        self.assertEqual(self.send(t.engineer, "post", f"{url}/approve/").status_code, 403)
        self.assertEqual(self.ok(t.coordinator, "post", f"{url}/approve/")["status"], LoanStatus.OUT)
        t.caliper.refresh_from_db()
        self.assertEqual(t.caliper.status, EquipmentStatus.BORROWED)
        self.assertEqual(notified(Kind.LOAN_DECIDED), ["Engineer"])
        # Already out: another one cannot go out.
        other = self.borrow(t.teammate, t.caliper)
        self.assertEqual(self.send(t.coordinator, "post", f"/api/equipment-loans/{other['id']}/approve/").status_code,
                         400)
        self.assertEqual(self.send(t.coordinator, "patch", f"/api/equipment/{t.caliper.id}/", {"status": "available"})
                         .status_code, 400)  # its return is recorded instead
        returned = self.ok(t.workshop, "post", f"{url}/return/", {"condition": "damaged", "note": "Jaw bent"})
        self.assertEqual((returned["status"], returned["return_condition"]), (LoanStatus.RETURNED, "damaged"))
        t.caliper.refresh_from_db()
        self.assertEqual(t.caliper.status, EquipmentStatus.MAINTENANCE)

    def test_a_refusal_says_why(self):
        t = self.t
        loan = self.borrow(t.engineer, t.caliper)
        url = f"/api/equipment-loans/{loan['id']}/refuse/"
        self.assertEqual(self.send(t.coordinator, "post", url, {"note": ""}).status_code, 400)
        self.assertEqual(self.ok(t.coordinator, "post", url, {"note": "Needed for the event"})["status"],
                         LoanStatus.REFUSED)
        self.assertEqual(Notification.objects.get(kind=Kind.LOAN_DECIDED).data["approved"], False)

    def test_what_may_not_go_out(self):
        t = self.t
        self.borrow(t.engineer, t.lathe, status=400)  # stays in the workshop
        Equipment.objects.filter(pk=t.drill.pk).update(requires_certification=True)
        self.borrow(t.engineer, t.drill, status=403)  # not certified
        self.borrow(t.engineer, t.caliper, days=-1, status=400)  # a return date already past
        self.reserve(t.teammate, t.caliper, start=24)  # reserved tomorrow, during the loan
        loan = self.borrow(t.engineer, t.caliper)
        response = self.send(t.coordinator, "post", f"/api/equipment-loans/{loan['id']}/approve/")
        self.assertEqual(response.status_code, 400)

    def test_the_borrower_cancels_until_it_is_decided(self):
        t = self.t
        loan = self.borrow(t.engineer, t.caliper)
        url = f"/api/equipment-loans/{loan['id']}"
        self.assertEqual(self.send(t.teammate, "post", f"{url}/cancel/").status_code, 404)
        self.assertEqual(self.ok(t.engineer, "post", f"{url}/cancel/")["status"], LoanStatus.CANCELLED)
        self.assertEqual(self.send(t.coordinator, "post", f"{url}/approve/").status_code, 400)

    def test_each_member_sees_their_loans_the_managers_all(self):
        t = self.t
        self.borrow(t.engineer, t.caliper)
        self.borrow(t.teammate, t.drill)
        rows = self.ok(t.engineer, "get", "/api/equipment-loans/")["results"]
        self.assertEqual([row["borrower"]["first_name"] for row in rows], ["Engineer"])
        rows = self.ok(t.coordinator, "get", "/api/equipment-loans/?status=requested")["results"]
        self.assertEqual(sorted(row["borrower"]["first_name"] for row in rows), ["Engineer", "Teammate"])
        self.assertEqual(self.ok(t.coordinator, "get", "/api/equipment-loans/?status=out")["results"], [])

    def test_an_overdue_loan_is_reminded_once(self):
        t = self.t
        EquipmentLoan.objects.create(
            equipment=t.caliper, borrower=t.engineer, reason="Uprights", status=LoanStatus.OUT,
            due_date=timezone.localdate() - timedelta(days=1),
        )
        out = StringIO()
        # From the 20th, the run also reminds the volunteering (tested in apps.engagement): not about loans.
        with patch(
            "apps.communication.management.commands.send_deadline_reminders.volunteering_reminders", return_value=0
        ), self.captureOnCommitCallbacks(execute=True):
            call_command("send_deadline_reminders", stdout=out)
        self.assertIn("Loan reminders: 1", out.getvalue())
        self.assertEqual(notified(Kind.LOAN_OVERDUE), ["Engineer"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(notify.loan_reminders(), 0)  # once
