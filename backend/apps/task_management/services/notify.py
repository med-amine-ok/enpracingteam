"""Who is told about what in the work module (plan §5.1). One notification kind, `work_event`, whose
`data.event` names the event; the screens write the sentence. Never anything about points or scoring
(guide §2.1): only titles, codes and decisions."""

from apps.communication.models import NotificationKind
from apps.communication.notify import notify, unit_leaders
from apps.members.models import Member




def heads_of(department):
    """The leaders of the department, else of the nearest unit above it (as for the tasks)."""
    return unit_leaders(department)


def assignees(deliverable):
    return list(Member.objects.filter(work_assignments__deliverable=deliverable, work_assignments__is_active=True))


def work_order_members(work_order):
    return list(
        Member.objects.filter(
            work_assignments__deliverable__work_order=work_order, work_assignments__is_active=True
        ).distinct()
    )


def send(event, recipients, *, actor, target, **data):
    notify(NotificationKind.WORK_EVENT, recipients, target=target, actor=actor, data={"event": event, **data}, email=False)


def about_work_order(work_order):
    return {"title": work_order.title, "code": work_order.code or "", "work_order_id": work_order.pk}


def about_deliverable(deliverable):
    return {
        "title": deliverable.title, "code": deliverable.code or "", "deliverable_id": deliverable.pk,
        "work_order_id": deliverable.work_order_id,
    }


def work_order_event(event, work_order, recipients, actor, **data):
    send(event, recipients, actor=actor, target=("work_order", work_order.pk), **about_work_order(work_order), **data)


def deliverable_event(event, deliverable, recipients, actor, **data):
    send(event, recipients, actor=actor, target=("deliverable", deliverable.pk), **about_deliverable(deliverable), **data)


def blocker_event(event, blocker, recipients, actor):
    target = blocker.deliverable or blocker.work_order
    data = {"title": target.title, "code": target.code or "", "blocker_id": blocker.pk,
            "severity": blocker.severity}
    send(event, recipients, actor=actor, target=("blocker", blocker.pk), **data)


