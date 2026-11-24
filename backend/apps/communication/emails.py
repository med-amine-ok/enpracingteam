"""
The e-mails of the notifications (apps/communication/notify.py EMAILED), in the language each
person chose in their profile (else the site's). Sent through Django's task framework
(settings.TASKS): at once on this computer, by a worker in production, without changing this code.
"""

from decimal import Decimal

from django.conf import settings
from django.core.mail import send_mail
from django.tasks import task
from django.utils import formats, timezone, translation
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.translation import gettext as _, ngettext

from apps.members.models import ALWAYS_EMAILED, EmailTopic, Member
from apps.subsystems.models import step_display_name
from apps.tasks.models import BlockerSeverity

from .models import Notification, NotificationKind as Kind

# The subject of each e-mailed kind (apps/communication/notify.py EMAILED): a member may turn a subject
# off in their profile (decision D-023), except the warnings and exclusions.
TOPICS = {
    Kind.TASK_ASSIGNED: EmailTopic.TASKS, Kind.VALIDATION_REQUESTED: EmailTopic.TASKS,
    Kind.TASK_DUE_SOON: EmailTopic.TASKS, Kind.TASK_OVERDUE: EmailTopic.TASKS, Kind.TASK_SUBMITTED: EmailTopic.TASKS,
    Kind.TASK_REVISION: EmailTopic.TASKS, Kind.BLOCKER_DECLARED: EmailTopic.TASKS,
    Kind.PURCHASE_APPROVAL_REQUESTED: EmailTopic.PURCHASES, Kind.PURCHASE_TO_ORDER: EmailTopic.PURCHASES,
    Kind.STOCK_LOW: EmailTopic.PURCHASES, Kind.BUDGET_EXCEEDED: EmailTopic.PURCHASES,
    Kind.MEETING_UPDATED: EmailTopic.SESSIONS, Kind.MEETING_REMINDER: EmailTopic.SESSIONS,
    Kind.ACTION_ASSIGNED: EmailTopic.SESSIONS,
    Kind.LOAN_REQUESTED: EmailTopic.WORKSHOP, Kind.LOAN_OVERDUE: EmailTopic.WORKSHOP,
    Kind.RESERVATION_CANCELLED: EmailTopic.WORKSHOP,
    Kind.RANKING_PUBLISHED: EmailTopic.RANKING, Kind.RANKING_TO_PUBLISH: EmailTopic.RANKING,
    Kind.VOLUNTEERING_REMINDER: EmailTopic.VOLUNTEERING,
    Kind.WARNING_REPORTED: EmailTopic.DISCIPLINE, Kind.WARNING_ISSUED: EmailTopic.DISCIPLINE,
    Kind.EXCLUSION_PENDING: EmailTopic.DISCIPLINE,
}


def wants_email(member, kind):
    """Whether `member` receives the e-mail of a notification of this kind (read when it is sent, so that a
    choice made meanwhile counts)."""
    topic = TOPICS.get(kind)
    return topic is None or topic in ALWAYS_EMAILED or topic not in (member.muted_email_topics or [])


def page_url(notification, language):
    """The ERP page of what the notification is about."""
    if notification.related_entity_type == "subsystem":
        return f"{settings.FRONTEND_URL}/{language}/projects/{notification.data['project_id']}?tab=subsystems"
    if notification.related_entity_type == "stock_item":
        return f"{settings.FRONTEND_URL}/{language}/stock/{notification.related_entity_id}"
    if notification.related_entity_type == "budget":
        return f"{settings.FRONTEND_URL}/{language}/finance/budgets/{notification.related_entity_id}"
    if notification.related_entity_type == "document":
        return f"{settings.FRONTEND_URL}/{language}/documents/{notification.related_entity_id}"
    if notification.related_entity_type in ("objective", "training", "volunteering"):
        tab = {"objective": "objectives", "training": "trainings", "volunteering": ""}[notification.related_entity_type]
        return f"{settings.FRONTEND_URL}/{language}/engagement" + (f"/{tab}" if tab else "")
    if notification.related_entity_type == "warning":
        return f"{settings.FRONTEND_URL}/{language}/discipline/warnings/{notification.related_entity_id}"
    if notification.related_entity_type in ("discipline_report", "exclusion"):
        return f"{settings.FRONTEND_URL}/{language}/discipline"
    if notification.related_entity_type == "ranking":
        return f"{settings.FRONTEND_URL}/{language}/ranking"
    if notification.related_entity_type == "equipment":
        return f"{settings.FRONTEND_URL}/{language}/workshop/{notification.related_entity_id}"
    if notification.related_entity_type == "meeting":
        return f"{settings.FRONTEND_URL}/{language}/meetings/{notification.related_entity_id}"
    if notification.related_entity_type == "purchase_request":
        return f"{settings.FRONTEND_URL}/{language}/purchasing/requests/{notification.related_entity_id}"
    return f"{settings.FRONTEND_URL}/{language}/tasks/{notification.related_entity_id}"


