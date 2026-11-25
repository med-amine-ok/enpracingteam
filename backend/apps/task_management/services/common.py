from django.db import connection
from django.utils import timezone
from rest_framework.exceptions import ValidationError


def refuse(message, field="detail"):
    raise ValidationError({field: [message]})


def require_reason(reason, message="Give the reason for this change."):
    reason = (reason or "").strip()
    if not reason:
        refuse(message, "reason")
    return reason


def now():
    return timezone.now()


def club_day(moment):
    """The day of `moment` in the club's timezone (Africa/Algiers): days are counted there (plan OQ-2)."""
    return timezone.localdate(moment)


def lock_dependency_graph():
    """Serialises every change of the dependency graph, so that two links added at once cannot make a cycle
    together (§10.8): a transaction-level advisory lock, released at commit."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext('task_management.dependency_graph'))")
