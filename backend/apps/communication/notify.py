"""
Who is told about what (knowledge base: PROJECTS/ERP/notifications_design.md, decided on 19/10/2026):

- a task assigned: the people added to it;
- a comment: the task's author and the people assigned to it;
- the steps of a task (PROJECTS/ERP/tasks_v2_design.md): submitted, its validators (the leaders of its
  unit, else of the nearest unit above, and the project manager; never one assigned to it; the club
  admins when there is none); validated or to rework, the people assigned to it; a blocker declared,
  its validators; validated, rejected or resolved, the people assigned and who declared it;
- the steps before "Validation par le chef" all done: the leaders of the subsystem's unit (else of
  the nearest unit above), who must sign it; once signed: the people assigned to the subsystem and
  the project manager;
- 3 days before a task's due date, then once it is past and the task is not done: the people linked
  to the task (assigned, author, project manager) — see deadline_reminders(), run once a day;
- a stock line reaching its threshold or going below (PROJECTS/ERP/stock_design.md): the stock
  managers (Operations, the workshop lead; the club admins when there is none);
- a session (PROJECTS/ERP/meetings_design.md): scheduled, changed or cancelled, its invitees; the day
  before a mandatory one, its invitees (meeting_reminders, run once a day); an excuse asked, the Team
  Manager (the admins when there is none); decided, who asked; an action, its responsible; the minutes
  published, the invitees;
- a purchase request (PROJECTS/ERP/purchasing_design.md): who must act next — its leaders (the
  unit's, else the nearest above, and the project manager), then the head of Operations, then all of
  Operations to order it (club admins when nobody else can approve) — and its requester at each step
  (plus Operations when a request they had to order is cancelled);
- the workshop (PROJECTS/ERP/workshop_design.md): a loan asked, the equipment managers (club admins when
  there is none); decided, its borrower; overdue, its borrower once (loan_reminders, run once a day); a
  reservation cancelled by someone else or because the equipment became unavailable, its author; a
  certification granted, the member;
- the monthly ranking (PROJECTS/ERP/ranking_design.md): contribution points proposed, the leaders of the
  member's units (else the Team Manager, else the admins); decided, the member and who proposed them; a month
  published, every member with a score (the e-mail never gives it); in the first week of a month, the Team
  Manager once, while the month before is not published (ranking_reminders, run once a day);
- the warnings (PROJECTS/ERP/discipline_design.md): a breach reported, the managers of the member's projects
  (else the Team Manager, else the admins); a warning given, the member (by e-mail) and their department
  heads (in the ERP only); an exclusion to confirm, the Executive Bureau (else the admins);
- goals, trainings, volunteering (PROJECTS/ERP/engagement_design.md): a goal set, the member; a training planned,
  the member; a volunteering activity to validate, the leaders of its organiser's units (else the Team Manager,
  else the admins); decided, its organiser and participants; from the 20th, each member without a validated
  volunteering in the month, once (volunteering_reminders, run once a day).

Never the person who acted, only active accounts, without duplicates. Assignments, awaited
validations, deadlines, purchases to approve or to order, low stock, budgets exceeded, tasks to validate
or to rework and blockers to decide are e-mailed too (EMAILED). The views
call these functions after the change; Django signals would not know who acted.
"""

from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.members.access import club_admins_filter
from apps.members.models import Member
from apps.purchasing.access import operations_staff
from apps.purchasing.models import PurchaseAction, PurchaseStatus
from apps.tasks.models import OPEN_STATUSES, BlockerStatus, Task, TaskAssignee

from .emails import send_notification_email
from .models import Notification, NotificationKind as Kind

