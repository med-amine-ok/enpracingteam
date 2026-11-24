r"""
Real e-mails: the sign-in codes and the notifications reach the members' inboxes, sent from a Google
account (Gmail, or a school account such as @g.enp.edu.dz). scripts\set_email.ps1 runs this command.

    manage.py setup_email         asks for the address and an app password of the account (typed
                                  hidden), sends a test e-mail with them, and saves them in
                                  the .env at the root of the project only if it went out
    manage.py setup_email --off   the codes are printed in the API window again; the account stays saved
    manage.py setup_email --on    real e-mails again, with the saved account (after a test e-mail)

The e-mails then go through apps.communication.mail.SMTPBackend, which never writes to the demo's
fictitious people. --env-file changes another settings file, such as backend\.env.prod for a server.
The ERP reads its settings when it starts: restart it afterwards.
"""

import getpass
import re
import smtplib
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage, get_connection
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email

SMTP_BACKEND = "apps.communication.mail.SMTPBackend"
CONSOLE_BACKEND = "django.core.mail.backends.console.EmailBackend"
REAL_BACKENDS = {SMTP_BACKEND, "django.core.mail.backends.smtp.EmailBackend"}
GMAIL = {"EMAIL_HOST": "smtp.gmail.com", "EMAIL_PORT": "587", "EMAIL_USE_TLS": "True"}
APP_PASSWORDS_PAGE = "https://myaccount.google.com/apppasswords"
SENDER_NAME = "ENP Racing Team ERP"
UNCHANGED = "nothing was changed"
TEST_SUBJECT = "ENP Racing Team ERP: test e-mail"
TEST_BODY = "\n".join([
    "This test e-mail was sent by the ENP Racing Team ERP to check its sending account.",
    "The members will receive their sign-in codes and their notifications from this address.",
    "",
    "Cet e-mail de test a été envoyé par l'ERP de l'ENP Racing Team pour vérifier son compte d'envoi.",
    "Les membres recevront leurs codes de connexion et leurs notifications depuis cette adresse.",
])
# A KEY=value line of an .env file.
SETTING = re.compile(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)")


def read_values(text):
    """The settings of an .env file, by key (quotes around a value removed; the first line counts)."""
    values = {}
    for line in text.splitlines():
        if match := SETTING.fullmatch(line):
            value = match[2].strip()
            if len(value) > 1 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            values.setdefault(match[1], value)
    return values


def with_values(text, values):
    """`text`, an .env file, with these settings: changed on every line where they are, else added at
    the end. The other lines and the line endings stay as they are."""
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines()
    found = set()
    for number, line in enumerate(lines):
        match = SETTING.fullmatch(line)
        if match and match[1] in values:
            lines[number] = f"{match[1]}={values[match[1]]}"
            found.add(match[1])
    lines += [f"{key}={value}" for key, value in values.items() if key not in found]
    return newline.join(lines) + newline


