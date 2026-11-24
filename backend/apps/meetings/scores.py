"""
The presence score of the ranking (Ranking System §4): only the mandatory sessions, not cancelled, whose
attendance the organiser confirmed. Present on time = 1, late (or left before halfway) = 0.5, absent = 0;
an accepted excuse is removed from the calculation. A critical session weighs 2.

    Presence score = Σ (session weight × status value) ÷ Σ session weights × 100

None when the member had no counted session in the period: "not calculable", never 0.
"""

from .models import Attendance, AttendanceStatus, ExcuseStatus, MeetingStatus

STATUS_VALUES = {AttendanceStatus.PRESENT: 1.0, AttendanceStatus.LATE: 0.5, AttendanceStatus.ABSENT: 0.0}


def counted_attendances(member, start, end):
    """The attendances of `member` that count, for the sessions starting in [start, end)."""
    return (
        Attendance.objects.filter(
            member=member,
            meeting__is_mandatory=True,
            meeting__status=MeetingStatus.PLANNED,
            meeting__attendance_confirmed_at__isnull=False,
            meeting__starts_at__gte=start,
            meeting__starts_at__lt=end,
            status__in=list(STATUS_VALUES),
        )
        .exclude(excuse_status=ExcuseStatus.ACCEPTED)
        .select_related("meeting")
    )


def presence_score(member, start, end):
    total = earned = 0.0
    for attendance in counted_attendances(member, start, end):
        weight = attendance.meeting.weight
        total += weight
        earned += weight * STATUS_VALUES[attendance.status]
    if not total:
        return None
    return round(earned / total * 100, 1)
