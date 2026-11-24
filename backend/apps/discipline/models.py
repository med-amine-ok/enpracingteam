"""
Warnings and exclusions (decision D-018, knowledge base: PROJECTS/ERP/discipline_design.md, charter art. 27-28):
a department head reports a breach; the project manager (for the members of their project) or the Executive
Bureau gives a warning; the second calls a council, the third an exclusion that the Bureau confirms. Counted per
season (from September 1st). Who may do what: access.py; the rules of each change: workflow.py.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy

SEASON_START_MONTH = 9  # the season starts on September 1st


def season_of(day):
    """The season of a date, by the year it starts: 2026 for 2026/2027."""
    return day.year if day.month >= SEASON_START_MONTH else day.year - 1


class Ground(models.TextChoices):
    """The grounds of a warning (charter art. 27.2)."""

    WORK_NOT_DONE = "work_not_done", _("Assigned work not done without valid reason")
    COMMITMENTS = "commitments", _("Commitments not kept")
    COMMUNICATION = "communication", _("No communication on progress")
    TEAM_RULES = "team_rules", _("Team rules not respected")
    OTHER = "other", pgettext_lazy("discipline ground", "Other")


class SeriousGround(models.TextChoices):
    """The serious behaviour of an immediate exclusion (charter art. 28)."""

    VIOLENCE = "violence", _("Violence")
    HARASSMENT = "harassment", _("Serious harassment")
    THREATS = "threats", _("Serious threats")
    SABOTAGE = "sabotage", _("Deliberate sabotage")
    THEFT = "theft", _("Theft")
    ENDANGERING = "endangering", _("Deliberately endangering someone")
    DAMAGE = "damage", _("Deliberate damage to equipment")
    DISCLOSURE = "disclosure", _("Disclosure of highly confidential information")
    IMAGE = "image", _("Serious harm to the team or its image")


class ReportStatus(models.TextChoices):
    # Context: French masculine (le signalement), Arabic إبلاغ masculine.
    OPEN = "open", pgettext_lazy("report status", "To handle")
    WARNED = "warned", pgettext_lazy("report status", "Warning given")
    DISMISSED = "dismissed", pgettext_lazy("report status", "Dismissed")


class Report(models.Model):
    """A breach reported by a department head to the authority (charter art. 27.3); the member does not see it."""

    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="discipline_reports", verbose_name=_("member")
    )
    ground = models.CharField(_("ground"), max_length=20, choices=Ground.choices)
    facts = models.TextField(_("facts"))
    reported_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name=_("reported by")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    status = models.CharField(_("status"), max_length=20, choices=ReportStatus.choices, default=ReportStatus.OPEN)
    handled_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("handled by"),
    )
    handled_at = models.DateTimeField(_("handled at"), null=True, blank=True)
    handling_note = models.TextField(_("why dismissed"), blank=True)

    class Meta:
        verbose_name = _("breach report")
        verbose_name_plural = _("breach reports")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.member} — {self.get_ground_display()}"


class WarningStatus(models.TextChoices):
    # Context: French masculine (l'avertissement), Arabic إنذار masculine.
    ACTIVE = "active", pgettext_lazy("warning status", "Active")
    CANCELLED = "cancelled", pgettext_lazy("warning status", "Cancelled")


class MemberWarning(models.Model):
    """An official warning (charter art. 27.4-27.6): its number in the season, the rule, what is expected."""

    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="warnings", verbose_name=_("member")
    )
    level = models.PositiveSmallIntegerField(_("number"), help_text=_("1, 2 or 3 in the season."))
    season = models.PositiveSmallIntegerField(_("season"), help_text=_("The year it starts: 2026 for 2026/2027."))
    ground = models.CharField(_("ground"), max_length=20, choices=Ground.choices)
    rule = models.CharField(_("rule concerned"), max_length=255, blank=True)
    facts = models.TextField(_("facts"))
    expected = models.TextField(_("what is expected to correct it"), blank=True)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("project"),
    )
    report = models.ForeignKey(
        Report, on_delete=models.SET_NULL, null=True, blank=True, related_name="warnings", verbose_name=_("report")
    )
    issued_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name=_("given by")
    )
    issued_at = models.DateTimeField(_("given at"), auto_now_add=True)
    status = models.CharField(_("status"), max_length=20, choices=WarningStatus.choices, default=WarningStatus.ACTIVE)
    member_response = models.TextField(_("member's response"), blank=True)
    responded_at = models.DateTimeField(_("responded at"), null=True, blank=True)
    council = models.ForeignKey(
        "meetings.Meeting", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("council"),
    )
    council_decision = models.TextField(_("council decision"), blank=True)
    council_decided_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("decision recorded by"),
    )
    council_decided_at = models.DateTimeField(_("decision recorded at"), null=True, blank=True)
    cancelled_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("cancelled by"),
    )
    cancelled_at = models.DateTimeField(_("cancelled at"), null=True, blank=True)
    cancel_reason = models.TextField(_("why cancelled"), blank=True)

    class Meta:
        verbose_name = _("warning")
        verbose_name_plural = _("warnings")
        ordering = ["-issued_at"]

    def __str__(self):
        return f"{self.member} — {self.level}"


class ExclusionCause(models.TextChoices):
    THIRD_WARNING = "third_warning", _("Third warning (art. 27.6)")
    IMMEDIATE = "immediate", _("Immediate exclusion (art. 28)")


class ExclusionStatus(models.TextChoices):
    # Context: French feminine (l'exclusion), Arabic فصل masculine.
    PENDING = "pending", pgettext_lazy("exclusion status", "To confirm")
    CONFIRMED = "confirmed", pgettext_lazy("exclusion status", "Confirmed")
    ABANDONED = "abandoned", pgettext_lazy("exclusion status", "Abandoned")


class Exclusion(models.Model):
    """An exclusion from the team: prepared by the third warning or proposed by the Bureau (art. 28), applied only
    once a member of the Bureau confirms it (the account is then deactivated)."""

    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="exclusions", verbose_name=_("member")
    )
    cause = models.CharField(_("cause"), max_length=20, choices=ExclusionCause.choices)
    warning = models.ForeignKey(
        MemberWarning, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("warning"),
    )
    serious_ground = models.CharField(_("serious behaviour"), max_length=20, choices=SeriousGround.choices, blank=True)
    facts = models.TextField(_("facts"), blank=True)
    proposed_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name=_("proposed by")
    )
    proposed_at = models.DateTimeField(_("proposed at"), auto_now_add=True)
    status = models.CharField(
        _("status"), max_length=20, choices=ExclusionStatus.choices, default=ExclusionStatus.PENDING
    )
    decided_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("decided by"),
    )
    decided_at = models.DateTimeField(_("decided at"), null=True, blank=True)
    decision_note = models.TextField(_("decision note"), blank=True)

    class Meta:
        verbose_name = _("exclusion")
        verbose_name_plural = _("exclusions")
        ordering = ["-proposed_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["member"], condition=models.Q(status="pending"), name="uq_exclusion_one_pending"
            ),
        ]

    def __str__(self):
        return f"{self.member} — {self.get_cause_display()}"
