from django.db import models
from django.db.models import F, Q
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy


class SubsystemStatus(models.TextChoices):
    PLANNED = "planned", _("Planned")
    ACTIVE = "active", _("Active")
    # Context: "Blocked" is masculine here (un sous-système bloqué), feminine for a task.
    BLOCKED = "blocked", pgettext_lazy("subsystem status", "Blocked")
    COMPLETE = "complete", _("Complete")


class MemberLevel(models.TextChoices):
    """Duplicated from apps.members on purpose: same meaning (main/junior),
    kept separate to avoid a cross-app import."""
    MAIN = "main", _("Main")
    JUNIOR = "junior", _("Junior")


class Subsystem(models.Model):
    # Stable identifier used by the seed command. NULL for subsystems created by hand.
    code = models.SlugField(_("code"), max_length=100, unique=True, null=True, blank=True)
    name = models.CharField(_("name"), max_length=255)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.PROTECT, related_name="subsystems", verbose_name=_("project")
    )
    # Technical org unit (fs_department) that owns it. Enforced in Django, not the DB.
    org_unit = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, related_name="subsystems",
        verbose_name=_("technical department"),
    )
    parent_subsystem = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children",
        verbose_name=_("parent subsystem"),
    )
    status = models.CharField(
        _("status"), max_length=20, choices=SubsystemStatus.choices, default=SubsystemStatus.PLANNED
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("subsystem")
        verbose_name_plural = _("subsystems")
        constraints = [
            models.CheckConstraint(
                condition=~Q(parent_subsystem=F("id")), name="ck_subsystem_not_own_parent"
            ),
        ]

    def __str__(self):
        return self.name


# The standard Formula Student lifecycle, from documentation/ENP_Racing_ERP_Schema_Guide.md (section 5.3),
# created by seed_lifecycle_steps: the name saved in the database (French, as in the guide), the same name
# to show in the reader's language, and whether a leader of the subsystem's unit validates the step
# (guide, section 15). Edit the list, then re-run the command.
STANDARD_STEPS = [
    ("Étude & recherche", pgettext_lazy("lifecycle step", "Study & research"), False),
    ("Conception CAD", pgettext_lazy("lifecycle step", "CAD design"), False),
    ("Simulation", pgettext_lazy("lifecycle step", "Simulation"), False),
    ("Validation par le chef", pgettext_lazy("lifecycle step", "Validation by the head"), True),
    ("Fabrication / achat", pgettext_lazy("lifecycle step", "Manufacturing / purchasing"), False),
    ("Contrôle réception", pgettext_lazy("lifecycle step", "Incoming inspection"), False),
    ("Intégration atelier", pgettext_lazy("lifecycle step", "Workshop integration"), False),
]
_STANDARD_NAMES = {saved: translated for saved, translated, _validation in STANDARD_STEPS}


def step_display_name(name):
    """A step name as saved, in the current language if it is a standard step's; a step added or
    renamed by the team is data, shown as typed."""
    translated = _STANDARD_NAMES.get(name)
    return str(translated) if translated is not None else name


class LifecycleStep(models.Model):
    step_order = models.IntegerField(_("order"), unique=True)
    name = models.CharField(_("name"), max_length=150)
    applies_to_ic = models.BooleanField(_("applies to IC"), default=True)
    applies_to_ev = models.BooleanField(_("applies to EV"), default=True)
    # Ticked only by a leader of the subsystem's unit ("Validation par le chef"); the steps after it
    # wait for it (apps/projects/access.py).
    requires_validation = models.BooleanField(_("validated by a unit leader"), default=False)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("lifecycle step")
        verbose_name_plural = _("lifecycle steps")
        ordering = ["step_order"]

    def __str__(self):
        return f"{self.step_order}. {self.display_name}"

    @property
    def display_name(self):
        """The name to show, in the reader's language for a standard step (see step_display_name)."""
        return step_display_name(self.name)


class SubsystemStepProgress(models.Model):
    subsystem = models.ForeignKey(
        Subsystem, on_delete=models.CASCADE, related_name="step_progress", verbose_name=_("subsystem")
    )
    lifecycle_step = models.ForeignKey(
        LifecycleStep, on_delete=models.PROTECT, related_name="progress_rows", verbose_name=_("lifecycle step")
    )
    is_complete = models.BooleanField(_("step completed"), default=False)
    completed_at = models.DateTimeField(_("completed at"), null=True, blank=True)
    validated_by = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.PROTECT, related_name="validated_steps",
        verbose_name=_("validated by"),
    )
    notes = models.TextField(_("notes"), blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("lifecycle progress")
        verbose_name_plural = _("lifecycle progress")
        constraints = [
            models.UniqueConstraint(
                fields=["subsystem", "lifecycle_step"], name="uq_substep_progress_subsystem_step"
            ),
        ]

    def __str__(self):
        return f"{self.subsystem} - {self.lifecycle_step}"


class MemberSubsystem(models.Model):
    """Table name kept close to the SQL schema's member_subsystem."""
    subsystem = models.ForeignKey(
        Subsystem, on_delete=models.CASCADE, related_name="member_assignments", verbose_name=_("subsystem")
    )
    member = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="subsystem_assignments", verbose_name=_("member")
    )
    member_level = models.CharField(_("member level"), max_length=10, choices=MemberLevel.choices)
    start_date = models.DateField(_("start date"), null=True, blank=True)
    end_date = models.DateField(_("end date"), null=True, blank=True)  # NULL = currently active
    note = models.CharField(_("note"), max_length=255, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("subsystem assignment")
        verbose_name_plural = _("subsystem assignments")
        constraints = [
            models.UniqueConstraint(
                fields=["subsystem", "member", "start_date"], name="uq_membersubsystem_subsystem_member_start"
            ),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(start_date__isnull=True) | Q(end_date__gte=F("start_date")),
                name="ck_membersubsystem_dates",
            ),
        ]

    def __str__(self):
        return f"{self.member} - {self.subsystem}"
