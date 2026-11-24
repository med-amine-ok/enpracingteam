"""One settings file on this PC: the .env at the root of the project, read by Docker Compose and Django
(known issue #13, decision D-023)."""

import tempfile
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase, override_settings

from .checks import check_one_settings_file


class OneSettingsFileTests(SimpleTestCase):
    def test_django_reads_the_env_at_the_root_of_the_project(self):
        self.assertEqual(settings.ENV_FILE, Path(settings.BASE_DIR).parent / ".env")

    def test_a_backend_env_left_from_before_is_pointed_out(self):
        with tempfile.TemporaryDirectory() as folder:
            legacy = Path(folder) / ".env"
            with override_settings(LEGACY_ENV_FILE=legacy):
                self.assertEqual(check_one_settings_file(None), [])
                legacy.write_text("DEBUG=True\n", encoding="utf-8")
                self.assertEqual([warning.id for warning in check_one_settings_file(None)], ["members.W001"])

    def test_docker_compose_takes_the_database_from_the_same_names(self):
        compose = (Path(settings.BASE_DIR).parent / "docker-compose.yml").read_text(encoding="utf-8")
        for name in ("DB_NAME", "DB_USER", "DB_PASSWORD"):
            self.assertIn(f"${{{name}:-", compose)
