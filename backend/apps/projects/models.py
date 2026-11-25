from django.db import models
from django.db.models import F, Q
from django.utils.translation import gettext_lazy as _


class ProjectCategory(models.TextChoices):
    IC = "ic", _("Internal combustion (IC)")
    EV = "ev", _("Electric (EV)")
    COMPLEMENTARY = "complementary_competition", _("Complementary competition")
    CLUB = "club_project", _("Club project")


class ProjectStatus(models.TextChoices):
    PLANNED = "planned", _("Planned")
    ACTIVE = "active", _("Active")
    COMPLETED = "completed", _("Completed")
    ON_HOLD = "on_hold", _("On hold")


class Project(models.Model):
    # Stable identifier used by the seed command. NULL for projects created by hand.
    code = models.SlugField(_("code"), max_length=100, unique=True, null=True, blank=True)
    name = models.CharField(_("name"), max_length=255)
    # The prefix of its tasks' references (EV27 → EV27-001), chosen by who manages it. Empty: "P" and its id.
    key = models.CharField(_("reference key"), max_length=10, blank=True, default="")
    category = models.CharField(_("category"), max_length=30, choices=ProjectCategory.choices)
    # Owning OrgUnit (club department, or the FS team for ic/ev/complementary).
    org_unit = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, related_name="projects",
        verbose_name=_("organisational unit"),
    )
    description = models.TextField(_("description"), blank=True)
    start_date = models.DateField(_("start date"), null=True, blank=True)
    end_date = models.DateField(_("end date"), null=True, blank=True)
    status = models.CharField(_("status"), max_length=20, choices=ProjectStatus.choices)
    project_manager = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="managed_projects", verbose_name=_("project manager"),
    )
    # The season the project belongs to: its progress is the equal-weighted average of its Projects
    # (documentation/documentation_Tasks, specification §6.4).
    season = models.ForeignKey(
        "task_management.Season", null=True, blank=True, on_delete=models.SET_NULL, related_name="projects",
        verbose_name=_("season"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("project")
        verbose_name_plural = _("projects")
        indexes = [
            models.Index(fields=["category"], name="idx_project_category"),
            models.Index(fields=["status"], name="idx_project_status"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(start_date__isnull=True) | Q(end_date__gte=F("start_date")),
                name="ck_project_dates",
            ),
            models.UniqueConstraint(fields=["key"], condition=~Q(key=""), name="uniq_project_key"),
        ]

    def __str__(self):
        return self.name


class ProjectMember(models.Model):
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name="members", verbose_name=_("project")
    )
    member = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="project_memberships", verbose_name=_("member")
    )
    role = models.CharField(_("role in the project"), max_length=150, blank=True)
    start_date = models.DateField(_("start date"), null=True, blank=True)
    end_date = models.DateField(_("end date"), null=True, blank=True)
    is_active = models.BooleanField(_("active"), default=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("project member")
        verbose_name_plural = _("project members")
        constraints = [
            models.UniqueConstraint(fields=["project", "member"], name="uq_project_member_project_member"),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(start_date__isnull=True) | Q(end_date__gte=F("start_date")),
                name="ck_project_member_dates",
            ),
        ]

    def __str__(self):
        return f"{self.member} on {self.project}"