EMAILED = {
    Kind.TASK_ASSIGNED, Kind.VALIDATION_REQUESTED, Kind.TASK_DUE_SOON, Kind.TASK_OVERDUE,
    Kind.PURCHASE_APPROVAL_REQUESTED, Kind.PURCHASE_TO_ORDER, Kind.STOCK_LOW, Kind.BUDGET_EXCEEDED,
    Kind.TASK_SUBMITTED, Kind.TASK_REVISION, Kind.BLOCKER_DECLARED,
    Kind.MEETING_UPDATED, Kind.MEETING_REMINDER, Kind.ACTION_ASSIGNED,
    Kind.LOAN_REQUESTED, Kind.LOAN_OVERDUE, Kind.RESERVATION_CANCELLED, Kind.RANKING_PUBLISHED,
    Kind.RANKING_TO_PUBLISH, Kind.WARNING_REPORTED, Kind.WARNING_ISSUED, Kind.EXCLUSION_PENDING,
    Kind.VOLUNTEERING_REMINDER,
}
EXCERPT_LENGTH = 140
REMIND_DAYS_BEFORE = 3


def notify(kind, recipients, *, target, data, actor=None, email=None):
    """One notification per recipient, e-mailed too once the change is saved: for the kinds in EMAILED,
    unless `email` says otherwise."""
    ids = {member.pk for member in recipients if member is not None}
    if actor is not None:
        ids.discard(actor.pk)
    members = Member.objects.filter(pk__in=ids, is_active=True).order_by("pk")
    target_type, target_id = target
    notifications = Notification.objects.bulk_create(
        Notification(
            member=member, kind=kind, actor=actor, data=data,
            related_entity_type=target_type, related_entity_id=target_id,
        )
        for member in members
    )
    if (kind in EMAILED if email is None else email) and notifications:
        sent = [notification.pk for notification in notifications]
        transaction.on_commit(lambda: [send_notification_email.enqueue(pk) for pk in sent])
    return notifications


# --- Tasks ---


def task_data(task):
    return {"task": task.title, "project": task.project.name}


def assignees(task):
    # Read again: the view's task may hold the assignees as they were before the change.
    return [row.member for row in TaskAssignee.objects.filter(task=task).select_related("member")]


def linked_to(task):
    """The people linked to a task: assigned to it, its author, the project manager."""
    return assignees(task) + [task.created_by, task.project.project_manager]


def task_assigned(task, members, actor):
    primary = TaskAssignee.objects.filter(task=task, is_primary=True).values_list("member_id", flat=True).first()
    notify(Kind.TASK_ASSIGNED, members, target=("task", task.pk), actor=actor, data={**task_data(task), "primary_id": primary})


def excerpt(text):
    """The text on one line, cut at EXCERPT_LENGTH characters."""
    text = " ".join(text.split())
    return text if len(text) <= EXCERPT_LENGTH else text[: EXCERPT_LENGTH - 1].rstrip() + "…"


def task_commented(task, comment, actor):
    notify(
        Kind.TASK_COMMENTED, assignees(task) + [task.created_by], target=("task", task.pk), actor=actor,
        data={**task_data(task), "excerpt": excerpt(comment.content)},
    )


def task_validators(task):
    """Who validates a task and decides its blockers: the leaders of its unit (its subsystem's, else its
    project's; else of the nearest unit above) and the project manager, never one assigned to it; the
    club admins when there is nobody else."""
    unit = task.subsystem.org_unit if task.subsystem_id is not None else task.project.org_unit
    assigned = {member.pk for member in assignees(task)}
    people = [*unit_leaders(unit), task.project.project_manager]
    people = [member for member in people if member is not None and member.pk not in assigned]
    return people or club_admins()


def task_submitted(task, actor):
    notify(Kind.TASK_SUBMITTED, task_validators(task), target=("task", task.pk), actor=actor, data=task_data(task))


def task_validated(task, actor):
    notify(
        Kind.TASK_VALIDATED, assignees(task), target=("task", task.pk), actor=actor,
        data={**task_data(task), "quality_mark": task.quality_mark},
    )


def task_revision(task, actor, comment):
    notify(
        Kind.TASK_REVISION, assignees(task), target=("task", task.pk), actor=actor,
        data={**task_data(task), "excerpt": excerpt(comment)},
    )


def blocker_data(blocker):
    return {**task_data(blocker.task), "severity": blocker.severity, "excerpt": excerpt(blocker.description)}


def blocker_declared(blocker, actor):
    notify(
        Kind.BLOCKER_DECLARED, task_validators(blocker.task), target=("task", blocker.task_id), actor=actor,
        data=blocker_data(blocker),
    )


