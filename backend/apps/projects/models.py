from django.db import models
from django.db.models import F, Q


class ProjectCategory(models.TextChoices):
    IC = "ic", "IC"
    EV = "ev", "EV"
    COMPLEMENTARY = "complementary_competition", "Complementary competition"
    CLUB = "club_project", "Club project"


class ProjectStatus(models.TextChoices):
    PLANNED = "planned", "Planned"
    ACTIVE = "active", "Active"
    COMPLETED = "completed", "Completed"
    ON_HOLD = "on_hold", "On hold"


class Project(models.Model):
    # Stable identifier used by the seed command. NULL for projects created by hand.
    code = models.SlugField(max_length=100, unique=True, null=True, blank=True)
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=30, choices=ProjectCategory.choices)
    # Owning OrgUnit (club department, or the FS team for ic/ev/complementary).
    org_unit = models.ForeignKey(
        "members.OrgUnit", on_delete=models.PROTECT, related_name="projects"
    )
    description = models.TextField(blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=ProjectStatus.choices)
    project_manager = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="managed_projects",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["category"], name="idx_project_category"),
            models.Index(fields=["status"], name="idx_project_status"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(start_date__isnull=True) | Q(end_date__gte=F("start_date")),
                name="ck_project_dates",
            ),
        ]

    def __str__(self):
        return self.name


class ProjectMember(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members")
    member = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="project_memberships"
    )
    role = models.CharField(max_length=150, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "member"], name="uq_project_member_project_member"),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(start_date__isnull=True) | Q(end_date__gte=F("start_date")),
                name="ck_project_member_dates",
            ),
        ]

    def __str__(self):
        return f"{self.member} on {self.project}"