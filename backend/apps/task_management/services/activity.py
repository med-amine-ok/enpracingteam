"""The operational audit trail (specification §15): every service that changes something calls `log` inside
its transaction. Scoring changes go to ranking.ranking_audit_log instead (`scoring_audit`)."""

from decimal import Decimal

from ..models import ActivityLog, Deliverable, RankingAuditLog, WorkOrder


def plain(value):
    """JSON-friendly copy of a value (dates and decimals as text)."""
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def log(entity_type, entity_id, action, actor, *, old=None, new=None, reason="", deliverable=None, work_order=None):
    if deliverable is not None and work_order is None:
        work_order = deliverable.work_order
    return ActivityLog.objects.create(
        entity_type=entity_type, entity_id=entity_id, action=action, actor=actor,
        old_value=plain(old or {}), new_value=plain(new or {}), reason=reason or "",
        deliverable=deliverable if isinstance(deliverable, Deliverable) else None,
        work_order=work_order if isinstance(work_order, WorkOrder) else None,
    )


def scoring_audit(action, entity_type, entity_id, actor, *, old=None, new=None, reason=""):
    return RankingAuditLog.objects.create(
        action=action, entity_type=entity_type, entity_id=entity_id, actor=actor,
        old_value=plain(old or {}), new_value=plain(new or {}), reason=reason or "",
    )