def dinars(amount):
    """An amount in dinars, written the way of the active language (200 000,00 in French)."""
    return formats.number_format(Decimal(amount), decimal_pos=2, use_l10n=True, force_grouping=True)


def compose(notification):
    """Subject and lines of the e-mail, in the active language (None: this kind is not e-mailed)."""
    data = notification.data
    if notification.kind == Kind.TASK_ASSIGNED:
        actor = notification.actor
        name = f"{actor.first_name} {actor.last_name}" if actor else ""
        lines = [_("%(actor)s assigned you the task “%(task)s” (project %(project)s).") % {**data, "actor": name}]
        if data.get("primary_id") == notification.member_id:
            lines.append(_("You are its main assignee."))
        return _("Task assigned to you: %(task)s") % data, lines
    if notification.kind == Kind.VALIDATION_REQUESTED:
        values = {**data, "step": step_display_name(data["step"])}
        return _("Validation awaited: %(subsystem)s") % values, [
            _("The steps of the subsystem “%(subsystem)s” (project %(project)s) before “%(step)s” are done: "
              "it awaits your validation.") % values
        ]
    if notification.kind in (Kind.TASK_DUE_SOON, Kind.TASK_OVERDUE):
        due = parse_date(data["due_date"])
        values = {**data, "date": formats.date_format(due, "DATE_FORMAT")}
        if notification.kind == Kind.TASK_OVERDUE:
            return _("🔴 Overdue: %(task)s") % values, [
                _("The task “%(task)s” (project %(project)s) was due on %(date)s and is still not done.") % values
            ]
        days = (due - timezone.localdate()).days
        subject = (
            ngettext("Due in %(days)d day: %(task)s", "Due in %(days)d days: %(task)s", days) % {**values, "days": days}
            if days > 0
            else _("Due today: %(task)s") % values
        )
        return subject, [
            _("The task “%(task)s” (project %(project)s) is due on %(date)s and is not done yet.") % values
        ]
    if notification.kind == Kind.PURCHASE_APPROVAL_REQUESTED:
        if data["level"] == "operations":
            return _("Purchase to approve (Operations): %(part)s") % data, [
                _("%(requester)s asks for %(quantity)s × “%(part)s”; their leader approved it: it awaits the "
                  "approval of Operations.") % data
            ]
        return _("Purchase to approve: %(part)s") % data, [
            _("%(requester)s asks for %(quantity)s × “%(part)s”: it awaits your approval.") % data
        ]
    if notification.kind == Kind.STOCK_LOW:
        values = {**data, "place": data["location"] or _("place not given")}
        return _("Low stock: %(part)s") % values, [
            _("%(quantity)s left of “%(part)s” (%(place)s), at or below its threshold of %(threshold)s: "
              "think of asking for a purchase.") % values
        ]
    if notification.kind == Kind.BUDGET_EXCEEDED:
        values = {**data, "allocated": dinars(data["allocated"]), "spent": dinars(data["spent"])}
        return _("Budget exceeded: %(unit)s %(fiscal_year)s") % values, [
            _("The expenses of %(unit)s for %(fiscal_year)s (%(spent)s DA) are now above its budget of "
              "%(allocated)s DA.") % values
        ]
    if notification.kind in (Kind.TASK_SUBMITTED, Kind.TASK_REVISION, Kind.BLOCKER_DECLARED):
        actor = notification.actor
        values = {**data, "actor": f"{actor.first_name} {actor.last_name}" if actor else _("Someone")}
        if notification.kind == Kind.TASK_SUBMITTED:
            return _("To validate: %(task)s") % values, [
                _("%(actor)s submitted the task “%(task)s” (project %(project)s): it awaits your validation "
                  "and its quality mark.") % values
            ]
        if notification.kind == Kind.TASK_REVISION:
            return _("To rework: %(task)s") % values, [
                _("%(actor)s sent the task “%(task)s” (project %(project)s) back for revision: “%(excerpt)s”")
                % values
            ]
        values["severity"] = BlockerSeverity(data["severity"]).label
        return _("Blocker on: %(task)s") % values, [
            _("%(actor)s declared a blocker (%(severity)s) on the task “%(task)s” (project %(project)s): "
              "“%(excerpt)s”. It awaits your decision.") % values
        ]
    if notification.kind in (Kind.MEETING_SCHEDULED, Kind.MEETING_UPDATED, Kind.MEETING_REMINDER):
        when = formats.date_format(timezone.localtime(parse_datetime(data["starts_at"])), "DATETIME_FORMAT")
        values = {**data, "when": when, "place": data["location"] or _("place not given")}
        mandatory = [_("Your presence is mandatory: it counts in the presence score.")] if data["mandatory"] else []
        if notification.kind == Kind.MEETING_SCHEDULED:
            return _("Session: %(meeting)s, %(when)s") % values, [
                _("You are invited to “%(meeting)s” on %(when)s (%(place)s).") % values, *mandatory
            ]
        if notification.kind == Kind.MEETING_REMINDER:
            return _("Reminder: %(meeting)s, %(when)s") % values, [
                _("Reminder: “%(meeting)s” takes place on %(when)s (%(place)s).") % values, *mandatory
            ]
        if data.get("cancelled"):
            lines = [_("The session “%(meeting)s” of %(when)s is cancelled.") % values]
            if data.get("reason"):
                lines.append(_("Reason: %(reason)s") % data)
            return _("Cancelled: %(meeting)s") % values, lines
        return _("Changed: %(meeting)s") % values, [
            _("The session “%(meeting)s” changed: it now takes place on %(when)s (%(place)s).") % values
        ]
    if notification.kind == Kind.ACTION_ASSIGNED:
        actor = notification.actor
        values = {**data, "actor": f"{actor.first_name} {actor.last_name}" if actor else _("Someone")}
        lines = [_("%(actor)s gave you an action after the session “%(meeting)s”: “%(excerpt)s”.") % values]
        if data.get("due_date"):
            due = formats.date_format(parse_date(data["due_date"]), "DATE_FORMAT")
            lines.append(_("To do by %(date)s.") % {"date": due})
        return _("Action for you: %(meeting)s") % values, lines
    if notification.kind == Kind.LOAN_REQUESTED:
        actor = notification.actor
        values = {**data, "actor": f"{actor.first_name} {actor.last_name}" if actor else _("Someone"),
                  "date": formats.date_format(parse_date(data["due_date"]), "DATE_FORMAT")}
        return _("Loan to decide: %(equipment)s") % values, [
            _("%(actor)s asks to borrow “%(equipment)s” until %(date)s: “%(excerpt)s”.") % values
        ]
    if notification.kind == Kind.LOAN_OVERDUE:
        values = {**data, "date": formats.date_format(parse_date(data["due_date"]), "DATE_FORMAT")}
        return _("Loan overdue: %(equipment)s") % values, [
            _("“%(equipment)s” was to be back on %(date)s: bring it back to the workshop.") % values
        ]
    if notification.kind == Kind.RESERVATION_CANCELLED:
        when = formats.date_format(timezone.localtime(parse_datetime(data["reserved_from"])), "DATETIME_FORMAT")
        values = {**data, "when": when}
        lines = [_("Your reservation of “%(equipment)s” on %(when)s is cancelled.") % values]
        if data.get("unavailable"):
            lines.append(_("The equipment is in maintenance or out of service."))
        elif data.get("excerpt"):
            lines.append(_("Reason: %(reason)s") % {"reason": data["excerpt"]})
        return _("Reservation cancelled: %(equipment)s") % values, lines
    if notification.kind in (Kind.RANKING_PUBLISHED, Kind.RANKING_TO_PUBLISH):
        month = formats.date_format(parse_date(f"{data['month']}-01"), "YEAR_MONTH_FORMAT")
        if notification.kind == Kind.RANKING_PUBLISHED:
            return _("Ranking of %(month)s published") % {"month": month}, [
                _("The monthly ranking of %(month)s is published: your score and your category are in the ERP.")
                % {"month": month},
                _("The ranking supports feedback and development; it never triggers a sanction by itself."),
            ]
        return _("Ranking to publish: %(month)s") % {"month": month}, [
            _("%(month)s is over: check the scores and the department heads' marks, then publish the ranking "
              "(within 7 days).") % {"month": month}
        ]
    if notification.kind in (Kind.WARNING_REPORTED, Kind.WARNING_ISSUED, Kind.EXCLUSION_PENDING):
        from apps.discipline.models import ExclusionCause, Ground

        actor = notification.actor
        values = {**data, "actor": f"{actor.first_name} {actor.last_name}" if actor else _("Someone"),
                  "level": data.get("number", "")}
        if notification.kind == Kind.WARNING_REPORTED:
            values["ground"] = Ground(data["ground"]).label
            return _("Breach reported: %(member)s") % values, [
                _("%(actor)s reported a breach by %(member)s (%(ground)s). As their project manager or the Bureau, "
                  "you decide what follows: a warning, or nothing with a reason.") % values
            ]
        if notification.kind == Kind.WARNING_ISSUED:
            return _("Warning no. %(level)s of the season") % values, [
                _("You received warning no. %(level)s of the season (charter, art. 27). In the ERP: the rule "
                  "concerned and what is expected to correct it; you may give your version.") % values
            ]
        values["cause"] = ExclusionCause(data["cause"]).label
        return _("Exclusion to confirm: %(member)s") % values, [
            _("An exclusion of %(member)s awaits the Bureau's confirmation (%(cause)s).") % values
        ]
    if notification.kind == Kind.VOLUNTEERING_REMINDER:
        month = formats.date_format(parse_date(f"{data['month']}-01"), "YEAR_MONTH_FORMAT")
        return _("Volunteering of %(month)s") % {"month": month}, [
            _("No volunteering is validated for you yet in %(month)s: the charter (art. 21) asks each member for a "
              "day or a period of volunteering every month. Join an activity, or organise one in the ERP.")
            % {"month": month}
        ]
    if notification.kind == Kind.PURCHASE_TO_ORDER:
        return _("To order: %(part)s") % data, [
            _("The request of %(requester)s for %(quantity)s × “%(part)s” is approved: it is to be ordered.") % data
        ]
    return None


