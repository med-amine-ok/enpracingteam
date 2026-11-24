"""
The changes of the goals, trainings and volunteering (decision D-019). The views check who may make them
(access.py); these functions check that they may happen now and tell the people concerned.
"""

from datetime import date, timedelta

from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework.exceptions import ValidationError

from apps.communication import notify
from apps.discipline.models import season_of
from apps.members.models import Member, MemberStatus, Membership

from .models import Objective, Training, TrainingStatus, VolunteeringActivity, VolunteeringStatus

# What the member changes in their own goal; the head changes everything.
MEMBER_GOAL_FIELDS = {"progress", "member_note"}


def team_members():
    """The members of the team: active accounts with a membership in progress, alumni excepted."""
    active = Membership.objects.filter(end_date__isnull=True).values("member_id")
    return Member.objects.filter(is_active=True, pk__in=active).exclude(status=MemberStatus.ALUMNI)


def month_bounds(day):
    first = day.replace(day=1)
    return first, (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)


# --- Goals ---


def set_goal(member, data, actor):
    goal = Objective.objects.create(member=member, season=season_of(timezone.localdate()), set_by=actor, **data)
    notify.objective_set(goal, actor)
    return goal


def change_goal(goal, data, actor, as_head):
    if not as_head and set(data) - MEMBER_GOAL_FIELDS:
        return False
    for name, value in data.items():
        setattr(goal, name, value)
    if as_head and ("status" in data or "assessment_note" in data):
        goal.assessed_by, goal.assessed_at = actor, timezone.now()
    goal.save()
    return True


# --- Trainings ---


def wish(member, topic, reason):
    return Training.objects.create(member=member, topic=topic, reason=reason)


def record_followed(member, topic, followed_on, actor, note=""):
    return Training.objects.create(
        member=member, topic=topic, status=TrainingStatus.FOLLOWED, followed_on=followed_on or timezone.localdate(),
        note=note, updated_by=actor,
    )


def check_open(training):
    if training.status in (TrainingStatus.FOLLOWED, TrainingStatus.DROPPED):
        raise ValidationError({"detail": _("This training is already followed or dropped.")})


def plan(training, actor, session=None, note=""):
    check_open(training)
    training.status, training.session, training.updated_by = TrainingStatus.PLANNED, session, actor
    if note:
        training.note = note
    training.save(update_fields=["status", "session", "updated_by", "note", "updated_at"])
    notify.training_planned(training, actor)


def follow(training, actor, followed_on, note=""):
    check_open(training)
    training.status, training.followed_on, training.updated_by = TrainingStatus.FOLLOWED, followed_on, actor
    if note:
        training.note = note
    training.save(update_fields=["status", "followed_on", "updated_by", "note", "updated_at"])


def drop(training, actor, note=""):
    check_open(training)
    training.status, training.updated_by, training.note = TrainingStatus.DROPPED, actor, note or training.note
    training.save(update_fields=["status", "updated_by", "note", "updated_at"])


def withdraw(training):
    """The member removes a wish nobody has acted upon yet."""
    if training.status != TrainingStatus.WISHED:
        raise ValidationError({"detail": _("Only a wish not planned yet is withdrawn.")})
    training.delete()


# --- Volunteering (charter art. 21) ---


def organise(organiser, data, participants):
    if data["date"] > timezone.localdate():
        raise ValidationError({"date": [_("A volunteering day is recorded once it took place.")]})
    activity = VolunteeringActivity.objects.create(organiser=organiser, **data)
    activity.participants.set({organiser.pk, *(member.pk for member in participants)})
    notify.volunteering_to_validate(activity, organiser)
    return activity


def decide(activity, actor, approve, note=""):
    if activity.status != VolunteeringStatus.PROPOSED:
        raise ValidationError({"detail": _("This activity is already decided.")})
    if not approve and not note.strip():
        raise ValidationError({"note": [_("Say why it is refused.")]})
    activity.status = VolunteeringStatus.VALIDATED if approve else VolunteeringStatus.REFUSED
    activity.decided_by, activity.decided_at, activity.decision_note = actor, timezone.now(), note
    activity.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
    notify.volunteering_decided(activity, actor)


def covered(member_ids, day):
    """The members among `member_ids` with a validated volunteering in the month of `day`."""
    first, last = month_bounds(day)
    return set(
        VolunteeringActivity.participants.through.objects.filter(
            member_id__in=member_ids, volunteeringactivity__status=VolunteeringStatus.VALIDATED,
            volunteeringactivity__date__gte=first, volunteeringactivity__date__lte=last,
        ).values_list("member_id", flat=True)
    )


def months_covered(member, season):
    """The months ("2026-10") of the season in which the member has a validated volunteering."""
    start, end = date(season, 9, 1), date(season + 1, 8, 31)
    days = member.volunteering.filter(status=VolunteeringStatus.VALIDATED, date__gte=start, date__lte=end).values_list(
        "date", flat=True
    )
    return sorted({day.strftime("%Y-%m") for day in days})
