from django.db.models import Case, Count, IntegerField, Prefetch, Q, Value, When
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view, inline_serializer
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.tasks.models import UNRESOLVED, TaskStatus

from .access import work_access_for
from .health import overdue_count
from .models import Project, ProjectCategory, ProjectMember, ProjectStatus
from .permissions import ProjectPermission
from .serializers import ProjectDetailSerializer, ProjectSerializer

# Active projects first, then the coming ones, then the paused and finished ones.
STATUS_ORDER = Case(
    When(status=ProjectStatus.ACTIVE, then=Value(0)),
    When(status=ProjectStatus.PLANNED, then=Value(1)),
    When(status=ProjectStatus.ON_HOLD, then=Value(2)),
    default=Value(3),
    output_field=IntegerField(),
)


@extend_schema_view(
    list=extend_schema(
        summary="Projects (every member sees all of them)",
        parameters=[
            OpenApiParameter("status", enum=ProjectStatus.values, description="Only this status."),
            OpenApiParameter("category", enum=ProjectCategory.values, description="Only this category."),
            OpenApiParameter("mine", bool, description="Only the projects I work on, manage or lead."),
        ],
    ),
    retrieve=extend_schema(summary="A project, with its current team"),
    create=extend_schema(summary="Create a project (club admins: the Board and the Team Manager, D-025)"),
    partial_update=extend_schema(
        summary="Change a project (admins and its manager; unit and manager: admins only)"
    ),
)
class ProjectViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    http_method_names = ["get", "post", "patch", "head", "options"]
    permission_classes = [IsAuthenticated, ProjectPermission]

    def get_serializer_class(self):
        return ProjectDetailSerializer if self.action == "retrieve" else ProjectSerializer

    def get_queryset(self):
        projects = (
            Project.objects.select_related("org_unit", "project_manager")
            .annotate(
                tasks_total=Count("tasks", distinct=True),
                tasks_done=Count("tasks", filter=Q(tasks__status=TaskStatus.VALIDATED), distinct=True),
                # A task with a blocker not resolved yet (apps/tasks: decision D-012).
                tasks_blocked=Count("tasks", filter=Q(tasks__blockers__status__in=UNRESOLVED), distinct=True),
                subsystems_count=Count("subsystems", distinct=True),
                tasks_overdue=overdue_count(timezone.localdate()),
                status_order=STATUS_ORDER,
            )
            .order_by("status_order", "name")
        )
        if self.action == "retrieve":
            projects = projects.prefetch_related(
                Prefetch(
                    "members",
                    queryset=ProjectMember.objects.filter(is_active=True, end_date__isnull=True)
                    .select_related("member")
                    .order_by("member__last_name", "member__first_name"),
                    to_attr="current_team",
                )
            )
        params = self.request.query_params
        if params.get("status"):
            projects = projects.filter(status=params["status"])
        if params.get("category"):
            projects = projects.filter(category=params["category"])
        if params.get("mine") in ("1", "true"):
            access = work_access_for(self.request)
            projects = projects.filter(
                Q(pk__in=access.project_ids) | Q(org_unit_id__in=access.led_unit_ids)
            )
        return projects

    @extend_schema(
        summary="Whether the viewer creates projects (the Board and the Team Manager, decision D-025)",
        responses=inline_serializer("ProjectCreating", {"can_create": serializers.BooleanField()}),
    )
    @action(detail=False, methods=["get"])
    def creating(self, request):
        return Response({"can_create": work_access_for(request).can_create_project()})

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = serializer.save()
        # Answer with the project as listed (its counts come from the annotated queryset).
        return Response(self.get_serializer(self.get_queryset().get(pk=project.pk)).data, status=201)
