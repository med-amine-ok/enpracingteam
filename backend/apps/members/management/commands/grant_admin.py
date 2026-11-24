"""
Gives a member the admin rights (Django's admin, every right in the ERP) and an admin password typed
twice, never written on the command line: for the server (DEBUG off), where dev_login refuses to run.
On the server: scripts\\manage_prod.ps1 grant_admin <e-mail> (knowledge base:
PROJECTS/ERP/guide_hebergement.md).
"""

from getpass import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from apps.members.models import Member


class Command(BaseCommand):
    help = "Gives an existing member the admin rights and a password typed twice (safe on the server)."

    def add_arguments(self, parser):
        parser.add_argument("email")

    def handle(self, *args, email, **options):
        member = Member.objects.filter(email__iexact=email).first()
        if member is None:
            raise CommandError(f"No member with the address {email}: run seed_all first.")
        password = getpass(f"Admin password for {member.email}: ")
        if getpass("The same again: ") != password:
            raise CommandError("The two passwords are not the same: nothing was changed.")
        try:
            validate_password(password, member)
        except ValidationError as weak:
            raise CommandError(" ".join(weak.messages)) from None
        member.set_password(password)
        member.is_staff = member.is_superuser = True
        member.save()
        self.stdout.write(self.style.SUCCESS(f"{member} ({member.email}) is now an admin."))
