"""
The monthly ranking (decision D-017, knowledge base: PROJECTS/ERP/ranking_design.md, from the team's "Ranking
System"). The scores are computed from the tasks, blockers, history and attendance (scoring.py); stored here are
only what people give: the contribution points, the department head's marks out of 5, and the published months.
"""

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy

MARK = [MinValueValidator(0), MaxValueValidator(5)]


class ContributionStatus(models.TextChoices):
    # Context: French masculine (le point de contribution), Arabic feminine (نقاط).
    PROPOSED = "proposed", pgettext_lazy("contribution status", "Proposed")
    VALIDATED = "validated", pgettext_lazy("contribution status", "Validated")
    REJECTED = "rejected", pgettext_lazy("contribution status", "Rejected")


class ContributionPoint(models.Model):
    """Help, problem solving, knowledge sharing or an initiative beyond one's own tasks (Ranking System §6)."""

    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="contribution_points", verbose_name=_("member")
    )
    points = models.PositiveSmallIntegerField(
        _("points"), validators=[MinValueValidator(1), MaxValueValidator(3)],
        help_text=_("1: small help or idea; 2: significant help or knowledge shared; 3: major help or initiative."),
    )
    description = models.TextField(_("description"))
    occurred_on = models.DateField(_("date"))
    proposed_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name=_("proposed by")
    )
    status = models.CharField(
        _("status"), max_length=20, choices=ContributionStatus.choices, default=ContributionStatus.PROPOSED
    )
    decided_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("decided by"),
    )
    decided_at = models.DateTimeField(_("decided at"), null=True, blank=True)
    decision_note = models.TextField(_("decision note"), blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("contribution point")
        verbose_name_plural = _("contribution points")
        ordering = ["-occurred_on", "-created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(points__gte=1, points__lte=3), name="ck_contribution_points"),
        ]

    def __str__(self):
        return f"{self.member} +{self.points}"


class MonthlyAssessment(models.Model):
    """The department head's marks of a member for a month. A mark left empty with a reason is "N/A" (no
    opportunity: removed from the calculation); empty without a reason, it is not given yet."""

    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="monthly_assessments", verbose_name=_("member")
    )
    month = models.DateField(_("month"), help_text=_("Its first day."))
    communication_mark = models.PositiveSmallIntegerField(
        _("communication of progress and blockers"), null=True, blank=True, validators=MARK
    )
    workshop_mark = models.PositiveSmallIntegerField(
        _("workshop contribution"), null=True, blank=True, validators=MARK
    )
    workshop_na_reason = models.CharField(_("why N/A (workshop)"), max_length=255, blank=True)
    events_mark = models.PositiveSmallIntegerField(
        _("event engagement"), null=True, blank=True, validators=MARK
    )
    events_na_reason = models.CharField(_("why N/A (events)"), max_length=255, blank=True)
    logistics_mark = models.PositiveSmallIntegerField(
        _("logistics support"), null=True, blank=True, validators=MARK
    )
    effort_mark = models.PositiveSmallIntegerField(
        _("exceptional effort"), null=True, blank=True, validators=MARK
    )
    effort_evidence = models.TextField(
        _("evidence of the effort"), blank=True, help_text=_("Dates and hours: without them, the mark is 2 at most.")
    )
    excused_weeks = models.DecimalField(
        _("excused weeks"), max_digits=3, decimal_places=1, default=0,
        validators=[MinValueValidator(0), MaxValueValidator(5)],
        help_text=_("Exams, illness, family emergency, official mission: they lower the expected load."),
    )
    no_work_available = models.BooleanField(
        _("no work available"), default=False,
        help_text=_("The member asked for more work and none was given: the expected load is what they were given."),
    )
    note = models.TextField(_("note"), blank=True)
    assessed_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name=_("assessed by")
    )
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("monthly assessment")
        verbose_name_plural = _("monthly assessments")
        ordering = ["-month"]
        constraints = [models.UniqueConstraint(fields=["member", "month"], name="uq_monthly_assessment")]

    def __str__(self):
        return f"{self.member} {self.month:%Y-%m}"


class RankingPublication(models.Model):
    """A month published by the Team Manager: the scores of that day are kept (MonthlyScore)."""

    month = models.DateField(_("month"), unique=True, help_text=_("Its first day."))
    published_by = models.ForeignKey(
        "members.Member", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name=_("published by")
    )
    published_at = models.DateTimeField(_("published at"))

    class Meta:
        verbose_name = _("published ranking")
        verbose_name_plural = _("published rankings")
        ordering = ["-month"]

    def __str__(self):
        return f"{self.month:%Y-%m}"


class Category(models.TextChoices):
    A = "A", _("A — Excellent")
    B = "B", _("B — Very good")
    C = "C", _("C — Average")
    D = "D", _("D — Weak")
    E = "E", _("E — Critical")


class MonthlyScore(models.Model):
    """A member's score in a published month: its parts (out of 100, None when not calculable), rank and category."""

    publication = models.ForeignKey(
        RankingPublication, on_delete=models.CASCADE, related_name="scores", verbose_name=_("published ranking")
    )
    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="monthly_scores", verbose_name=_("member")
    )
    delivery = models.FloatField(_("delivery"), null=True, blank=True)
    performance = models.FloatField(_("performance"), null=True, blank=True)
    load = models.FloatField(_("load"), null=True, blank=True)
    presence = models.FloatField(_("presence"), null=True, blank=True)
    reliability = models.FloatField(_("reliability"), null=True, blank=True)
    team = models.FloatField(_("team contribution"), null=True, blank=True)
    final = models.FloatField(_("monthly score"), null=True, blank=True)
    provisional = models.BooleanField(_("provisional"), default=False)
    ranking_score = models.FloatField(_("ranking score"), null=True, blank=True)
    category = models.CharField(_("category"), max_length=1, choices=Category.choices, blank=True)
    rank = models.PositiveIntegerField(_("rank"), null=True, blank=True)
    details = models.JSONField(_("details"), default=dict, blank=True)

    class Meta:
        # Its own words: "monthly score" is also the label of `final` (Arabic: indefinite here).
        verbose_name = _("member's monthly score")
        verbose_name_plural = _("members' monthly scores")
        ordering = ["rank", "member__first_name"]
        constraints = [models.UniqueConstraint(fields=["publication", "member"], name="uq_monthly_score")]

    def __str__(self):
        return f"{self.member} {self.publication}"
