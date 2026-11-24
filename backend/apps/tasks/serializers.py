from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member, OrgUnit
from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer
from apps.projects.access import work_access_for
from apps.projects.models import Project
from apps.projects.serializers import ProjectSummarySerializer
from apps.subsystems.models import LifecycleStep, Subsystem
from apps.subsystems.serializers import steps_for

from . import followup
from .models import (
    OPEN_STATUSES, Blocker, BlockerOrigin, BlockerSeverity, Task, TaskAssignee, TaskComment, TaskEvent, TaskLink,
    TaskLinkType, TaskPoints,
)


class SubsystemSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Subsystem
        fields = ["id", "name"]


class StepSummarySerializer(serializers.ModelSerializer):
    # In the reader's language for a standard step, as typed for the team's own (LifecycleStep.display_name).
    name = serializers.CharField(source="display_name", read_only=True)

    class Meta:
        model = LifecycleStep
        fields = ["id", "step_order", "name"]


class TaskAssigneeSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)

    class Meta:
        model = TaskAssignee
        fields = ["member", "is_primary"]


class TaskPermissionsSerializer(serializers.Serializer):
    edit = serializers.BooleanField(help_text="May change the task and its assignees.")
    delete = serializers.BooleanField()
    comment = serializers.BooleanField()
    start = serializers.BooleanField(help_text="May start it now (planned → in progress).")
    submit = serializers.BooleanField(help_text="May submit it now, with its evidence.")
    validate = serializers.BooleanField(help_text="May validate it with a quality mark, or send it back.")
    estimate = serializers.BooleanField(help_text="May set its points and dates (a leader, before work starts).")
    declare_blocker = serializers.BooleanField()
    update_progress = serializers.BooleanField(help_text="May give how far it is, its phase and its next step.")


def is_overdue(task, today):
    """Past its due date (Algiers time), not submitted nor validated, and no validated blocker freezing it."""
    frozen = getattr(task, "frozen_blockers", 0)
    return bool(task.due_date and task.status in OPEN_STATUSES and task.due_date < today and not frozen)


class TaskSerializer(serializers.ModelSerializer):
    """A task as listed (kanban card, "my tasks"), with what the viewer may do with it."""

    project = ProjectSummarySerializer(read_only=True)
    subsystem = SubsystemSummarySerializer(read_only=True, allow_null=True)
    lifecycle_step = StepSummarySerializer(read_only=True, allow_null=True)
    parent_id = serializers.IntegerField(source="parent_task_id", read_only=True, allow_null=True)
    assignees = TaskAssigneeSerializer(many=True, read_only=True)
    # Counts annotated by the view's queryset (TaskViewSet.get_queryset).
    subtasks_total = serializers.IntegerField(read_only=True)
    subtasks_done = serializers.IntegerField(read_only=True, help_text="Subtasks validated.")
    comments_count = serializers.IntegerField(read_only=True)
    is_overdue = serializers.SerializerMethodField()
    is_blocked = serializers.SerializerMethodField()
    # The work order (decision D-022): its reference, how far it is, its health, its team.
    reference = serializers.CharField(read_only=True, help_text='The project\'s key and its number: "EV27-007".')
    progress = serializers.SerializerMethodField()
    progress_mode = serializers.SerializerMethodField()
    health = serializers.SerializerMethodField()
    unit = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id", "reference", "title", "status", "priority", "points", "start_date", "due_date", "is_overdue",
            "is_blocked", "scored", "quality_mark", "project", "subsystem", "lifecycle_step", "unit", "parent_id",
            "assignees", "subtasks_total", "subtasks_done", "comments_count", "progress", "progress_mode",
            "health", "current_phase", "next_step", "permissions",
        ]
        read_only_fields = fields  # output only: every field is always present

    @extend_schema_field(serializers.BooleanField(help_text="Past its due date, not submitted, not frozen."))
    def get_is_overdue(self, task):
        return is_overdue(task, self.context["today"])

    @extend_schema_field(serializers.BooleanField(help_text="It has a blocker not resolved yet."))
    def get_is_blocked(self, task):
        return getattr(task, "open_blockers", 0) > 0

    @extend_schema_field(serializers.IntegerField(help_text="0 to 100: 100 once delivered, else from its "
                                                             "subtasks, else as its people give it."))
    def get_progress(self, task):
        return followup.progress(task)

    @extend_schema_field(serializers.ChoiceField(choices=followup.ProgressMode.choices))
    def get_progress_mode(self, task):
        return followup.progress_mode(task)

    @extend_schema_field(serializers.ChoiceField(choices=followup.Health.choices))
    def get_health(self, task):
        return followup.health(task, self.context["today"], self.get_is_overdue(task), self.get_is_blocked(task))

    @extend_schema_field(OrgUnitSummarySerializer)
    def get_unit(self, task):
        """Its team: the department of its subsystem, else the project's unit."""
        unit = task.subsystem.org_unit if task.subsystem_id else task.project.org_unit
        return OrgUnitSummarySerializer(unit).data

    @extend_schema_field(TaskPermissionsSerializer)
    def get_permissions(self, task):
        return work_access_for(self.context["request"]).task_rights(task)


