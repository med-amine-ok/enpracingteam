from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.communication import notify
from apps.projects.access import work_access_for

from .models import LifecycleStep, MemberSubsystem, Subsystem, SubsystemStepProgress
from .permissions import SubsystemPermission
from .serializers import (
    LifecycleStepSerializer,
    StepUpdateSerializer,
    SubsystemSerializer,
    steps_for,
    waiting_for,
)


class SubsystemStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subsystem
        fields = ["status"]


@extend_schema(summary="The engineering lifecycle steps, in order")
class LifecycleStepListView(generics.ListAPIView):
    queryset = LifecycleStep.objects.order_by("step_order")
    serializer_class = LifecycleStepSerializer
    pagination_class = None


@extend_schema_view(
    list=extend_schema(
        summary="Subsystems with their lifecycle progress and assigned members",
        parameters=[
            OpenApiParameter("project", int, description="Only the subsystems of this project."),
            OpenApiParameter("org_unit", int, description="Only the subsystems of this technical department."),
        ],
    ),
    retrieve=extend_schema(summary="A subsystem with its lifecycle progress"),
    partial_update=extend_schema(
        summary="Change the status of a subsystem (admins, project manager, leaders of its unit)",
        request=SubsystemStatusSerializer,
        responses=SubsystemSerializer,
    ),
)
class SubsystemViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet
):
    http_method_names = ["get", "patch", "head", "options"]
    permission_classes = [IsAuthenticated, SubsystemPermission]
    serializer_class = SubsystemSerializer

    def get_queryset(self):
        subsystems = (
            Subsystem.objects.select_related("project", "org_unit")
            .prefetch_related(
                Prefetch(
                    "member_assignments",
                    queryset=MemberSubsystem.objects.select_related("member").order_by(
                        "member__last_name", "member__first_name"
                    ),
                ),
                Prefetch("step_progress", queryset=SubsystemStepProgress.objects.select_related("validated_by")),
            )
            .order_by("project__name", "parent_subsystem_id", "name")
        )
        params = self.request.query_params
        # A non-numeric id (hand-edited URL) is a 400, not a 500 on the integer lookup.
        for name in ("project", "org_unit"):
            if params.get(name) and not params[name].isdigit():
                raise ValidationError({name: _("A number is expected.")})
        if params.get("project"):
            subsystems = subsystems.filter(project_id=params["project"])
        if params.get("org_unit"):
            subsystems = subsystems.filter(org_unit_id=params["org_unit"])
        return subsystems

    def get_serializer_context(self):
        # The steps are read once per request, not once per subsystem.
        return {**super().get_serializer_context(), "lifecycle_steps": list(LifecycleStep.objects.order_by("step_order"))}

    def update(self, request, *args, **kwargs):
        subsystem = self.get_object()
        status = SubsystemStatusSerializer(subsystem, data=request.data, partial=True)
        status.is_valid(raise_exception=True)
        status.save()
        return Response(self.get_serializer(self.get_queryset().get(pk=subsystem.pk)).data)

    @extend_schema(
        summary="Tick or untick a lifecycle step of a subsystem",
        description=(
            "Members assigned to the subsystem, the project manager and the leaders of its unit tick the "
            "steps; a step that requires validation only a leader of the unit (or a club admin). A step "
            "placed after a validation step waits for that validation."
        ),
        parameters=[
            OpenApiParameter("id", int, OpenApiParameter.PATH),
            OpenApiParameter("step_id", int, OpenApiParameter.PATH, description="The lifecycle step."),
        ],
        request=StepUpdateSerializer,
        responses=SubsystemSerializer,
    )
    @action(detail=True, methods=["patch"], url_path=r"steps/(?P<step_id>\d+)")
    def step(self, request, pk=None, step_id=None):
        subsystem = self.get_object()
        all_steps = list(LifecycleStep.objects.order_by("step_order"))
        steps = steps_for(subsystem.project, all_steps)
        step = get_object_or_404(LifecycleStep, pk=step_id)
        if step not in steps:
            raise ValidationError({"step": _("This step does not apply to this project.")})

        access = work_access_for(request)
        if not access.can_tick_step(subsystem, step):
            if step.requires_validation:
                raise PermissionDenied(_("Only a leader of the subsystem's unit can validate this step."))
            raise PermissionDenied(_("You cannot update the steps of this subsystem."))

        data = StepUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        done = data.validated_data["is_complete"]
        progress = {row.lifecycle_step_id: row for row in subsystem.step_progress.all()}
        waiting = waiting_for(step, steps, progress)
        if done and waiting is not None:
            message = _("This step waits for the validation step “%(step)s”.") % {"step": waiting.display_name}
            raise ValidationError({"is_complete": message})

        row, _created = SubsystemStepProgress.objects.get_or_create(subsystem=subsystem, lifecycle_step=step)
        just_done = done and not row.is_complete
        if done != row.is_complete:
            row.is_complete = done
            row.completed_at = timezone.now() if done else None
            row.validated_by = request.user if done and step.requires_validation else None
        if "notes" in data.validated_data:
            row.notes = data.validated_data["notes"]
        row.save()
        if just_done:
            # A validation now awaited by the unit leaders, or signed: tell the people concerned.
            notify.step_ticked(subsystem, step, steps, {**progress, step.pk: row}, request.user)
        return Response(self.get_serializer(self.get_queryset().get(pk=subsystem.pk)).data)
