from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer
from apps.projects.access import work_access_for
from apps.projects.models import ProjectCategory
from apps.projects.serializers import ProjectSummarySerializer

from .models import LifecycleStep, MemberSubsystem, Subsystem


class LifecycleStepSerializer(serializers.ModelSerializer):
    # In the reader's language for a standard step, as typed for the team's own (LifecycleStep.display_name).
    name = serializers.CharField(source="display_name", read_only=True)

    class Meta:
        model = LifecycleStep
        fields = ["id", "step_order", "name", "requires_validation", "applies_to_ic", "applies_to_ev"]


def steps_for(project, steps):
    """The lifecycle steps that apply to the project's car (IC or EV); all of them otherwise."""
    if project.category == ProjectCategory.IC:
        return [step for step in steps if step.applies_to_ic]
    if project.category == ProjectCategory.EV:
        return [step for step in steps if step.applies_to_ev]
    return list(steps)


def waiting_for(step, steps, progress):
    """The earlier step that needs validation and is not done yet: `step` waits for it (or None)."""
    for earlier in steps:
        if earlier.step_order >= step.step_order:
            return None
        row = progress.get(earlier.pk)
        if earlier.requires_validation and not (row and row.is_complete):
            return earlier
    return None


class StepStateSerializer(serializers.Serializer):
    """One lifecycle step of a subsystem: done or not, by whom, and what the viewer may do."""

    step = LifecycleStepSerializer()
    is_complete = serializers.BooleanField()
    completed_at = serializers.DateTimeField(allow_null=True)
    validated_by = MemberSummarySerializer(allow_null=True)
    notes = serializers.CharField(allow_blank=True)
    waiting_for = serializers.IntegerField(
        allow_null=True, help_text="Order of the validation step this step waits for (it cannot be done before)."
    )
    can_tick = serializers.BooleanField(help_text="The viewer may tick or untick this step.")


class SubsystemAssignmentSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)

    class Meta:
        model = MemberSubsystem
        fields = ["member", "member_level"]


class SubsystemPermissionsSerializer(serializers.Serializer):
    edit = serializers.BooleanField(help_text="May change the status.")
    validate = serializers.BooleanField(help_text="May tick the steps that require a unit leader.")
    estimate_tasks = serializers.BooleanField(help_text="Sets the points and dates of its tasks (a leader).")


class SubsystemSerializer(serializers.ModelSerializer):
    project = ProjectSummarySerializer(read_only=True)
    org_unit = OrgUnitSummarySerializer(read_only=True)
    parent_id = serializers.IntegerField(source="parent_subsystem_id", read_only=True, allow_null=True)
    members = serializers.SerializerMethodField()
    steps = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Subsystem
        fields = ["id", "name", "status", "project", "org_unit", "parent_id", "members", "steps", "permissions"]
        read_only_fields = fields  # output only (the status is changed with SubsystemStatusSerializer)

    @extend_schema_field(SubsystemAssignmentSerializer(many=True))
    def get_members(self, subsystem):
        current = [row for row in subsystem.member_assignments.all() if row.end_date is None]
        return SubsystemAssignmentSerializer(current, many=True).data

    @extend_schema_field(StepStateSerializer(many=True))
    def get_steps(self, subsystem):
        access = work_access_for(self.context["request"])
        steps = steps_for(subsystem.project, self.context["lifecycle_steps"])
        progress = {row.lifecycle_step_id: row for row in subsystem.step_progress.all()}
        states = []
        for step in steps:
            row = progress.get(step.pk)
            waiting = waiting_for(step, steps, progress)
            states.append({
                "step": LifecycleStepSerializer(step).data,
                "is_complete": bool(row and row.is_complete),
                "completed_at": row.completed_at if row else None,
                "validated_by": MemberSummarySerializer(row.validated_by).data if row and row.validated_by else None,
                "notes": row.notes if row else "",
                "waiting_for": waiting.step_order if waiting else None,
                "can_tick": access.can_tick_step(subsystem, step),
            })
        return states

    @extend_schema_field(SubsystemPermissionsSerializer)
    def get_permissions(self, subsystem):
        access = work_access_for(self.context["request"])
        return {
            "edit": access.can_edit_subsystem(subsystem),
            "validate": access.can_validate(subsystem),
            "estimate_tasks": access.validates(subsystem.project, subsystem),
        }


class StepUpdateSerializer(serializers.Serializer):
    is_complete = serializers.BooleanField()
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)
