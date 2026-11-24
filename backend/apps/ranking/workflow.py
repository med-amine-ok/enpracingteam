"""
The changes of the monthly ranking (decision D-017): the department head's marks, the contribution points and the
publication of a month. The views check who may make them (access.py); these functions, that they may happen.
"""

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework.exceptions import ValidationError

from apps.communication import notify

from . import scoring
from .models import ContributionPoint, ContributionStatus, MonthlyAssessment, MonthlyScore, RankingPublication

# The criteria marked out of 5 that may be "N/A" with a reason (Ranking System §2.1).
NA_CRITERIA = (("workshop_mark", "workshop_na_reason"), ("events_mark", "events_na_reason"))


def save_assessment(member, month, data, actor):
    for mark, reason in NA_CRITERIA:
        if data.get(mark) is not None and (data.get(reason) or "").strip():
            raise ValidationError({reason: [_("Give a mark or a reason for N/A, not both.")]})
    assessment, _created = MonthlyAssessment.objects.update_or_create(
        member=member, month=month.first, defaults={**data, "assessed_by": actor}
    )
    return assessment


def add_contribution(member, points, description, occurred_on, actor, decides):
    """Proposed, for those who assess the member to decide; validated at once when one of them enters it."""
    if occurred_on > timezone.localdate():
        raise ValidationError({"occurred_on": [_("This date is still to come.")]})
    point = ContributionPoint.objects.create(
        member=member, points=points, description=description, occurred_on=occurred_on, proposed_by=actor,
    )
    if decides:
        decide(point, actor, True)
    else:
        notify.contribution_proposed(point, actor)
    return point


def decide(point, actor, approve, note=""):
    if point.status != ContributionStatus.PROPOSED:
        raise ValidationError({"detail": _("These points are already decided.")})
    if not approve and not note.strip():
        raise ValidationError({"note": [_("Say why they are refused.")]})
    point.status = ContributionStatus.VALIDATED if approve else ContributionStatus.REJECTED
    point.decided_by, point.decided_at, point.decision_note = actor, timezone.now(), note
    point.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
    notify.contribution_decided(point, actor)


@transaction.atomic
def publish(month, actor):
    """Keeps the scores of a past month as they are today; the members with a score are told."""
    if month.first >= scoring.month_of(timezone.localdate()).first:
        raise ValidationError({"detail": _("A month is published once it is over.")})
    rows = scoring.month_rows(month)
    publication, _created = RankingPublication.objects.update_or_create(
        month=month.first, defaults={"published_by": actor, "published_at": timezone.now()}
    )
    publication.scores.all().delete()
    MonthlyScore.objects.bulk_create([
        MonthlyScore(
            publication=publication, member=row["member"], delivery=row["delivery"],
            performance=row["performance"], load=row["load"], presence=row["presence"],
            reliability=row["reliability"], team=row["team"], final=row["final"], provisional=row["provisional"],
            ranking_score=row["ranking_score"], category=row["category"], rank=row["rank"],
            details=row["result"].details(),
        )
        for row in rows
    ])
    notify.ranking_published(publication, [row["member"] for row in rows if row["final"] is not None], actor)
    return publication
