from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.members.models import Member


class Command(BaseCommand):
    help = "DEV ONLY: set a password (and optionally admin rights) for an existing member."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("--password", required=True)
        parser.add_argument("--admin", action="store_true", help="also grant staff + superuser")

    def handle(self, *args, email, password, admin, **options):
        if not settings.DEBUG:
            raise CommandError("Refusing to run with DEBUG=False.")
        member = Member.objects.filter(email__iexact=email).first()
        if member is None:
            raise CommandError(f"No member with email {email}. Run seed_all first.")
        member.set_password(password)
        if admin:
            member.is_staff = member.is_superuser = True
        member.save()
        self.stdout.write(self.style.SUCCESS(f"Password set for {member} ({member.email})."))