class SubtaskSerializer(serializers.ModelSerializer):
    assignees = TaskAssigneeSerializer(many=True, read_only=True)

    class Meta:
        model = Task
        fields = ["id", "title", "status", "priority", "due_date", "assignees"]
        read_only_fields = fields


class TaskCommentSerializer(serializers.ModelSerializer):
    author = MemberSummarySerializer(read_only=True)
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = TaskComment
        fields = ["id", "author", "content", "created_at", "can_delete"]
        extra_kwargs = {"content": {"max_length": 5000}}

    @extend_schema_field(serializers.BooleanField(help_text="The viewer may delete this comment."))
    def get_can_delete(self, comment):
        return work_access_for(self.context["request"]).can_delete_comment(comment)


class TaskLinkSerializer(serializers.ModelSerializer):
    added_by = MemberSummarySerializer(read_only=True)

    class Meta:
        model = TaskLink
        fields = ["id", "url", "label", "link_type", "added_by", "created_at"]
        read_only_fields = fields  # output only: every field is always present


class TaskLinkWriteSerializer(serializers.ModelSerializer):
    """A link added to a task: Drive, GitHub, CAD file, report... (web addresses only)."""

    url = serializers.URLField(max_length=500, help_text="An http(s) address.")

    class Meta:
        model = TaskLink
        fields = ["url", "label", "link_type"]

    def validate_url(self, value):
        if not value.lower().startswith(("http://", "https://")):
            raise serializers.ValidationError(_("Enter a web address (http or https)."))
        return value


class BlockerPermissionsSerializer(serializers.Serializer):
    decide = serializers.BooleanField(help_text="May validate or reject it (a leader of the task).")
    resolve = serializers.BooleanField()


