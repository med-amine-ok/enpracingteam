"""
The backend for real e-mails (EMAIL_BACKEND=apps.communication.mail.SMTPBackend, set up by
scripts\\set_email.ps1): Django's SMTP backend, except for the addresses that can never receive an
e-mail, such as the demo's fictitious people (@example.invalid). Those messages are printed in the
server's console instead, as on a PC without e-mails: a demonstration can still sign in, and no real
e-mail is ever sent to a fictitious address.
"""

import copy
import sys

from django.core.mail.backends import console, smtp

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
