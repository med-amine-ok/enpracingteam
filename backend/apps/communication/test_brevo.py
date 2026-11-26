"""E-mails through Brevo's HTTPS API (hosts that block SMTP, such as Render's free plan)."""

import io
import json
from unittest import mock

from django.core.mail import EmailMultiAlternatives, get_connection
from django.test import SimpleTestCase, override_settings

BREVO = "apps.communication.mail.BrevoBackend"


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


@override_settings(EMAIL_BACKEND=BREVO, BREVO_API_KEY="test-key", EMAIL_TIMEOUT=7,
                   DEFAULT_FROM_EMAIL="ENP Racing Team <club@example.org>")
class BrevoBackendTests(SimpleTestCase):
    def send(self, message):
        calls = []

        def urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse(b'{"messageId": "1"}')

        with mock.patch("apps.communication.mail.urllib.request.urlopen", urlopen):
            count = get_connection(stream=io.StringIO()).send_messages([message])
        return count, calls

    def test_a_message_is_posted_to_brevo_with_its_key_and_time_limit(self):
        message = EmailMultiAlternatives("Your code", "Code: 123456", to=["Lina <lina@gmail.com>"])
        message.attach_alternative("<p>Code: 123456</p>", "text/html")
        count, calls = self.send(message)
        request, timeout = calls[0]
        body = json.loads(request.data)
        self.assertEqual((count, timeout, request.get_header("Api-key")), (1, 7, "test-key"))
        self.assertEqual(body["sender"], {"email": "club@example.org", "name": "ENP Racing Team"})
        self.assertEqual(body["to"], [{"email": "lina@gmail.com", "name": "Lina"}])
        self.assertEqual((body["subject"], body["textContent"], body["htmlContent"]),
                         ("Your code", "Code: 123456", "<p>Code: 123456</p>"))

    def test_a_fictitious_address_is_printed_never_sent(self):
        count, calls = self.send(EmailMultiAlternatives("Code", "123456", to=["lina.demo@example.invalid"]))
        self.assertEqual((count, calls), (1, []))

    def test_a_failure_is_raised_unless_silent(self):
        def broken(request, timeout):
            raise OSError("blocked")

        message = EmailMultiAlternatives("Code", "123456", to=["lina@gmail.com"])
        with mock.patch("apps.communication.mail.urllib.request.urlopen", broken):
            with self.assertRaises(OSError):
                get_connection().send_messages([message])
            self.assertEqual(get_connection(fail_silently=True).send_messages([message]), 0)