def blocker_updated(blocker, actor):
    """Validated, rejected or resolved (`status`): the people assigned to the task and who declared it."""
    notify(
        Kind.BLOCKER_UPDATED, [*assignees(blocker.task), blocker.reported_by], target=("task", blocker.task_id),
        actor=actor, data={**blocker_data(blocker), "status": blocker.status},
    )


# --- Sessions and attendance (knowledge base: PROJECTS/ERP/meetings_design.md) ---


def meeting_data(meeting):
    return {
        "meeting": meeting.title,
        "starts_at": meeting.starts_at.isoformat(),
        "location": meeting.location,
        "mandatory": meeting.is_mandatory,
    }


def invitees_of(meeting):
    return [row.member for row in meeting.attendances.select_related("member")]


def meeting_scheduled(meeting, members, actor, email=None):
    """The people invited to a new session (or newly invited); by e-mail when it is mandatory (or `email`)."""
    notify(
        Kind.MEETING_SCHEDULED, members, target=("meeting", meeting.pk), actor=actor, data=meeting_data(meeting),
        email=meeting.is_mandatory if email is None else email,
    )


def meeting_updated(meeting, actor, *, cancelled=False):
    data = {**meeting_data(meeting), "cancelled": cancelled}
    if cancelled and meeting.cancel_reason:
        data["reason"] = excerpt(meeting.cancel_reason)
    notify(Kind.MEETING_UPDATED, invitees_of(meeting), target=("meeting", meeting.pk), actor=actor, data=data)


def excuse_deciders(member):
    """Who decides an excuse: the Team Managers, never for their own; the other club admins when nobody else can."""
    from apps.meetings.access import team_managers  # the meetings app builds on this one

    managers = Member.objects.filter(team_managers("memberships__"), is_active=True).exclude(pk=member.pk)
    return list(managers.distinct()) or [admin for admin in club_admins() if admin.pk != member.pk]


def excuse_requested(attendance, actor):
    member = attendance.member
    notify(
        Kind.EXCUSE_REQUESTED, excuse_deciders(member), target=("meeting", attendance.meeting_id), actor=actor,
        data={**meeting_data(attendance.meeting), "reason": attendance.excuse_reason,
              "member": f"{member.first_name} {member.last_name}"},
    )


def excuse_decided(attendance, actor):
    notify(
        Kind.EXCUSE_DECIDED, [attendance.member], target=("meeting", attendance.meeting_id), actor=actor,
        data={**meeting_data(attendance.meeting), "accepted": attendance.excuse_status == "accepted"},
    )


def action_assigned(action, actor):
    notify(
        Kind.ACTION_ASSIGNED, [action.responsible], target=("meeting", action.meeting_id), actor=actor,
        data={
            **meeting_data(action.meeting), "excerpt": excerpt(action.description),
            "due_date": action.due_date.isoformat() if action.due_date else None,
        },
    )


def minutes_published(meeting, actor):
    notify(
        Kind.MINUTES_PUBLISHED, invitees_of(meeting), target=("meeting", meeting.pk), actor=actor,
        data=meeting_data(meeting),
    )


def meeting_reminders(now=None):
    """The invitees of each mandatory session starting before the end of tomorrow are reminded once.
    Returns how many notifications were created."""
    from apps.meetings.models import Meeting, MeetingStatus

    now = now or timezone.now()
    tomorrow = timezone.localdate(now) + timedelta(days=1)
    meetings = Meeting.objects.filter(
        is_mandatory=True, status=MeetingStatus.PLANNED, starts_at__gt=now, starts_at__date__lte=tomorrow
    )
    created = 0
    for meeting in meetings:
        already = set(
            Notification.objects.filter(
                kind=Kind.MEETING_REMINDER, related_entity_type="meeting", related_entity_id=meeting.pk
            ).values_list("member_id", flat=True)
        )
        people = [member for member in invitees_of(meeting) if member.pk not in already]
        created += len(notify(Kind.MEETING_REMINDER, people, target=("meeting", meeting.pk), data=meeting_data(meeting)))
    return created


# --- Lifecycle of the subsystems ---


# --- Workshop (knowledge base: PROJECTS/ERP/workshop_design.md) ---


