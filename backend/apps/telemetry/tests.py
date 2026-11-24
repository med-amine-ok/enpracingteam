from datetime import date

from django.test import SimpleTestCase
from django.utils import translation

from apps.telemetry.models import TelemetrySession


class TelemetryLabelsTests(SimpleTestCase):
    """A session without a type shows a translated word, not the English "session"."""

    def test_session_without_type_shows_a_translated_word(self):
        session = TelemetrySession(session_date=date(2026, 10, 18), session_type="")
        names = {}
        for language in ("en", "fr", "ar"):
            with translation.override(language):
                names[language] = str(session)
        self.assertEqual(names["en"], "2026-10-18 - session")
        self.assertNotEqual(names["ar"], names["en"])
