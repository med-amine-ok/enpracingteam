from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import translation
from rest_framework.test import APITestCase

from apps.projects.work_fixtures import build_team
from apps.subsystems.models import LifecycleStep

# The standard Formula Student lifecycle, as defined in documentation/ENP_Racing_ERP_Schema_Guide.md (5.3).
STANDARD_STEPS = [
    "Étude & recherche",
    "Conception CAD",
    "Simulation",
    "Validation par le chef",
    "Fabrication / achat",
    "Contrôle réception",
    "Intégration atelier",
]


class SeedLifecycleStepsTests(TestCase):
    def test_creates_the_standard_steps_in_order(self):
        call_command("seed_lifecycle_steps", stdout=StringIO())
        self.assertEqual(
            list(LifecycleStep.objects.values_list("step_order", "name")),
            list(enumerate(STANDARD_STEPS, start=1)),
        )

    def test_is_part_of_seed_all_and_safe_to_re_run(self):
        call_command("seed_all", stdout=StringIO())
        call_command("seed_lifecycle_steps", stdout=StringIO())
        self.assertEqual(LifecycleStep.objects.count(), len(STANDARD_STEPS))

    def test_only_the_head_validation_step_requires_a_leader(self):
        # Guide, section 15: "Validation step must be signed by a leadership role of the unit".
        call_command("seed_lifecycle_steps", stdout=StringIO())
        self.assertEqual(
            list(LifecycleStep.objects.filter(requires_validation=True).values_list("name", flat=True)),
            ["Validation par le chef"],
        )