def loan_data(loan):
    borrower = loan.borrower
    return {
        "loan": loan.pk, "equipment": loan.equipment.name, "due_date": loan.due_date.isoformat(),
        "borrower": f"{borrower.first_name} {borrower.last_name}",
    }


def loan_requested(loan, actor):
    from apps.equipment.access import managers  # the equipment app builds on this one

    notify(
        Kind.LOAN_REQUESTED, managers() or club_admins(), target=("equipment", loan.equipment_id), actor=actor,
        data={**loan_data(loan), "excerpt": excerpt(loan.reason)},
    )


def loan_decided(loan, actor):
    data = {**loan_data(loan), "approved": loan.status == "out"}
    if loan.decision_note:
        data["excerpt"] = excerpt(loan.decision_note)
    notify(Kind.LOAN_DECIDED, [loan.borrower], target=("equipment", loan.equipment_id), actor=actor, data=data)


def loan_reminders():
    """The borrowers of the loans past their return date, once per loan. Returns how many were told."""
    from apps.equipment.models import EquipmentLoan, LoanStatus

    created = 0
    overdue = EquipmentLoan.objects.filter(status=LoanStatus.OUT, due_date__lt=timezone.localdate())
    for loan in overdue.select_related("equipment", "borrower"):
        if Notification.objects.filter(kind=Kind.LOAN_OVERDUE, data__loan=loan.pk).exists():
            continue
        created += len(notify(
            Kind.LOAN_OVERDUE, [loan.borrower], target=("equipment", loan.equipment_id), data=loan_data(loan)
        ))
    return created


def reservation_cancelled(reservation, actor, reason="", unavailable=False):
    data = {
        "equipment": reservation.equipment.name, "reserved_from": reservation.reserved_from.isoformat(),
        "reserved_to": reservation.reserved_to.isoformat(),
    }
    if unavailable:
        data["unavailable"] = True
    elif reason:
        data["excerpt"] = excerpt(reason)
    notify(
        Kind.RESERVATION_CANCELLED, [reservation.reserved_by], target=("equipment", reservation.equipment_id),
        actor=actor, data=data,
    )


def certification_granted(certification, actor):
    notify(
        Kind.CERTIFICATION_GRANTED, [certification.member], target=("equipment", certification.equipment_id),
        actor=actor, data={"equipment": certification.equipment.name},
    )


# --- Monthly ranking (knowledge base: PROJECTS/ERP/ranking_design.md) ---


def contribution_data(point):
    member = point.member
    return {
        "points": point.points, "member": f"{member.first_name} {member.last_name}",
        "excerpt": excerpt(point.description), "date": point.occurred_on.isoformat(),
    }


def team_managers_or_admins():
    from apps.meetings.access import team_managers  # the meetings app builds on this one

    return list(Member.objects.filter(team_managers("memberships__"), is_active=True).distinct()) or club_admins()


def contribution_proposed(point, actor):
    """The leaders of the member's units (never the member), else the Team Manager, else the admins."""
    member = point.member
    people = {}
    for membership in member.memberships.filter(end_date__isnull=True).select_related("org_unit"):
        for leader in unit_leaders(membership.org_unit):
            if leader.pk != member.pk:
                people[leader.pk] = leader
    recipients = list(people.values()) or team_managers_or_admins()
    notify(
        Kind.CONTRIBUTION_PROPOSED, recipients, target=("contribution", point.pk), actor=actor,
        data=contribution_data(point),
    )


def contribution_decided(point, actor):
    data = {**contribution_data(point), "approved": point.status == "validated"}
    if point.decision_note:
        data["note"] = excerpt(point.decision_note)
    notify(Kind.CONTRIBUTION_DECIDED, [point.member, point.proposed_by], target=("contribution", point.pk),
           actor=actor, data=data)


def ranking_published(publication, members, actor):
    notify(Kind.RANKING_PUBLISHED, members, target=("ranking", publication.pk), actor=actor,
           data={"month": publication.month.strftime("%Y-%m")})


