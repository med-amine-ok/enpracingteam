"""
The changes of the warnings and exclusions (decision D-018, charter art. 27-28). The views check who may make
them (access.py); these functions check that they may happen now and tell the people concerned.
"""

from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework.exceptions import ValidationError

from apps.communication import notify
from apps.meetings import workflow as meeting_workflow
from apps.meetings.models import Meeting, MeetingKind
from apps.members.models import Member
from apps.members.services import revoke_rights, sync_executive_bureau

from .access import OPEN_PROJECTS
from .models import (
    Exclusion, ExclusionCause, ExclusionStatus, MemberWarning, Report, ReportStatus, WarningStatus, season_of,
)

MAX_WARNINGS = 3  # the third means exclusion (art. 27.6)
COUNCIL_LEVEL = 2  # the second calls a council (art. 27.5)


def active_warnings(member, season):
    return MemberWarning.objects.filter(member=member, season=season, status=WarningStatus.ACTIVE)


def standing(member, today=None):
    season = season_of(today or timezone.localdate())
    count = active_warnings(member, season).count()
    return {"season": season, "active_warnings": count, "next_level": min(count + 1, MAX_WARNINGS + 1)}


# --- Reports (art. 27.3) ---


def report(member, ground, facts, actor):
    created = Report.objects.create(member=member, ground=ground, facts=facts, reported_by=actor)
    notify.breach_reported(created, actor)
    return created


def check_open(report_):
    if report_.status != ReportStatus.OPEN:
        raise ValidationError({"detail": _("This report is already handled.")})


def dismiss(report_, actor, note):
    check_open(report_)
    if not note.strip():
        raise ValidationError({"note": [_("Say why it is dismissed.")]})
    report_.status, report_.handled_by, report_.handled_at, report_.handling_note = (
        ReportStatus.DISMISSED, actor, timezone.now(), note
    )
    report_.save(update_fields=["status", "handled_by", "handled_at", "handling_note"])


# --- Warnings (art. 27.4-27.6) ---


def council_people(member, project, actor):
    """The council (art. 27.5): the Team Manager, the project manager, the department heads, the member, and who
    gave the warning."""
    people = {member.pk: member, actor.pk: actor}
    for manager in notify.team_managers_or_admins():
        people[manager.pk] = manager
    managers = [project.project_manager] if project and project.project_manager else [
        link.project.project_manager
        for link in member.project_memberships.filter(is_active=True, project__status__in=OPEN_PROJECTS)
        .select_related("project__project_manager")
        if link.project.project_manager is not None
    ]
    for person in managers:
        people[person.pk] = person
    for membership in member.memberships.filter(end_date__isnull=True).select_related("org_unit"):
        for leader in notify.unit_leaders(membership.org_unit):
            people[leader.pk] = leader
    return [person for person in people.values() if person.is_active]


def schedule_council(member, project, actor, council):
    starts, ends, location = council.get("starts_at"), council.get("ends_at"), council.get("location", "")
    if starts is None or ends is None:
        raise ValidationError({"council_starts_at": [_("A second warning calls a council: give its date and time.")]})
    if ends <= starts:
        raise ValidationError({"council_ends_at": [_("The end must come after the start.")]})
    if starts <= timezone.now():
        raise ValidationError({"council_starts_at": [_("The council is still to come.")]})
    meeting = Meeting.objects.create(
        title=_("Council (art. 27.5): %(member)s") % {"member": f"{member.first_name} {member.last_name}"},
        kind=MeetingKind.COUNCIL, org_unit=None, starts_at=starts, ends_at=ends, location=location,
        agenda=_("Second warning: the member presents their version; the council decides corrective measures or a "
                 "sanction."),
        is_mandatory=False, organiser=actor, created_by=actor,
    )
    invited = meeting_workflow.invite(meeting, council_people(member, project, actor))
    notify.meeting_scheduled(meeting, invited, actor, email=True)
    return meeting


