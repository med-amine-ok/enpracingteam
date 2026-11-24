"""
The members' goals, trainings and volunteering (decision D-019, knowledge base: PROJECTS/ERP/engagement_design.md):
goals set by the department head for the season; trainings the member wants, then planned and followed; the
monthly volunteering day of the charter (art. 21), recorded by its organiser with its participants and validated
by a head. Who may do what: access.py; the rules of each change: workflow.py; the full member sheet: sheet.py.
"""

from django.core.validators import MaxValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy


class ObjectiveStatus(models.TextChoices):
    # Context: French masculine (l'objectif), Arabic هدف masculine.
    IN_PROGRESS = "in_progress", pgettext_lazy("objective status", "In progress")
    ACHIEVED = "achieved", pgettext_lazy("objective status", "Achieved")
    NOT_ACHIEVED = "not_achieved", pgettext_lazy("objective status", "Not achieved")
    DROPPED = "dropped", pgettext_lazy("objective status", "Dropped")


class Objective(models.Model):
    """A goal of a member for the season (from September 1st), set by their department head."""

    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="objectives", verbose_name=_("member")
    )
    season = models.PositiveSmallIntegerField(_("season"), help_text=_("The year it starts: 2026 for 2026/2027."))
    title = models.CharField(_("title"), max_length=255)
    description = models.TextField(_("description"), blank=True)
    measure = models.TextField(_("how it is measured"), blank=True)
    due_date = models.DateField(_("due date"), null=True, blank=True)
    progress = models.PositiveSmallIntegerField(_("progress (%)"), default=0, validators=[MaxValueValidator(100)])
    member_note = models.TextField(_("member's note"), blank=True)
    status = models.CharField(
        _("status"), max_length=20, choices=ObjectiveStatus.choices, default=ObjectiveStatus.IN_PROGRESS
    )
    set_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name=_("set by")
    )
    assessment_note = models.TextField(_("head's note"), blank=True)
    assessed_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("assessed by"),
    )
    assessed_at = models.DateTimeField(_("assessed at"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("goal")
        verbose_name_plural = _("goals")
        ordering = ["status", "due_date", "-created_at"]

    def __str__(self):
        return f"{self.member} — {self.title}"


class TrainingStatus(models.TextChoices):
    # Context: French feminine (la formation), Arabic تكوين masculine.
    WISHED = "wished", pgettext_lazy("training status", "Wished")
    PLANNED = "planned", pgettext_lazy("training status", "Planned")
    FOLLOWED = "followed", pgettext_lazy("training status", "Followed")
    DROPPED = "dropped", pgettext_lazy("training status", "Dropped")


class Training(models.Model):
    """A training a member wants (or followed): planned by a head, possibly through a "Training" session."""

    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="trainings", verbose_name=_("member")
    )
    topic = models.CharField(_("topic"), max_length=255)
    reason = models.TextField(_("why"), blank=True)
    status = models.CharField(_("status"), max_length=20, choices=TrainingStatus.choices, default=TrainingStatus.WISHED)
    session = models.ForeignKey(
        "meetings.Meeting", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("training session"),
    )
    followed_on = models.DateField(_("followed on"), null=True, blank=True)
    note = models.TextField(_("head's note"), blank=True)
    updated_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("updated by"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("training")
        verbose_name_plural = _("trainings")
        ordering = ["topic", "-created_at"]

    def __str__(self):
        return f"{self.member} — {self.topic}"


class VolunteeringKind(models.TextChoices):
    """What a volunteering day may be given to (charter art. 21)."""

    WORKSHOP = "workshop", _("Cleaning and tidying the workshop")
    EQUIPMENT = "equipment", _("Maintaining the equipment")
    TEAM_WORKS = "team_works", _("Work needed by the team")
    EVENT = "event", _("Organising or preparing an event")
    OTHER_DEPARTMENT = "other_department", _("Helping another department")
    LOGISTICS = "logistics", _("Logistics of an activity")
    DOCUMENTATION = "documentation", _("Documenting or tidying the team's resources")
    OTHER = "other", _("Another collective mission")


class VolunteeringStatus(models.TextChoices):
    # Context: French feminine (l'activité), Arabic نشاط masculine.
    PROPOSED = "proposed", pgettext_lazy("volunteering status", "To validate")
    VALIDATED = "validated", pgettext_lazy("volunteering status", "Validated")
    REFUSED = "refused", pgettext_lazy("volunteering status", "Refused")


class VolunteeringActivity(models.Model):
    """A volunteering task on a date, with its participants (charter art. 21): created by its organiser, validated by
    a head; once validated, it covers the month of each participant."""

    title = models.CharField(_("task"), max_length=255)
    kind = models.CharField(_("kind"), max_length=20, choices=VolunteeringKind.choices)
    description = models.TextField(_("description"), blank=True)
    date = models.DateField(_("date"))
    organiser = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="organised_volunteering",
        verbose_name=_("organiser"),
    )
    participants = models.ManyToManyField(
        "members.Member", related_name="volunteering", verbose_name=_("participants")
    )
    status = models.CharField(
        _("status"), max_length=20, choices=VolunteeringStatus.choices, default=VolunteeringStatus.PROPOSED
    )
    decided_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("decided by"),
    )
    decided_at = models.DateTimeField(_("decided at"), null=True, blank=True)
    decision_note = models.TextField(_("decision note"), blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("volunteering activity")
        verbose_name_plural = _("volunteering activities")
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.title} ({self.date})"