def ranking_reminders(today=None):
    """In the first week of a month, the Team Manager once, while the month before is not published."""
    from apps.ranking.models import RankingPublication

    today = today or timezone.localdate()
    if today.day > 7:
        return 0
    month = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    key = month.strftime("%Y-%m")
    if RankingPublication.objects.filter(month=month).exists():
        return 0
    if Notification.objects.filter(kind=Kind.RANKING_TO_PUBLISH, data__month=key).exists():
        return 0
    return len(notify(Kind.RANKING_TO_PUBLISH, team_managers_or_admins(), target=("ranking", None),
                      data={"month": key}))


# --- Warnings and exclusions (knowledge base: PROJECTS/ERP/discipline_design.md) ---


def discipline_data(record, ground):
    member = record.member
    return {"member": f"{member.first_name} {member.last_name}", "ground": ground}


def breach_reported(report, actor):
    """The authority over the member: the managers of their open projects, else the Team Manager, else the admins."""
    managers = {
        link.project.project_manager.pk: link.project.project_manager
        for link in report.member.project_memberships.filter(is_active=True, project__status__in=("planned", "active"))
        .select_related("project__project_manager")
        if link.project.project_manager is not None
    }
    # Never the reported member, who manages one of their own projects or is the Team Manager: a member never
    # sees the reports about them (discipline_design.md).
    managers.pop(report.member_id, None)
    fallback = [m for m in team_managers_or_admins() if m.pk != report.member_id]
    notify(Kind.WARNING_REPORTED, list(managers.values()) or fallback,
           target=("discipline_report", report.pk), actor=actor, data=discipline_data(report, report.ground))


def warning_issued(warning, actor):
    data = {**discipline_data(warning, warning.ground), "number": warning.level}
    target = ("warning", warning.pk)
    notify(Kind.WARNING_ISSUED, [warning.member], target=target, actor=actor, data=data)
    heads = {}
    for membership in warning.member.memberships.filter(end_date__isnull=True).select_related("org_unit"):
        for leader in unit_leaders(membership.org_unit):
            if leader.pk != warning.member_id:
                heads[leader.pk] = leader
    notify(Kind.WARNING_ISSUED, list(heads.values()), target=target, actor=actor, data=data, email=False)


def exclusion_pending(exclusion, actor):
    notify(Kind.EXCLUSION_PENDING, bureau_members() or club_admins(), target=("exclusion", exclusion.pk),
           actor=actor, data={**discipline_data(exclusion, exclusion.serious_ground), "cause": exclusion.cause})


# --- Goals, trainings, volunteering (knowledge base: PROJECTS/ERP/engagement_design.md) ---


def objective_set(goal, actor):
    notify(Kind.OBJECTIVE_SET, [goal.member], target=("objective", goal.pk), actor=actor,
           data={"objective": goal.title, "due_date": goal.due_date.isoformat() if goal.due_date else None})


def training_planned(training, actor):
    data = {"training": training.topic}
    if training.session is not None:
        data["starts_at"] = training.session.starts_at.isoformat()
    notify(Kind.TRAINING_PLANNED, [training.member], target=("training", training.pk), actor=actor, data=data)


def volunteering_data(activity):
    return {"volunteering": activity.title, "date": activity.date.isoformat()}


def volunteering_to_validate(activity, actor):
    """The leaders of the organiser's units (never the organiser), else the Team Manager, else the admins."""
    organiser = activity.organiser
    heads = {}
    for membership in organiser.memberships.filter(end_date__isnull=True).select_related("org_unit"):
        for leader in unit_leaders(membership.org_unit):
            if leader.pk != organiser.pk:
                heads[leader.pk] = leader
    notify(Kind.VOLUNTEERING_TO_VALIDATE, list(heads.values()) or team_managers_or_admins(),
           target=("volunteering", activity.pk), actor=actor, data=volunteering_data(activity))


def volunteering_decided(activity, actor):
    data = {**volunteering_data(activity), "approved": activity.status == "validated"}
    if activity.decision_note:
        data["note"] = excerpt(activity.decision_note)
    people = [activity.organiser, *activity.participants.all()]
    notify(Kind.VOLUNTEERING_DECIDED, people, target=("volunteering", activity.pk), actor=actor, data=data)


