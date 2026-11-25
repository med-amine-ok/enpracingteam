"""The database settings for a hosted PostgreSQL (Neon) through DATABASE_URL, and the DB_* form of this PC."""

from unittest import mock

import environ
from django.test import SimpleTestCase

from config.settings import database_settings

NEON_POOLED = (
    "postgresql://neondb_owner:secret@ep-quiet-sky-123456-pooler.eu-central-1.aws.neon.tech/neondb"
    "?sslmode=require&channel_binding=require"
)
NEON_DIRECT = NEON_POOLED.replace("-pooler", "")


def settings_with(**variables):
    """The database settings for exactly these variables (nothing else in the environment)."""
    with mock.patch.dict("os.environ", variables, clear=True):
        return database_settings(environ.Env())


class DatabaseUrlTests(SimpleTestCase):
    def test_a_neon_address_keeps_its_ssl_and_its_database(self):
        database = settings_with(DATABASE_URL=NEON_DIRECT)
        self.assertEqual(
            (database["ENGINE"], database["NAME"], database["USER"], database["HOST"]),
            ("django.db.backends.postgresql", "neondb", "neondb_owner", "ep-quiet-sky-123456.eu-central-1.aws.neon.tech"),
        )
        self.assertEqual(database["OPTIONS"], {"sslmode": "require", "channel_binding": "require"})
        self.assertNotIn("DISABLE_SERVER_SIDE_CURSORS", database)

    def test_the_pooled_address_turns_off_server_side_cursors(self):
        self.assertTrue(settings_with(DATABASE_URL=NEON_POOLED)["DISABLE_SERVER_SIDE_CURSORS"])

    def test_kept_connections_are_checked_before_use(self):
        database = settings_with(DATABASE_URL=NEON_DIRECT, DB_CONN_MAX_AGE="60")
        self.assertEqual((database["CONN_MAX_AGE"], database["CONN_HEALTH_CHECKS"]), (60, True))
        self.assertEqual(settings_with(DATABASE_URL=NEON_DIRECT)["CONN_HEALTH_CHECKS"], False)

    def test_without_database_url_the_db_variables_are_used(self):
        database = settings_with(DB_NAME="erp", DB_USER="enp", DB_PASSWORD="x", DB_HOST="localhost", DB_PORT="5432",
                                 DB_SSLMODE="require")
        self.assertEqual((database["NAME"], database["HOST"], database["OPTIONS"]), ("erp", "localhost",
                                                                                     {"sslmode": "require"}))
