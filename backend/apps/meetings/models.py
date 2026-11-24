"""
Sessions of the team (meetings, workshops, trainings, events) and who attended them, with their minutes,
decisions and actions (decision D-013, knowledge base: PROJECTS/ERP/meetings_design.md).

The presence score of the ranking (Ranking System §4) is computed from the mandatory, confirmed and not
cancelled sessions: scores.py.
"""

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils.translation import gettext_lazy as _, pgettext_lazy


class MeetingKind(models.TextChoices):
    DEPARTMENT = "department", _("Department meeting")
    GENERAL = "general", _("General meeting")
    WORKSHOP = "workshop", pgettext_lazy("session kind", "Workshop")
    TRAINING = "training", _("Training session")
    EVENT = "event", pgettext_lazy("session kind", "Event")
    # Created by a second warning (charter art. 27.5, apps/discipline): its invitees come from the warning.
    COUNCIL = "council", _("Council (art. 27.5)")


class MeetingStatus(models.TextChoices):
    PLANNED = "planned", pgettext_lazy("session status", "Planned")
    CANCELLED = "cancelled", pgettext_lazy("session status", "Cancelled")


class Meeting(models.Model):
    """A session: who is invited (a unit and the units below it, or the whole team), when, where, and
    whether it counts in the presence score (mandatory; critical sessions count twice)."""

    title = models.CharField(_("title"), max_length=200)
    kind = models.CharField(_("kind"), max_length=20, choices=MeetingKind.choices, default=MeetingKind.DEPARTMENT)
    org_unit = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, null=True, blank=True, related_name="meetings",
        verbose_name=_("invited unit"), help_text=_("Empty: the whole team."),
    )
    starts_at = models.DateTimeField(_("starts at"))
    ends_at = models.DateTimeField(_("ends at"))
    location = models.CharField(_("location"), max_length=200, blank=True)
    agenda = models.TextField(_("agenda"), blank=True)
    is_mandatory = models.BooleanField(
        _("mandatory"), default=False, help_text=_("Counts in the presence score; set before it starts, never after."),
    )
    is_critical = models.BooleanField(
        _("critical"), default=False, help_text=_("Test day, competition preparation, event: counts twice."),
    )
    status = models.CharField(
        _("status"), max_length=20, choices=MeetingStatus.choices, default=MeetingStatus.PLANNED
    )
    cancel_reason = models.TextField(_("reason for cancelling"), blank=True)
    organiser = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="organised_meetings",
        verbose_name=_("organiser"),
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("created by"),
    )
    attendance_confirmed_at = models.DateTimeField(_("attendance confirmed at"), null=True, blank=True)
    attendance_confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("attendance confirmed by"),
    )
    minutes = models.TextField(_("minutes"), blank=True)
    minutes_published_at = models.DateTimeField(_("minutes published at"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        ordering = ["starts_at", "id"]
        verbose_name = _("session")
        verbose_name_plural = _("sessions")
        constraints = [
            models.CheckConstraint(condition=Q(ends_at__gt=F("starts_at")), name="ck_meeting_ends_after_start"),
        ]
        indexes = [models.Index(fields=["starts_at"], name="idx_meeting_starts_at")]

    def __str__(self):
        return self.title

    @property
    def weight(self):
        """Its weight in the presence score: 2 for a critical session, else 1."""
        return 2 if self.is_critical else 1


class AttendanceStatus(models.TextChoices):
    PENDING = "pending", pgettext_lazy("attendance", "Not marked yet")
    PRESENT = "present", pgettext_lazy("attendance", "Present")
    LATE = "late", pgettext_lazy("attendance", "Late")
    ABSENT = "absent", pgettext_lazy("attendance", "Absent")


class ExcuseReason(models.TextChoices):
    EXAM = "exam", _("Exam")
    ILLNESS = "illness", _("Illness")
    FAMILY = "family", _("Family emergency")
    MISSION = "mission", _("Official team mission")


class ExcuseStatus(models.TextChoices):
    NONE = "none", pgettext_lazy("excuse", "None")
    REQUESTED = "requested", pgettext_lazy("excuse", "Requested")
    ACCEPTED = "accepted", pgettext_lazy("excuse", "Accepted")
    REFUSED = "refused", pgettext_lazy("excuse", "Refused")


class Attendance(models.Model):
    """One invited person at one session: their check-in, the organiser's mark, and their excuse."""

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="attendances", verbose_name=_("session"))
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="attendances", verbose_name=_("member")
    )
    status = models.CharField(
        _("status"), max_length=20, choices=AttendanceStatus.choices, default=AttendanceStatus.PENDING
    )
    checked_in_at = models.DateTimeField(_("checked in at"), null=True, blank=True)
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("marked by"),
    )
    marked_at = models.DateTimeField(_("marked at"), null=True, blank=True)
    excuse_status = models.CharField(
        _("excuse"), max_length=20, choices=ExcuseStatus.choices, default=ExcuseStatus.NONE
    )
    excuse_reason = models.CharField(_("reason"), max_length=20, choices=ExcuseReason.choices, blank=True)
    excuse_note = models.TextField(_("note"), blank=True)
    excuse_requested_at = models.DateTimeField(_("excuse requested at"), null=True, blank=True)
    excuse_decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("excuse decided by"),
    )
    excuse_decided_at = models.DateTimeField(_("excuse decided at"), null=True, blank=True)
    excuse_decision_note = models.TextField(_("decision note"), blank=True)

    class Meta:
        ordering = ["meeting__starts_at", "member__first_name", "member__last_name", "id"]
        verbose_name = _("attendance")
        verbose_name_plural = _("attendances")
        constraints = [
            models.UniqueConstraint(fields=["meeting", "member"], name="uq_attendance_meeting_member"),
        ]

    def __str__(self):
        return f"{self.member} — {self.meeting}"


class MeetingDecision(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="decisions", verbose_name=_("session"))
    text = models.TextField(_("decision"))
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("created by"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = _("decision")
        verbose_name_plural = _("decisions")

    def __str__(self):
        return self.text[:80]


class MeetingAction(models.Model):
    """Something to do after a session, by someone, by a date; it may become a task of a project."""

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="actions", verbose_name=_("session"))
    description = models.TextField(_("description"))
    responsible = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="meeting_actions",
        verbose_name=_("responsible"),
    )
    due_date = models.DateField(_("due date"), null=True, blank=True)
    is_done = models.BooleanField(_("done"), default=False)
    done_at = models.DateTimeField(_("done at"), null=True, blank=True)
    task = models.ForeignKey(
        "tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="meeting_actions",
        verbose_name=_("task"),
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("created by"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = _("meeting action")
        verbose_name_plural = _("meeting actions")

    def __str__(self):
        return self.description[:80]