class BlockerSerializer(serializers.ModelSerializer):
    """A blocker of a task, with what the viewer may do with it."""

    responsible = MemberSummarySerializer(read_only=True, allow_null=True)
    responsible_unit = OrgUnitSummarySerializer(read_only=True, allow_null=True)
    reported_by = MemberSummarySerializer(read_only=True, allow_null=True)
    decided_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Blocker
        fields = [
            "id", "description", "origin", "severity", "dependency", "required_action", "responsible",
            "responsible_unit", "known_since", "is_late", "reported_by", "reported_at", "status", "decided_by",
            "decided_at", "decision_note", "resolved_at", "resolution", "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(BlockerPermissionsSerializer)
    def get_permissions(self, blocker):
        return work_access_for(self.context["request"]).blocker_rights(blocker)


class BlockerWriteSerializer(serializers.ModelSerializer):
    """A blocker declared on a task: what blocks it, how badly, what must be done, by whom."""

    origin = serializers.ChoiceField(choices=BlockerOrigin.choices, required=False)
    severity = serializers.ChoiceField(choices=BlockerSeverity.choices, required=False)
    responsible_id = serializers.PrimaryKeyRelatedField(
        source="responsible", queryset=Member.objects.filter(is_active=True), allow_null=True, required=False,
        help_text="Who must solve it.",
    )
    responsible_unit_id = serializers.PrimaryKeyRelatedField(
        source="responsible_unit", queryset=OrgUnit.objects.filter(is_active=True), allow_null=True, required=False,
    )
    known_since = serializers.DateField(required=False, help_text="When the problem became known (default: today).")

    class Meta:
        model = Blocker
        fields = [
            "description", "origin", "severity", "dependency", "required_action", "responsible_id",
            "responsible_unit_id", "known_since",
        ]

    def validate_known_since(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError(_("A problem cannot be known in the future."))
        return value


class BlockerDecisionSerializer(serializers.Serializer):
    accept = serializers.BooleanField(help_text="True: validated (the due date is frozen); false: rejected.")
    note = serializers.CharField(required=False, allow_blank=True, help_text="Why it is rejected (required then).")

    def validate(self, data):
        if not data["accept"] and not data.get("note", "").strip():
            raise serializers.ValidationError({"note": [_("Say why the blocker is rejected.")]})
        return data


class BlockerResolutionSerializer(serializers.Serializer):
    resolution = serializers.CharField(help_text="How it was solved.")


class TaskEventSerializer(serializers.ModelSerializer):
    actor = MemberSummarySerializer(read_only=True, allow_null=True)

    class Meta:
        model = TaskEvent
        fields = ["id", "kind", "actor", "data", "created_at"]
        read_only_fields = fields


class ParentTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["id", "title"]
        read_only_fields = fields


class TaskDetailSerializer(TaskSerializer):
    parent = ParentTaskSerializer(source="parent_task", read_only=True, allow_null=True)
    created_by = MemberSummarySerializer(read_only=True, allow_null=True)
    validated_by = MemberSummarySerializer(read_only=True, allow_null=True)
    subtasks = SubtaskSerializer(many=True, read_only=True)
    comments = TaskCommentSerializer(many=True, read_only=True)
    links = TaskLinkSerializer(many=True, read_only=True)
    blockers = BlockerSerializer(many=True, read_only=True)
    events = TaskEventSerializer(many=True, read_only=True)

    class Meta(TaskSerializer.Meta):
        fields = TaskSerializer.Meta.fields + [
            "parent", "description", "deliverable", "success_criteria", "actual_deliverable", "initial_due_date",
            "started_at", "submitted_at", "validated_at", "validated_by", "created_by", "created_at", "updated_at",
            "subtasks", "comments", "links", "blockers", "events",
        ]
        read_only_fields = fields


class TaskWriteSerializer(serializers.ModelSerializer):
    """Create or change a task. The answer is the task as TaskDetailSerializer shows it. The status moves
    through the steps of the task (start, submit, validate...), never here."""

    project_id = serializers.PrimaryKeyRelatedField(source="project", queryset=Project.objects.all())
    parent_id = serializers.PrimaryKeyRelatedField(
        source="parent_task", queryset=Task.objects.all(), allow_null=True, required=False
    )
    subsystem_id = serializers.PrimaryKeyRelatedField(
        source="subsystem", queryset=Subsystem.objects.all(), allow_null=True, required=False
    )
    lifecycle_step_id = serializers.PrimaryKeyRelatedField(
        source="lifecycle_step", queryset=LifecycleStep.objects.all(), allow_null=True, required=False
    )
    points = serializers.ChoiceField(
        choices=TaskPoints.choices, allow_null=True, required=False,
        help_text="1 routine to 5 project-critical: set by a leader, before work starts.",
    )
    assignee_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Member.objects.filter(is_active=True), required=False, write_only=True,
        help_text="Everyone assigned to the task (replaces the current list).",
    )
    primary_assignee_id = serializers.PrimaryKeyRelatedField(
        queryset=Member.objects.filter(is_active=True), allow_null=True, required=False, write_only=True,
        help_text="The main owner, one of the assignees (default: the current one, else the first).",
    )

    class Meta:
        model = Task
        fields = [
            "project_id", "parent_id", "subsystem_id", "lifecycle_step_id", "title", "description", "priority",
            "points", "start_date", "due_date", "deliverable", "success_criteria", "assignee_ids",
            "primary_assignee_id",
        ]

    def validate(self, attrs):
        if "status" in getattr(self, "initial_data", {}):
            raise serializers.ValidationError(
                {"status": [_("The status changes through the steps of the task: start, submit, validate.")]}
            )
        task = self.instance
        if task is not None and "project" in attrs and attrs["project"].pk != task.project_id:
            raise serializers.ValidationError({"project_id": _("A task cannot move to another project.")})
        project = attrs.get("project") or task.project

        parent = attrs["parent_task"] if "parent_task" in attrs else getattr(task, "parent_task", None)
        if parent is not None:
            if task is not None and parent.pk == task.pk:
                raise serializers.ValidationError({"parent_id": _("A task cannot be its own parent.")})
            if parent.project_id != project.pk:
                raise serializers.ValidationError(
                    {"parent_id": _("A subtask must belong to the same project as its parent task.")}
                )
            if parent.parent_task_id is not None:
                raise serializers.ValidationError({"parent_id": _("A subtask cannot have subtasks of its own.")})
            if task is not None and task.subtasks.exists():
                raise serializers.ValidationError({"parent_id": _("A task with subtasks cannot become a subtask.")})

        subsystem = attrs["subsystem"] if "subsystem" in attrs else getattr(task, "subsystem", None)
        if subsystem is not None and subsystem.project_id != project.pk:
            raise serializers.ValidationError(
                {"subsystem_id": _("The subsystem must belong to the task's project.")}
            )
        # Only the steps of the project's car: those of an IC project, or of an EV one (decision D-023).
        step = attrs.get("lifecycle_step")
        if step is not None and not steps_for(project, [step]):
            raise serializers.ValidationError({"lifecycle_step_id": _("This step does not apply to this project.")})

        start = attrs["start_date"] if "start_date" in attrs else getattr(task, "start_date", None)
        due = attrs["due_date"] if "due_date" in attrs else getattr(task, "due_date", None)
        if start is not None and due is not None and due < start:
            raise serializers.ValidationError({"due_date": [_("The due date cannot be before the start date.")]})

        primary = attrs.get("primary_assignee_id")
        if primary is not None:
            if "assignee_ids" in attrs:
                assigned = attrs["assignee_ids"]
            else:
                assigned = [row.member for row in task.assignees.all()] if task is not None else []
            if primary not in assigned:
                raise serializers.ValidationError(
                    {"primary_assignee_id": _("The main assignee must be one of the assignees.")}
                )
        return attrs

    def create(self, validated_data):
        members = validated_data.pop("assignee_ids", [])
        primary = validated_data.pop("primary_assignee_id", None)
        task = Task.objects.create(**validated_data, created_by=self.context["request"].user)
        self._set_assignees(task, members, primary)
        return task

    def update(self, instance, validated_data):
        members = validated_data.pop("assignee_ids", None)
        primary = validated_data.pop("primary_assignee_id", None)
        task = super().update(instance, validated_data)
        if members is not None or primary is not None:
            if members is None:
                members = [row.member for row in task.assignees.select_related("member")]
            self._set_assignees(task, members, primary)
        return task

    @staticmethod
    def _set_assignees(task, members, primary):
        """Assign exactly `members`, with one main assignee among them (if any)."""
        ids = list(dict.fromkeys(member.pk for member in members))  # without duplicates, in order
        current = task.assignees.filter(is_primary=True).values_list("member_id", flat=True).first()
        if primary is not None:
            primary_id = primary.pk
        elif current in ids:
            primary_id = current
        else:
            primary_id = ids[0] if ids else None
        task.assignees.exclude(member_id__in=ids).delete()
        existing = set(task.assignees.values_list("member_id", flat=True))
        TaskAssignee.objects.bulk_create([TaskAssignee(task=task, member_id=pk) for pk in ids if pk not in existing])
        # One main assignee at most (database constraint): clear the others before setting it.
        task.assignees.exclude(member_id=primary_id).filter(is_primary=True).update(is_primary=False)
        if primary_id is not None:
            task.assignees.filter(member_id=primary_id).update(is_primary=True)


class ProgressSerializer(serializers.Serializer):
    """What its people tell about a task in progress; each field is optional."""

    progress = serializers.IntegerField(min_value=0, max_value=100, required=False,
                                        help_text="0 to 100, for a task without subtasks.")
    current_phase = serializers.CharField(max_length=150, allow_blank=True, required=False)
    next_step = serializers.CharField(max_length=255, allow_blank=True, required=False)


class SubmitSerializer(serializers.Serializer):
    actual_deliverable = serializers.CharField(help_text="What was delivered.")
    evidence_url = serializers.URLField(
        required=False, allow_blank=True, max_length=500,
        help_text="A link to its proof (file, CAD, test report, photo, commit...): required if the task has none.",
    )
    evidence_label = serializers.CharField(required=False, allow_blank=True, max_length=255)
    evidence_type = serializers.ChoiceField(choices=TaskLinkType.choices, required=False)

    def validate_evidence_url(self, value):
        if value and not value.lower().startswith(("http://", "https://")):
            raise serializers.ValidationError(_("Enter a web address (http or https)."))
        return value


class ValidateSerializer(serializers.Serializer):
    quality_mark = serializers.IntegerField(
        min_value=0, max_value=5, help_text="0 unusable to 5 ready to use (Ranking System §3.1)."
    )


class ReviseSerializer(serializers.Serializer):
    comment = serializers.CharField(help_text="What to rework.")