def volunteering_reminders(today=None):
    """From the 20th of a month, each member without a validated volunteering in it, once (charter art. 21)."""
    from apps.engagement import workflow

    today = today or timezone.localdate()
    if today.day < 20:
        return 0
    key = today.strftime("%Y-%m")
    members = list(workflow.team_members())
    done = workflow.covered([member.pk for member in members], today)
    told = set(Notification.objects.filter(kind=Kind.VOLUNTEERING_REMINDER, data__month=key).values_list(
        "member_id", flat=True
    ))
    missing = [member for member in members if member.pk not in done and member.pk not in told]
    return len(notify(Kind.VOLUNTEERING_REMINDER, missing, target=("volunteering", None), data={"month": key}))


def unit_leaders(unit):
    """The active leaders of `unit`, else of the nearest unit above it that has some."""
    while unit is not None:
        leaders = list(
            Member.objects.filter(
                is_active=True,
                memberships__org_unit=unit,
                memberships__end_date__isnull=True,
                memberships__role__is_leadership=True,
            ).distinct()
        )
        if leaders:
            return leaders
        unit = unit.parent
    return []


def step_ticked(subsystem, step, steps, progress, actor):
    """`step` was just ticked as done. `steps`: the steps of the subsystem's project, in order;
    `progress`: its progress rows by step id, this change included."""
    project = subsystem.project
    data = {"subsystem": subsystem.name, "project": project.name, "project_id": project.pk, "step": step.name}
    target = ("subsystem", subsystem.pk)

    def done(item):
        row = progress.get(item.pk)
        return bool(row and row.is_complete)

    if step.requires_validation:
        members = [row.member for row in subsystem.member_assignments.filter(end_date__isnull=True).select_related("member")]
        notify(Kind.VALIDATION_SIGNED, members + [project.project_manager], target=target, actor=actor, data=data)
        return
    validation = next((item for item in steps if item.step_order > step.step_order and item.requires_validation), None)
    if validation is None or done(validation):
        return
    if all(done(item) for item in steps if item.step_order < validation.step_order):
        notify(
            Kind.VALIDATION_REQUESTED, unit_leaders(subsystem.org_unit), target=target, actor=actor,
            data={**data, "step": validation.name},
        )


# --- Deadlines (manage.py send_deadline_reminders, once a day) ---


def deadline_reminders(today=None):
    """Tells the people linked to each unfinished task, once per due date: from 3 days before it,
    then once it is past. Returns how many notifications were created."""
    today = today or timezone.localdate()
    # Not submitted nor validated, and no validated blocker freezing the due date.
    frozen = Task.objects.filter(blockers__status=BlockerStatus.VALIDATED).values("pk")
    tasks = (
        Task.objects.filter(status__in=OPEN_STATUSES)
        .exclude(pk__in=frozen)
        .filter(due_date__isnull=False, due_date__lte=today + timedelta(days=REMIND_DAYS_BEFORE))
        .select_related("project__project_manager", "created_by")
        .order_by("due_date", "pk")
    )
    created = 0
    for task in tasks:
        kind = Kind.TASK_OVERDUE if task.due_date < today else Kind.TASK_DUE_SOON
        due = task.due_date.isoformat()
        already = set(
            Notification.objects.filter(
                kind=kind, related_entity_type="task", related_entity_id=task.pk, data__due_date=due
            ).values_list("member_id", flat=True)
        )
        people = [member for member in linked_to(task) if member is not None and member.pk not in already]
        created += len(notify(kind, people, target=("task", task.pk), data={**task_data(task), "due_date": due}))
    return created


# --- Purchases (knowledge base: PROJECTS/ERP/purchasing_design.md) ---


def purchase_data(purchase):
    requester = purchase.requested_by
    return {
        "part": purchase.part.name,
        "quantity": purchase.quantity,
        "requester": f"{requester.first_name} {requester.last_name}",
    }


def operations_members(*, heads_only=False):
    """Operations' staff: the head of Operations & Partnerships and its logistics coordinators, not its
    junior members (heads_only: the head)."""
    staff = operations_staff("memberships__")
    if heads_only:
        staff &= Q(memberships__role__is_leadership=True)
    return list(Member.objects.filter(staff, is_active=True).distinct())


