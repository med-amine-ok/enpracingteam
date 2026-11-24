"""Prepares the database of the end-to-end tests (frontend/e2e, Playwright).

A separate database, recreated empty at each run, with the reference data (org units, roles,
lifecycle steps) and the fictitious demo people of seed_demo only: no real member's data, and the
same content every time. Plus, here only, two fictitious people whose roles belong to real members in
the development database (seed_demo gives no leadership role): a head of Operations (Samia Demo), for
the second approval of the purchases, a treasurer (Nadia Demo), for the finance module, and a Team Manager
(Omar Demo), who sees the whole team's dashboard and ranking (decision D-025: the Board and the Team Manager). frontend/playwright.config.ts runs it before starting the API:

    DB_NAME=enp_racing_team_erp_e2e REDIS_URL=redis://localhost:6379/1 python manage.py e2e_reset

It drops a whole database and empties the cache, so it refuses to run unless DEBUG is on, the
database name ends with "_e2e" and the cache is not Redis database 0 (the development one).
"""

from urllib.parse import urlparse

import psycopg
from django.conf import settings
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from psycopg import sql

from apps.members.models import Member, Membership, OrgUnit, Role
from apps.finance.access import BUREAU_UNIT, TREASURER_ROLE
from apps.purchasing.access import OPERATIONS_UNIT

E2E_SUFFIX = "_e2e"
SEEDS = ["seed_org_units", "seed_roles", "seed_lifecycle_steps", "seed_demo"]
# One demo person gets a phone number, to check in the browser who may see it. Fictitious: "000"
# is no operator prefix.
DEMO_PHONE = ("rayan.demo@example.invalid", "+213 000 00 00 01")
# key, first name, skill, role, unit: the people e2e_reset adds to the demo.
EXTRA_PEOPLE = [
    ("samia", "Samia", "Opérations et partenariats", "operations-lead", OPERATIONS_UNIT),
    ("nadia", "Nadia", "Trésorerie", TREASURER_ROLE, BUREAU_UNIT),
    ("omar", "Omar", "Team Manager", "team-manager", "fs-team"),
]


def e2e_settings_problems(debug, databases, caches):
    """Why these settings must not be used by e2e_reset (empty list: safe)."""
    problems = []
    if not debug:
        problems.append("DEBUG must be True (development only)")
    name = databases["default"]["NAME"]
    if not str(name).endswith(E2E_SUFFIX):
        problems.append(f"the database name must end with '{E2E_SUFFIX}', got '{name}' (set DB_NAME)")
    location = caches["default"].get("LOCATION", "")
    if "redis" in caches["default"].get("BACKEND", "").lower():
        redis_db = urlparse(str(location)).path.strip("/") or "0"
        if redis_db == "0":
            problems.append(f"the cache must not be Redis database 0, got '{location}' (set REDIS_URL)")
    return problems


class Command(BaseCommand):
    help = "Recreate the end-to-end test database: reference data and fictitious demo people only."
    requires_system_checks = []  # the database may not exist yet

    def handle(self, *args, **options):
        problems = e2e_settings_problems(settings.DEBUG, settings.DATABASES, settings.CACHES)
        if problems:
            raise CommandError("e2e_reset refused: " + "; ".join(problems) + ".")

        database = settings.DATABASES["default"]
        connections.close_all()
        self._recreate(database)
        self.stdout.write(f"Database '{database['NAME']}' recreated, applying the migrations…")
        call_command("migrate", interactive=False, verbosity=0)
        for name in SEEDS:
            call_command(name, stdout=self.stdout, stderr=self.stderr)
        email, phone = DEMO_PHONE
        Member.objects.filter(email=email).update(phone=phone)
        self._extra_people()
        cache.clear()  # login limits (codes asked per hour, resend delay)

        self.stdout.write(self.style.SUCCESS(
            f"E2E database ready: {Member.objects.count()} fictitious members, empty cache."
        ))

    def _extra_people(self):
        for key, first_name, skill, role, unit in EXTRA_PEOPLE:
            person = Member.objects.create_user(
                email=f"{key}.demo@example.invalid", password=None, code=f"demo-{key}", first_name=first_name,
                last_name="Demo", skill=skill,
            )
            Membership.objects.create(
                member=person, org_unit=OrgUnit.objects.get(code=unit), role=Role.objects.get(code=role),
                is_primary=True,
            )

    def _recreate(self, database):
        """DROP then CREATE the database, from the server's maintenance database."""
        with psycopg.connect(
            dbname="postgres",
            user=database["USER"],
            password=database["PASSWORD"],
            host=database["HOST"],
            port=database["PORT"],
            autocommit=True,
            connect_timeout=5,
        ) as connection:
            name = sql.Identifier(database["NAME"])
            connection.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(name))
            connection.execute(sql.SQL("CREATE DATABASE {}").format(name))