class Command(BaseCommand):
    help = "Real e-mails from a Google account: the sign-in codes and the notifications reach the members."

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--off", action="store_true", help="Print the codes in the API window again (the account stays saved).")
        mode.add_argument("--on", action="store_true", help="Real e-mails again, with the saved account.")
        parser.add_argument("--env-file", default=str(settings.ENV_FILE), help="The settings file to change.")

    def handle(self, *args, off, on, env_file, **options):
        path = Path(env_file)
        if not path.is_file():
            raise CommandError(f"Settings file not found: {path}")
        text = path.read_bytes().decode()
        saved = read_values(text)
        if off:
            path.write_bytes(with_values(text, {"EMAIL_BACKEND": CONSOLE_BACKEND}).encode())
            self.stdout.write(self.style.SUCCESS("Real e-mails are off: the sign-in codes are printed in the 'ERP - API' window again."))
            if saved.get("EMAIL_HOST_USER"):
                self.stdout.write(f"The account {saved['EMAIL_HOST_USER']} stays saved: set_email -On turns them back on.")
            self.remind_restart()
            return
        if on:
            address, password = saved.get("EMAIL_HOST_USER", ""), saved.get("EMAIL_HOST_PASSWORD", "")
            if not (address and password):
                raise CommandError(f"No account is saved yet: run set_email without -On to set one up; {UNCHANGED}.")
        else:
            address, password = self.ask(saved)
        self.send_test(address, password)
        path.write_bytes(with_values(text, {
            "EMAIL_BACKEND": SMTP_BACKEND,
            **GMAIL,
            "EMAIL_HOST_USER": address,
            "EMAIL_HOST_PASSWORD": password,
            "DEFAULT_FROM_EMAIL": f"{SENDER_NAME} <{address}>",
        }).encode())
        self.stdout.write(self.style.SUCCESS(f"Real e-mails are on, sent from {address}."))
        self.stdout.write("  - The test e-mail is in its inbox (look in the spam folder too).")
        self.stdout.write("  - The members receive their sign-in codes and notifications in their own inboxes. The demo's")
        self.stdout.write("    fictitious people (@example.invalid) receive nothing: their codes stay in the 'ERP - API' window.")
        self.remind_restart()

    def ask(self, saved):
        """The sending address (Enter keeps the saved one) and its app password, typed hidden."""
        user = saved.get("EMAIL_HOST_USER", "")
        if saved.get("EMAIL_BACKEND") in REAL_BACKENDS and user:
            self.stdout.write(f"Now: real e-mails, sent from {user}.")
        else:
            self.stdout.write("Now: no real e-mail; the sign-in codes are printed in the 'ERP - API' window.")
        self.stdout.write("")
        self.stdout.write("You need an app password of the sending account: 16 letters that Google gives at")
        self.stdout.write(f"  {APP_PASSWORDS_PAGE}  (signed in with that account; 2-Step Verification on).")
        self.stdout.write("Type it only here, where it stays hidden. Never send it to anyone, not even in a chat.")
        self.stdout.write("")
        address = input(f"Sending address [{user}]: " if user else "Sending address: ").strip() or user
        try:
            validate_email(address)
        except ValidationError:
            raise CommandError(f"This is not an e-mail address: '{address}'; {UNCHANGED}.") from None
        password = "".join(getpass.getpass("App password (hidden): ").split())
        if not re.fullmatch("[A-Za-z]{16}", password):
            raise CommandError(
                "This is not an app password: Google gives 16 letters, shown as 4 groups of 4. "
                f"Create one at {APP_PASSWORDS_PAGE}; {UNCHANGED}."
            )
        return address, password

    def send_test(self, address, password):
        """Sends the test e-mail to the account itself, with these credentials (not the saved settings)."""
        self.stdout.write(f"Sending a test e-mail to {address}...")
        connection = get_connection(
            "django.core.mail.backends.smtp.EmailBackend",
            host=GMAIL["EMAIL_HOST"],
            port=int(GMAIL["EMAIL_PORT"]),
            username=address,
            password=password,
            use_tls=True,
            use_ssl=False,
            timeout=30,
            fail_silently=False,
        )
        message = EmailMessage(TEST_SUBJECT, TEST_BODY, f"{SENDER_NAME} <{address}>", [address], connection=connection)
        try:
            message.send()
        except smtplib.SMTPAuthenticationError:
            raise CommandError(
                f"Google refused this address or this app password; {UNCHANGED}.\n"
                "  - Check the address, and type the app password again (create a new one if in doubt).\n"
                "  - If Google says that app passwords are not available for this account, the school blocks\n"
                "    them: use a Gmail account of the club instead."
            ) from None
        except OSError as error:  # SMTP errors, no Internet, port blocked, time out
            raise CommandError(
                f"The test e-mail could not be sent ({type(error).__name__}: {error}); {UNCHANGED}.\n"
                "  Is this PC connected to the Internet? Some networks block smtp.gmail.com (port 587)."
            ) from None

    def remind_restart(self):
        self.stdout.write("The ERP reads this when it starts: if it is running, restart it (stop_erp, then start_erp).")
