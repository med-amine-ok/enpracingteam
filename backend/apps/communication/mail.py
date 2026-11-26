"""
The backend for real e-mails (EMAIL_BACKEND=apps.communication.mail.SMTPBackend, set up by
scripts\\set_email.ps1): Django's SMTP backend, except for the addresses that can never receive an
e-mail, such as the demo's fictitious people (@example.invalid). Those messages are printed in the
server's console instead, as on a PC without e-mails: a demonstration can still sign in, and no real
e-mail is ever sent to a fictitious address.
"""

import base64
import copy
import json
import sys
import urllib.request
from email.utils import parseaddr

from django.conf import settings
from django.core.mail.backends import console, smtp
from django.core.mail.backends.base import BaseEmailBackend

# Reserved for examples and tests (RFC 2606, RFC 6761): no e-mail is ever delivered there.
RESERVED_DOMAINS = {"example.com", "example.org", "example.net", "localhost"}
RESERVED_ENDINGS = (".invalid", ".test", ".example", ".localhost")


def deliverable(address):
    """False for an address that can never receive an e-mail."""
    domain = address.rpartition("@")[2].strip().strip(">").lower()
    return not (domain in RESERVED_DOMAINS or domain.endswith(RESERVED_ENDINGS))


def keeping(message, keep):
    """A copy of `message` for the recipients `keep` accepts only (None when there is none left)."""
    part = copy.copy(message)
    part.to = [address for address in message.to if keep(address)]
    part.cc = [address for address in message.cc if keep(address)]
    part.bcc = [address for address in message.bcc if keep(address)]
    return part if part.to or part.cc or part.bcc else None


class BrevoBackend(BaseEmailBackend):
    """Real e-mails through Brevo's HTTPS API (EMAIL_BACKEND=apps.communication.mail.BrevoBackend, BREVO_API_KEY):
    for hosts that block outgoing SMTP, such as Render's free plan (ports 25, 465 and 587). Same rule as
    SMTPBackend for the addresses that can never receive an e-mail: printed in the console instead."""

    URL = "https://api.brevo.com/v3/smtp/email"

    def __init__(self, *args, stream=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.console = console.EmailBackend(stream=stream or sys.stdout, fail_silently=self.fail_silently)

    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages:
            to_send = keeping(message, deliverable)
            to_print = keeping(message, lambda address: not deliverable(address))
            if to_print is not None:
                self.console.send_messages([to_print])
                sent += to_send is None
            if to_send is None:
                continue
            try:
                self.post(payload(to_send))
                sent += 1
            except Exception:
                if not self.fail_silently:
                    raise
        return sent

    def post(self, body):
        request = urllib.request.Request(
            self.URL, data=json.dumps(body).encode(), method="POST",
            headers={"api-key": settings.BREVO_API_KEY, "content-type": "application/json", "accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=settings.EMAIL_TIMEOUT) as response:
            response.read()


def contact(address):
    name, email = parseaddr(address)
    return {"email": email, "name": name} if name else {"email": email}


def payload(message):
    """A Django e-mail as the JSON of Brevo's /v3/smtp/email."""
    body = {
        "sender": contact(message.from_email or settings.DEFAULT_FROM_EMAIL),
        "to": [contact(address) for address in message.to] or [contact(message.cc[0] if message.cc else message.bcc[0])],
        "subject": message.subject,
        "textContent": message.body,
    }
    if message.cc:
        body["cc"] = [contact(address) for address in message.cc]
    if message.bcc:
        body["bcc"] = [contact(address) for address in message.bcc]
    if message.reply_to:
        body["replyTo"] = contact(message.reply_to[0])
    for content, mimetype in getattr(message, "alternatives", []):
        if mimetype == "text/html":
            body["htmlContent"] = content
    attachments = [
        {"name": name, "content": base64.b64encode(data if isinstance(data, bytes) else data.encode()).decode()}
        for name, data, _ in (item for item in message.attachments if isinstance(item, tuple))
        if name and data is not None
    ]
    if attachments:
        body["attachment"] = attachments
    return body


class SMTPBackend(smtp.EmailBackend):
    def __init__(self, *args, stream=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.console = console.EmailBackend(stream=stream or sys.stdout, fail_silently=self.fail_silently)

    def send_messages(self, email_messages):
        """Sends each message by SMTP to its real recipients and prints it for the others. Counts a
        message once, however it went out."""
        real, printed, printed_only = [], [], 0
        for message in email_messages:
            to_send = keeping(message, deliverable)
            to_print = keeping(message, lambda address: not deliverable(address))
            if to_send is not None:
                real.append(to_send)
            if to_print is not None:
                printed.append(to_print)
                printed_only += to_send is None
        sent = super().send_messages(real) if real else 0
        self.console.send_messages(printed)
        return sent + printed_only