def issue(member, data, actor, project=None, report_=None, council=None):
    """A warning numbered in the season; the second calls a council, the third prepares an exclusion."""
    if report_ is not None:
        check_open(report_)
        if report_.member_id != member.pk:
            raise ValidationError({"report_id": [_("This report is about another member.")]})
    # Lock the member: two warnings given at the same moment would otherwise both get the same level.
    Member.objects.select_for_update().filter(pk=member.pk).first()
    season = season_of(timezone.localdate())
    level = active_warnings(member, season).count() + 1
    if level > MAX_WARNINGS:
        raise ValidationError({"detail": _("This member already has three warnings this season: see the exclusion.")})
    meeting = schedule_council(member, project, actor, council or {}) if level == COUNCIL_LEVEL else None
    warning = MemberWarning.objects.create(
        member=member, level=level, season=season, project=project, report=report_, issued_by=actor, council=meeting,
        **data,
    )
    if report_ is not None:
        report_.status, report_.handled_by, report_.handled_at = ReportStatus.WARNED, actor, timezone.now()
        report_.save(update_fields=["status", "handled_by", "handled_at"])
    notify.warning_issued(warning, actor)
    # An exclusion already awaiting confirmation (an immediate one, art. 28) covers the third warning too: only
    # one may be pending (uq_exclusion_one_pending).
    if level == MAX_WARNINGS and not Exclusion.objects.filter(member=member, status=ExclusionStatus.PENDING).exists():
        exclusion = Exclusion.objects.create(
            member=member, cause=ExclusionCause.THIRD_WARNING, warning=warning, proposed_by=actor,
        )
        notify.exclusion_pending(exclusion, actor)
    return warning


def respond(warning, text):
    if warning.status != WarningStatus.ACTIVE:
        raise ValidationError({"detail": _("This warning is cancelled.")})
    warning.member_response, warning.responded_at = text, timezone.now()
    warning.save(update_fields=["member_response", "responded_at"])


def record_council(warning, actor, decision):
    if warning.council_id is None:
        raise ValidationError({"detail": _("Only a second warning has a council.")})
    if not decision.strip():
        raise ValidationError({"decision": [_("Write the council's decision.")]})
    warning.council_decision, warning.council_decided_by, warning.council_decided_at = (
        decision, actor, timezone.now()
    )
    warning.save(update_fields=["council_decision", "council_decided_by", "council_decided_at"])


def cancel(warning, actor, reason):
    if warning.status != WarningStatus.ACTIVE:
        raise ValidationError({"detail": _("This warning is already cancelled.")})
    if not reason.strip():
        raise ValidationError({"reason": [_("Say why it is cancelled.")]})
    warning.status, warning.cancelled_by, warning.cancelled_at, warning.cancel_reason = (
        WarningStatus.CANCELLED, actor, timezone.now(), reason
    )
    warning.save(update_fields=["status", "cancelled_by", "cancelled_at", "cancel_reason"])
    pending = Exclusion.objects.filter(warning=warning, status=ExclusionStatus.PENDING).first()
    if pending is not None:
        abandon(pending, actor, _("Its warning was cancelled."))
    # An earlier warning cancelled: fewer than three remain, so the third warning's exclusion has no ground left.
    if active_warnings(warning.member, warning.season).count() < MAX_WARNINGS:
        for pending in Exclusion.objects.filter(
            member_id=warning.member_id, cause=ExclusionCause.THIRD_WARNING, status=ExclusionStatus.PENDING
        ):
            abandon(pending, actor, _("A warning was cancelled: fewer than three remain this season."))


# --- Exclusions (art. 27.6 and 28) ---


def propose_exclusion(member, serious_ground, facts, actor):
    if Exclusion.objects.filter(member=member, status=ExclusionStatus.PENDING).exists():
        raise ValidationError({"detail": _("An exclusion of this member already awaits its confirmation.")})
    exclusion = Exclusion.objects.create(
        member=member, cause=ExclusionCause.IMMEDIATE, serious_ground=serious_ground, facts=facts, proposed_by=actor,
    )
    notify.exclusion_pending(exclusion, actor)
    return exclusion


def check_pending(exclusion):
    if exclusion.status != ExclusionStatus.PENDING:
        raise ValidationError({"detail": _("This exclusion is already decided.")})


def confirm(exclusion, actor):
    """Applied: the account is deactivated and the memberships end today; the history stays."""
    check_pending(exclusion)
    member = Member.objects.select_for_update().get(pk=exclusion.member_id)
    member.is_active = False
    member.save(update_fields=["is_active"])
    member.memberships.filter(end_date__isnull=True).update(end_date=timezone.localdate())
    # update() sends no signal: bring the Executive Bureau and the Admins/Department Heads groups up to date, so
    # an excluded leader does not get their rights back if the account is ever reactivated.
    sync_executive_bureau()
    revoke_rights(member)
    exclusion.status, exclusion.decided_by, exclusion.decided_at = ExclusionStatus.CONFIRMED, actor, timezone.now()
    exclusion.save(update_fields=["status", "decided_by", "decided_at"])


def abandon(exclusion, actor, note):
    check_pending(exclusion)
    if not note.strip():
        raise ValidationError({"note": [_("Say why it is abandoned.")]})
    exclusion.status, exclusion.decided_by, exclusion.decided_at, exclusion.decision_note = (
        ExclusionStatus.ABANDONED, actor, timezone.now(), note
    )
    exclusion.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
