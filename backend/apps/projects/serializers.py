import re

from django.db import IntegrityError, transaction
from django.utils import timezone

from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.members.access import scope_of
from apps.members.models import Member, Membership, OrgUnit, Role, RoleScope
from apps.members.rules import charter_problems
from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer

from .access import work_access_for
from .health import ProjectHealth, project_health
from .models import Project, ProjectMember


# The role the Board gives a project manager it names (seed_roles), and the unit where the cars' managers hold it.
PROJECT_MANAGER_ROLE = "project-manager"
PROJECT_DEPARTMENT = "dept-projet"


def give_manager_role(project):
    """The Board names the project managers (charter art. 2 and 6, decision D-025): one whose roles do not allow
    it yet gets the Project Manager role, in the project's unit or the nearest one above it taking the club's roles
    (the Project Department for the cars), the charter checked."""
    manager = project.project_manager
    if manager is None or Membership.objects.filter(
        member=manager, end_date__isnull=True, role__can_be_project_manager=True
    ).exists():
        return
    role = (
        Role.objects.filter(code=PROJECT_MANAGER_ROLE).first()
        or Role.objects.filter(can_be_project_manager=True, scope=RoleScope.CLUB).order_by("pk").first()
    )
    unit = project.org_unit
    while role is not None and unit is not None and scope_of(unit) != role.scope:
        unit = unit.parent
    unit = unit or OrgUnit.objects.filter(code=PROJECT_DEPARTMENT).first()
    if role is None or unit is None:
        raise serializers.ValidationError(
            {"project_manager_id": _("This member cannot be a project manager: none of their roles allows it.")}
        )
    membership = Membership.objects.create(
        member=manager, org_unit=unit, role=role, start_date=timezone.localdate(), is_primary=False
    )
    problems = charter_problems(membership)
    if problems:  # the save's transaction undoes the project too
        raise serializers.ValidationError({"project_manager_id": problems})


class ProjectSummarySerializer(serializers.ModelSerializer):
    """A project inside other objects (the project of a subsystem or of a task)."""

    class Meta:
        model = Project
        fields = ["id", "name", "category"]


class ProjectPermissionsSerializer(serializers.Serializer):
    edit = serializers.BooleanField(help_text="May change name, description, status and dates.")
    create_task = serializers.BooleanField(help_text="May create tasks in this project.")
    estimate_tasks = serializers.BooleanField(
        help_text="Sets the points and dates of its tasks outside a subsystem (see the subsystem's permissions)."
    )


class ProjectSerializer(serializers.ModelSerializer):
    org_unit = OrgUnitSummarySerializer(read_only=True)
    org_unit_id = serializers.PrimaryKeyRelatedField(
        source="org_unit", queryset=OrgUnit.objects.filter(is_active=True), write_only=True
    )
    project_manager = MemberSummarySerializer(read_only=True, allow_null=True)
    project_manager_id = serializers.PrimaryKeyRelatedField(
        source="project_manager",
        queryset=Member.objects.filter(is_active=True),
        write_only=True,
        allow_null=True,
        required=False,
    )
    # Counts annotated by the view's queryset (ProjectViewSet.get_queryset).
    tasks_total = serializers.IntegerField(read_only=True)
    tasks_done = serializers.IntegerField(read_only=True)
    tasks_blocked = serializers.IntegerField(read_only=True)
    tasks_overdue = serializers.IntegerField(read_only=True, help_text="Open tasks past their due date.")
    subsystems_count = serializers.IntegerField(read_only=True)
    health = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id", "name", "key", "category", "status", "description", "start_date", "end_date",
            "org_unit", "org_unit_id", "project_manager", "project_manager_id",
            "tasks_total", "tasks_done", "tasks_blocked", "tasks_overdue", "subsystems_count", "health",
            "permissions",
        ]
        extra_kwargs = {"key": {"help_text": 'The prefix of its tasks\' references: 2 to 10 capitals and digits ("EV27").'}}

    def validate_key(self, key):
        key = key.strip().upper()
        if key and not re.fullmatch(r"[A-Z0-9]{2,10}", key):
            raise serializers.ValidationError(_("Give 2 to 10 capital letters or digits, e.g. EV27."))
        if re.fullmatch(r"P\d+", key):  # the references of a project without its key: P12-007
            raise serializers.ValidationError(_("P followed by digits is kept for the projects without a key."))
        if key and Project.objects.filter(key=key).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError(_("Another project already has this key."))
        project = self.instance
        if (project is not None and project.key and key != project.key and project.tasks.exists()
                and not work_access_for(self.context["request"]).is_admin):
            # Its tasks' references are already written in comments, e-mails and reports.
            raise serializers.ValidationError(_("This project's tasks are numbered with its key: an admin changes it."))
        return key

    def save(self, **kwargs):
        try:
            with transaction.atomic():
                project = super().save(**kwargs)
                if "project_manager" in self.validated_data:
                    give_manager_role(project)
                return project
        except IntegrityError as clash:  # another project took the key between the check and the save
            raise serializers.ValidationError({"key": [_("Another project already has this key.")]}) from clash

    @extend_schema_field(serializers.ChoiceField(choices=ProjectHealth.choices))
    def get_health(self, project):
        """In preparation, on track, at risk, on hold, completed (apps/projects/health.py)."""
        return project_health(project, timezone.localdate())

    @extend_schema_field(ProjectPermissionsSerializer)
    def get_permissions(self, project):
        access = work_access_for(self.context["request"])
        return {
            "edit": access.can_edit_project(project),
            "create_task": access.can_create_task(project),
            "estimate_tasks": access.validates(project),
        }

    def validate(self, attrs):
        access = work_access_for(self.context["request"])
        if self.instance is not None and not access.is_admin and {"org_unit", "project_manager"} & attrs.keys():
            raise PermissionDenied(_("Only club admins can change the owning unit or the project manager."))

        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": _("The end date cannot be before the start date.")})

        # A manager whose roles do not allow it yet gets the Project Manager role on saving (give_manager_role).
        return attrs


class ProjectTeamMemberSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)

    class Meta:
        model = ProjectMember
        fields = ["id", "member", "role", "start_date", "end_date"]


class ProjectDetailSerializer(ProjectSerializer):
    """A project with its current team (people taking part, with their role in it)."""

    team = serializers.SerializerMethodField()

    class Meta(ProjectSerializer.Meta):
        fields = ProjectSerializer.Meta.fields + ["team"]

    @extend_schema_field(ProjectTeamMemberSerializer(many=True))
    def get_team(self, project):
        team = getattr(project, "current_team", None)
        if team is None:  # not prefetched (after a write)
            team = project.members.filter(is_active=True, end_date__isnull=True).select_related("member")
        return ProjectTeamMemberSerializer(team, many=True).data