@task
def send_notification_email(notification_id):
    notification = Notification.objects.select_related("member", "actor").filter(pk=notification_id).first()
    if notification is None or not notification.member.email:
        return
    if not wants_email(notification.member, notification.kind):
        return
    language = notification.member.language or settings.LANGUAGE_CODE
    with translation.override(language):
        composed = compose(notification)
        if composed is None:
            return
        subject, lines = composed
        message = "\n".join([
            *lines,
            "",
            _("Open it in the ERP: %(url)s") % {"url": page_url(notification, language)},
            "",
            _("You receive this e-mail because this work concerns you in the ENP Racing Team ERP."),
        ])
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[notification.member.email],
    )


@task
def send_welcome_email(member_id, added_by_id=None):
    """A member just added from the web app (decision D-024) learns how to sign in: their address, then a
    code e-mailed to it; no password. In their language when they have one, else the site's."""
    member = Member.objects.filter(pk=member_id).first()
    if member is None or not member.email:
        return
    added_by = Member.objects.filter(pk=added_by_id).first() if added_by_id else None
    membership = member.memberships.select_related("org_unit", "role").filter(end_date__isnull=True).first()
    language = member.language or settings.LANGUAGE_CODE
    with translation.override(language):
        lines = [_("Hello %(name)s,") % {"name": member.first_name}, ""]
        if membership is not None:
            values = {"role": membership.role.name, "unit": membership.org_unit.name}
            if added_by is not None:
                values["by"] = f"{added_by.first_name} {added_by.last_name}"
                lines.append(_("%(by)s added you to the ENP Racing Team ERP: %(role)s, %(unit)s.") % values)
            else:
                lines.append(_("You were added to the ENP Racing Team ERP: %(role)s, %(unit)s.") % values)
        lines += [
            "",
            _("To sign in, open %(url)s and type this e-mail address: a code is sent to it, no password is "
              "needed.") % {"url": f"{settings.FRONTEND_URL}/{language}/login"},
            "",
            _("You receive this e-mail because you are a member of the ENP Racing Team."),
        ]
        subject = _("Welcome to the ENP Racing Team ERP")
    send_mail(
        subject=subject, message="\n".join(lines), from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[member.email],
    )
