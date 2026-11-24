# apps/members/checks.py

from django.conf import settings
from django.core.checks import Error, Tags, Warning, register

# Same thresholds as Django's own deployment check (security.W009).
MIN_SECRET_KEY_LENGTH = 50
MIN_SECRET_KEY_UNIQUE_CHARACTERS = 5

GENERATE_HINT = (
    "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\" "
    "(letters, digits, - and _ only: '$' and '#' would be misread in .env files) and put it in "
    "the .env at the root of the project as SECRET_KEY=<value>. Changing it logs everyone out "
    "(sessions, JWT cookies, pending OTP codes)."
)


@register(Tags.security)
def check_secret_key_strength(app_configs, **kwargs):
    """
    SECRET_KEY signs the admin sessions, the JWT access/refresh tokens (HS256) and the OTP
    HMAC digests. A short or guessable key (e.g. the old example value "changeme") lets anyone
    forge a valid login cookie, so refuse to run with one - in development too, because local
    .env files are often copied to servers unchanged.
    """
    key = getattr(settings, "SECRET_KEY", "") or ""
    if len(key) < MIN_SECRET_KEY_LENGTH or len(set(key)) < MIN_SECRET_KEY_UNIQUE_CHARACTERS:
        return [
            Error(
                f"SECRET_KEY is too weak ({len(key)} characters, {len(set(key))} distinct): "
                f"it must have at least {MIN_SECRET_KEY_LENGTH} characters and "
                f"{MIN_SECRET_KEY_UNIQUE_CHARACTERS} distinct ones.",
                hint=GENERATE_HINT,
                id="members.E001",
            )
        ]
    return []


@register()
def check_one_settings_file(app_configs, **kwargs):
    """Since 23/10/2026 the settings of this PC are in one file, .env at the root of the project, which
    Docker Compose reads too (decision D-023): a backend/.env left from before is only read for what
    the root one lacks, and two files drift apart."""
    legacy = getattr(settings, "LEGACY_ENV_FILE", None)
    if legacy is not None and legacy.is_file():
        return [
            Warning(
                "backend/.env is no longer needed: the settings are read from the .env at the root of the project.",
                hint="Move its lines into the root .env (DB_NAME, DB_USER and DB_PASSWORD there replace "
                     "POSTGRES_DB, POSTGRES_USER and POSTGRES_PASSWORD), then delete backend/.env.",
                id="members.W001",
            )
        ]
    return []