def bureau_members():
    """The active members of the Executive Bureau, with the Team Manager (in it by role)."""
    from apps.meetings.access import BUREAU_UNIT, team_managers  # the meetings app builds on this one

    in_bureau = Q(memberships__end_date__isnull=True, memberships__org_unit__code=BUREAU_UNIT)
    return list(Member.objects.filter(in_bureau | team_managers("memberships__"), is_active=True).distinct())


def club_admins():
    """The superusers, the Admins group, the Board of Directors and the Team Manager (decision D-025)."""
    return list(Member.objects.filter(is_active=True).filter(club_admins_filter()).distinct())


def purchase_approvers(purchase):
    """Who approves the step the request awaits; the club admins when nobody else can."""
    if purchase.status == PurchaseStatus.A_VALIDER_CHEF:
        people = unit_leaders(purchase.org_unit) if purchase.org_unit is not None else []
        if purchase.subsystem is not None and purchase.subsystem.project.project_manager is not None:
            people.append(purchase.subsystem.project.project_manager)
    else:
        people = operations_members(heads_only=True)
    return people or club_admins()


def purchase_moved(purchase, action, actor, *, reason="", supplier="", received=None, tell_operations=False):
    """After a step of a purchase request: whoever acts next is asked to (approve, order), and the
    requester is told what happened — and Operations, when a request they had to order is cancelled.
    `received`: how many parts have arrived so far (a partial delivery, an order closed with them)."""
    target = ("purchase_request", purchase.pk)
    data = purchase_data(purchase)
    if purchase.status in (PurchaseStatus.A_VALIDER_CHEF, PurchaseStatus.A_VALIDER_OPERATIONS):
        level = "leader" if purchase.status == PurchaseStatus.A_VALIDER_CHEF else "operations"
        notify(
            Kind.PURCHASE_APPROVAL_REQUESTED, purchase_approvers(purchase), target=target, actor=actor,
            data={**data, "level": level},
        )
    elif purchase.status == PurchaseStatus.A_COMMANDER:
        notify(Kind.PURCHASE_TO_ORDER, operations_members(), target=target, actor=actor, data=data)
    if action == PurchaseAction.REQUESTED:
        return
    details = {**data, "action": action, "status": purchase.status}
    if reason:
        details["reason"] = excerpt(reason)
    if supplier:
        details["supplier"] = supplier
    if received is not None and action in (PurchaseAction.PARTLY_RECEIVED, PurchaseAction.CLOSED_SHORT):
        details["received"] = received
    people = [purchase.requested_by, *(operations_members() if tell_operations else [])]
    notify(Kind.PURCHASE_UPDATED, people, target=target, actor=actor, data=details)


# --- Stock (knowledge base: PROJECTS/ERP/stock_design.md) ---


def stock_low(item, actor):
    """A stock line just reached its threshold or went below: the stock managers are told, once."""
    from apps.inventory.access import stock_managers  # the inventory app builds on this one

    people = list(Member.objects.filter(stock_managers("memberships__"), is_active=True).distinct())
    notify(
        Kind.STOCK_LOW, people or club_admins(), target=("stock_item", item.pk), actor=actor,
        data={
            "part": item.part.name, "location": item.location, "quantity": item.quantity_available,
            "threshold": item.min_threshold,
        },
    )


# --- Finance (knowledge base: PROJECTS/ERP/finance_design.md §10) ---


def budget_exceeded(budget, spent, actor):
    """The expenses of a budget just went above its allocation: the leaders of its unit, the treasurers
    and the club admins are told."""
    from apps.finance.access import treasurers  # the finance app builds on this one

    people = [
        *unit_leaders(budget.org_unit),
        *Member.objects.filter(treasurers("memberships__"), is_active=True).distinct(),
        *club_admins(),
    ]
    notify(
        Kind.BUDGET_EXCEEDED, people, target=("budget", budget.pk), actor=actor,
        data={
            "unit": budget.org_unit.name, "fiscal_year": budget.fiscal_year,
            "allocated": str(budget.allocated_amount), "spent": str(spent),
        },
    )