class SubsystemApiTests(APITestCase):
    """/api/subsystems/ and /api/lifecycle-steps/: lifecycle progress and who may tick each step."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()

    def as_member(self, member):
        self.client.force_authenticate(member)

    def tick(self, step_order, done=True, **extra):
        step = self.t.steps[step_order]
        return self.client.patch(
            f"/api/subsystems/{self.t.battery.id}/steps/{step.id}/", {"is_complete": done, **extra}, format="json"
        )

    def step_state(self, response, step_order):
        return next(state for state in response.json()["steps"] if state["step"]["step_order"] == step_order)

    def test_lifecycle_steps_in_order(self):
        self.as_member(self.t.outsider)
        steps = self.client.get("/api/lifecycle-steps/").json()
        self.assertEqual([step["step_order"] for step in steps], [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual([step["requires_validation"] for step in steps], [False] * 3 + [True] + [False] * 3)

    def test_lists_the_subsystems_of_a_project_with_every_step(self):
        self.as_member(self.t.outsider)
        results = self.client.get(f"/api/subsystems/?project={self.t.ev.id}").json()["results"]
        self.assertEqual([subsystem["name"] for subsystem in results], ["Battery"])
        battery = results[0]
        self.assertEqual(battery["org_unit"]["name"], "Electronics")
        self.assertEqual(
            battery["members"], [{"member": {"id": self.t.engineer.id, "first_name": "Engineer", "last_name": "Test"},
                                  "member_level": "main"}]
        )
        self.assertEqual(len(battery["steps"]), 7)
        self.assertFalse(any(state["is_complete"] for state in battery["steps"]))
        self.assertEqual(battery["permissions"], {"edit": False, "validate": False, "estimate_tasks": False})

    def test_the_leaders_of_a_subsystem_set_the_points_and_dates_of_its_tasks(self):
        for member, estimates in ((self.t.lead, True), (self.t.manager, True), (self.t.engineer, False)):
            self.as_member(member)
            battery = self.client.get(f"/api/subsystems/?project={self.t.ev.id}").json()["results"][0]
            self.assertIs(battery["permissions"]["estimate_tasks"], estimates, member.first_name)

    def test_assigned_members_tick_the_steps(self):
        self.as_member(self.t.engineer)
        response = self.tick(1, notes="Cells compared")
        self.assertEqual(response.status_code, 200)
        state = self.step_state(response, 1)
        self.assertTrue(state["is_complete"])
        self.assertIsNotNone(state["completed_at"])
        self.assertEqual(state["notes"], "Cells compared")
        self.assertIsNone(state["validated_by"])  # only validation steps record who signed

        state = self.step_state(self.tick(1, done=False), 1)
        self.assertEqual((state["is_complete"], state["completed_at"]), (False, None))

    def test_people_not_working_on_it_cannot_tick_steps(self):
        for member in (self.t.outsider, self.t.teammate):
            self.as_member(member)
            self.assertEqual(self.tick(1).status_code, 403, member.first_name)

    def test_only_a_leader_of_the_unit_validates(self):
        self.as_member(self.t.engineer)
        response = self.tick(4)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.step_state(self.client.get(f"/api/subsystems/{self.t.battery.id}/"), 4)["can_tick"], False)

        self.as_member(self.t.lead)
        response = self.tick(4)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.step_state(response, 4)["validated_by"]["id"], self.t.lead.id)

        state = self.step_state(self.tick(4, done=False), 4)
        self.assertEqual((state["is_complete"], state["validated_by"]), (False, None))

    def test_later_steps_wait_for_the_validation(self):
        self.as_member(self.t.engineer)
        response = self.tick(5)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Validation par le chef", str(response.json()))
        self.assertEqual(self.step_state(self.client.get(f"/api/subsystems/{self.t.battery.id}/"), 5)["waiting_for"], 4)

        self.as_member(self.t.lead)
        self.tick(4)
        self.as_member(self.t.engineer)
        response = self.tick(5)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.step_state(response, 5)["waiting_for"])

    def test_steps_that_do_not_apply_to_the_car_are_refused(self):
        ic_only = LifecycleStep.objects.create(step_order=8, name="Engine bench test", applies_to_ev=False)
        self.as_member(self.t.lead)
        response = self.client.patch(
            f"/api/subsystems/{self.t.battery.id}/steps/{ic_only.id}/", {"is_complete": True}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        steps = self.client.get(f"/api/subsystems/{self.t.battery.id}/").json()["steps"]
        self.assertNotIn("Engine bench test", [state["step"]["name"] for state in steps])

    def test_status_is_changed_by_leaders_and_the_project_manager(self):
        url = f"/api/subsystems/{self.t.battery.id}/"
        for member, expected in ((self.t.engineer, 403), (self.t.outsider, 403), (self.t.lead, 200),
                                 (self.t.manager, 200)):
            self.as_member(member)
            self.assertEqual(self.client.patch(url, {"status": "blocked"}).status_code, expected, member.first_name)
        self.assertEqual(self.client.get(url).json()["status"], "blocked")


class LifecycleStepLanguageTests(APITestCase):
    """The standard steps are saved in French, as in the guide, and named in the reader's language;
    a step that the team adds or renames is data, shown as typed."""

    ENGLISH = [
        "Study & research", "CAD design", "Simulation", "Validation by the head", "Manufacturing / purchasing",
        "Incoming inspection", "Workshop integration",
    ]

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        LifecycleStep.objects.create(step_order=8, name="Essais dynamiques")  # added by the team

    def setUp(self):
        self.client.force_authenticate(self.t.engineer)

    def step_names(self, language):
        steps = self.client.get("/api/lifecycle-steps/", HTTP_ACCEPT_LANGUAGE=language).json()
        return [step["name"] for step in steps]

    def test_standard_steps_are_named_in_the_reader_language(self):
        self.assertEqual(self.step_names("fr"), STANDARD_STEPS + ["Essais dynamiques"])
        self.assertEqual(self.step_names("en"), self.ENGLISH + ["Essais dynamiques"])
        arabic = self.step_names("ar")
        self.assertEqual(arabic[-1], "Essais dynamiques")
        for name in arabic[:-1]:
            self.assertRegex(name, r"[\u0600-\u06ff]", "not translated into Arabic")
        self.assertEqual(len(set(arabic)), 8)

    def test_subsystem_steps_and_the_waiting_message_follow_the_language(self):
        url = f"/api/subsystems/{self.t.battery.id}/"
        steps = self.client.get(url, HTTP_ACCEPT_LANGUAGE="en").json()["steps"]
        self.assertEqual([state["step"]["name"] for state in steps], self.ENGLISH + ["Essais dynamiques"])

        response = self.client.patch(
            f"{url}steps/{self.t.steps[5].id}/", {"is_complete": True}, format="json", HTTP_ACCEPT_LANGUAGE="en"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(), {"is_complete": "This step waits for the validation step “Validation by the head”."}
        )

    def test_steps_named_by_the_team_are_shown_as_typed(self):
        LifecycleStep.objects.filter(step_order=3).update(name="Simulation CFD")  # renamed by the team
        for language in ("fr", "en", "ar"):
            names = self.step_names(language)
            self.assertEqual((names[2], names[7]), ("Simulation CFD", "Essais dynamiques"), language)

    def test_admin_shows_the_name_in_the_reader_language(self):
        with translation.override("en"):
            self.assertEqual(str(self.t.steps[2]), "2. CAD design")
        with translation.override("fr"):
            self.assertEqual(str(self.t.steps[2]), "2. Conception CAD")
