from django.db import transaction
from django.db.models import Case, Count, IntegerField, Prefetch, Q, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.communication import notify
from apps.projects.access import work_access_for

from . import followup, workflow
from .models import (
    OPEN_STATUSES, UNRESOLVED, Blocker, BlockerStatus, Task, TaskAssignee, TaskComment, TaskEvent, TaskEventKind,
    TaskPriority, TaskStatus,
)
from .permissions import TaskPermission
from .serializers import (
    BlockerDecisionSerializer, BlockerResolutionSerializer, BlockerSerializer, BlockerWriteSerializer,
    ProgressSerializer, ReviseSerializer, SubmitSerializer, TaskCommentSerializer, TaskDetailSerializer, TaskLinkSerializer,
    TaskLinkWriteSerializer, TaskSerializer, TaskWriteSerializer, ValidateSerializer,
)

PRIORITY_ORDER = Case(
    When(priority=TaskPriority.HIGH, then=Value(0)),
    When(priority=TaskPriority.MEDIUM, then=Value(1)),
    When(priority=TaskPriority.LOW, then=Value(2)),
    default=Value(3),
    output_field=IntegerField(),
)

ASSIGNEES = Prefetch(
    "assignees",
    queryset=TaskAssignee.objects.select_related("member").order_by(
        "-is_primary", "member__last_name", "member__first_name"
    ),
)

LIST_PARAMETERS = [
    OpenApiParameter("project", int, description="Only the tasks of this project."),
    OpenApiParameter("subsystem", int, description="Only the tasks of this subsystem."),
    OpenApiParameter(
        "status", str, description=f"Only these statuses, comma-separated ({', '.join(TaskStatus.values)})."
    ),
    OpenApiParameter("priority", enum=TaskPriority.values, description="Only this priority."),
    OpenApiParameter("assignee", str, description='"me" for my tasks, or a member id.'),
    OpenApiParameter("parent", str, description='"none" for top-level tasks, or a task id for its subtasks.'),
    OpenApiParameter("search", str, description='Words in the title, or a reference ("EV27-007").'),
    OpenApiParameter("overdue", bool, description="Only the tasks past their due date, not submitted, not frozen."),
    OpenApiParameter("blocked", bool, description="Only the tasks with a blocker not resolved yet."),
]
ESTIMATE_FIELDS = workflow.ESTIMATE_FIELDS
TASK = OpenApiParameter("id", int, OpenApiParameter.PATH)
BLOCKER = OpenApiParameter("blocker_id", int, OpenApiParameter.PATH)


def integer(params, name):
    value = params.get(name)
    if value and not value.isdigit():
        raise ValidationError({name: _("A number is expected.")})
    return int(value) if value else None


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def at_step(task, statuses, message):
    if task.status not in statuses:
        raise ValidationError({"detail": message})


@extend_schema_view(
    list=extend_schema(summary="Tasks (every member sees all of them), most urgent first", parameters=LIST_PARAMETERS),
    retrieve=extend_schema(summary="A task with its subtasks, comments, links, blockers, history and the viewer's rights"),
    create=extend_schema(
        summary="Create a task (people involved in the project; points and dates by a leader)",
        request=TaskWriteSerializer,
        responses={201: TaskDetailSerializer},
    ),
    partial_update=extend_schema(
        summary="Change a task (its managers; the points and dates by a leader, before work starts)",
        request=TaskWriteSerializer,
        responses=TaskDetailSerializer,
    ),
    destroy=extend_schema(summary="Delete a task and its subtasks (admins, project manager, author)"),
)
class TaskViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    permission_classes = [IsAuthenticated, TaskPermission]

    def get_serializer_class(self):
        if self.action in ("create", "partial_update"):
            return TaskWriteSerializer
        if self.action == "retrieve":
            return TaskDetailSerializer
        return TaskSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "today": timezone.localdate()}

    def base_queryset(self):
        return (
            Task.objects.select_related(
                "project__org_unit", "subsystem__org_unit", "lifecycle_step", "created_by"
            )
            .prefetch_related(ASSIGNEES)
            .annotate(
                subtasks_total=Count("subtasks", distinct=True),
                subtasks_done=Count("subtasks", filter=Q(subtasks__status=TaskStatus.VALIDATED), distinct=True),
                comments_count=Count("comments", distinct=True),
                open_blockers=Count("blockers", filter=Q(blockers__status__in=UNRESOLVED), distinct=True),
                frozen_blockers=Count("blockers", filter=Q(blockers__status=BlockerStatus.VALIDATED), distinct=True),
                priority_order=PRIORITY_ORDER,
            )
        )

    def detail_queryset(self):
        return self.base_queryset().select_related("parent_task", "validated_by").prefetch_related(
            Prefetch("subtasks", queryset=Task.objects.prefetch_related(ASSIGNEES).order_by("id")),
            Prefetch("comments", queryset=TaskComment.objects.select_related("author")),
            "links__added_by",
            Prefetch(
                "blockers",
                queryset=Blocker.objects.select_related(
                    "responsible", "responsible_unit", "reported_by", "decided_by", "task__project",
                    "task__subsystem",
                ).order_by("reported_at", "id"),
            ),
            Prefetch("events", queryset=TaskEvent.objects.select_related("actor")),
        )

    def get_queryset(self):
        if self.action == "retrieve":
            return self.detail_queryset()
        tasks = self.base_queryset()
        if self.action != "list":
            return tasks
        params = self.request.query_params
        if (project := integer(params, "project")) is not None:
            tasks = tasks.filter(project_id=project)
        if (subsystem := integer(params, "subsystem")) is not None:
            tasks = tasks.filter(subsystem_id=subsystem)
        if params.get("status"):
            tasks = tasks.filter(status__in=params["status"].split(","))
        if params.get("priority"):
            tasks = tasks.filter(priority=params["priority"])
        if params.get("assignee") == "me":
            tasks = tasks.filter(assignees__member=self.request.user)
        elif (assignee := integer(params, "assignee")) is not None:
            tasks = tasks.filter(assignees__member_id=assignee)
        if params.get("parent") == "none":
            tasks = tasks.filter(parent_task__isnull=True)
        elif (parent := integer(params, "parent")) is not None:
            tasks = tasks.filter(parent_task_id=parent)
        if params.get("search"):
            words = params["search"].strip()
            reference = followup.reference_filter(words)
            tasks = tasks.filter(Q(title__icontains=words) | reference if reference else Q(title__icontains=words))
        if params.get("overdue") in ("1", "true"):
            tasks = tasks.filter(
                due_date__lt=timezone.localdate(), status__in=OPEN_STATUSES, frozen_blockers=0
            )
        if params.get("blocked") in ("1", "true"):
            tasks = tasks.filter(open_blockers__gt=0)
        return tasks.order_by("priority_order", "due_date", "id")

    def detail_response(self, task, status=200):
        """The task as TaskDetailSerializer shows it, read again after a change."""
        fresh = self.detail_queryset().get(pk=task.pk)
        return Response(TaskDetailSerializer(fresh, context=self.get_serializer_context()).data, status=status)

    def valid(self, serializer_class, request):
        serializer = serializer_class(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def locked(self, pk):
        """The task, locked for the change (two clicks at once make one change)."""
        task = self.get_object()
        return (
            Task.objects.select_for_update(of=("self",)).select_related("project", "subsystem")
            .prefetch_related(ASSIGNEES).get(pk=task.pk)
        )

    # --- Creating and changing ---

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        access = work_access_for(request)
        if not access.can_create_task(data["project"]):
            raise PermissionDenied(_("You cannot create tasks in this project."))
        if any(data.get(field) is not None for field in ESTIMATE_FIELDS):
            assigned = {member.pk for member in data.get("assignee_ids", [])}
            require(
                access.validates(data["project"], data.get("subsystem"))
                and (access.is_admin or request.user.pk not in assigned),
                _("Only a leader of the task sets its points and dates."),
            )
        with transaction.atomic():
            task = serializer.save()
            workflow.created(task, request.user)
        notify.task_assigned(task, notify.assignees(task), request.user)
        return self.detail_response(task, status=201)

    def update(self, request, *args, **kwargs):
        access = work_access_for(request)
        with transaction.atomic():
            # Locked, and the serializer works on the locked row: saved from a copy read before a validation or
            # a step committed in between, it would write back the old status, mark or due date.
            task = self.locked(kwargs["pk"])  # TaskPermission: edit rights
            assigned_before = set(task.assignees.values_list("member_id", flat=True))
            serializer = TaskWriteSerializer(task, data=request.data, partial=True,
                                             context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            estimated = [field for field in ESTIMATE_FIELDS if field in data and data[field] != getattr(task, field)]
            assigned_after = (
                {member.pk for member in data["assignee_ids"]} if "assignee_ids" in data else assigned_before
            )
            reassigned = assigned_after != assigned_before or (
                "primary_assignee_id" in data
                and getattr(data["primary_assignee_id"], "pk", None) != self.primary_assignee_id(task)
            )
            # Submitted or validated, the work and its points belong to who did it: the ranking scores a
            # validated task for its current assignees.
            if reassigned and task.status in (TaskStatus.SUBMITTED, TaskStatus.VALIDATED) and not access.is_admin:
                raise ValidationError({"assignee_ids": [_("The assignees of a submitted or validated task are kept.")]})
            if estimated:
                if task.status != TaskStatus.PLANNED:
                    raise ValidationError(
                        {field: [_("Locked since work started: only a validated blocker moves the due date.")]
                         for field in estimated}
                    )
                # As when creating: never on a task one is (or is being) assigned to, except the admins.
                require(
                    access.is_validator(task) and (access.is_admin or request.user.pk not in assigned_after),
                    _("Only a leader of the task sets its points and dates."),
                )
            task = serializer.save()
            if estimated:
                workflow.record(task, TaskEventKind.ESTIMATED, request.user, **workflow.estimate_data(task))
        added = [member for member in notify.assignees(task) if member.pk not in assigned_before]
        notify.task_assigned(task, added, request.user)
        return self.detail_response(task)

    @staticmethod
    def primary_assignee_id(task):
        primary = next((link for link in task.assignees.all() if link.is_primary), None)
        return primary.member_id if primary else None

    # --- The steps of the task (decision D-012) ---

    @extend_schema(summary="Start the work (planned → in progress)", parameters=[TASK], request=None,
                   responses=TaskDetailSerializer)
    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        access = work_access_for(request)
        with transaction.atomic():
            task = self.locked(pk)
            require(access.can_start(task), _("Only the people of this task start it."))
            at_step(task, [TaskStatus.PLANNED], _("This task has already started."))
            if not workflow.is_ready(task):
                raise ValidationError(
                    {"detail": _("Set the points, the start date and the due date first (a leader does).")}
                )
            workflow.start(task, request.user)
        return self.detail_response(task)

    @extend_schema(summary="Give how far a task is, its current phase and its next step (its people, its managers)",
                   parameters=[TASK], request=ProgressSerializer, responses=TaskDetailSerializer)
    @action(detail=True, methods=["post"])
    def progress(self, request, pk=None):
        access = work_access_for(request)
        with transaction.atomic():
            task = self.locked(pk)
            require(access.can_update_progress(task), _("Who works on this task or manages it gives its progress."))
            at_step(task, OPEN_STATUSES, _("This task is delivered: its progress no longer moves."))
            data = self.valid(ProgressSerializer, request)
            if "progress" in data and task.subtasks.exists():
                raise ValidationError({"progress": [_("The progress of this task follows its subtasks.")]})
            if all(getattr(task, field) == value for field, value in data.items()):
                raise ValidationError({"detail": _("Nothing changed: give a new progress, phase or next step.")})
            for field, value in data.items():
                setattr(task, field, value)
            task.save(update_fields=[*data, "updated_at"])
            workflow.record(task, TaskEventKind.PROGRESS, request.user, **data)
        return self.detail_response(task)

    @extend_schema(
        summary='The task a reference names ("EV27-007"), for the search of the top bar',
        parameters=[OpenApiParameter("reference", str, required=True)],
        responses={200: TaskSerializer, 404: OpenApiResponse(description="No task has this reference.")},
    )
    @action(detail=False, methods=["get"])
    def find(self, request):
        reference = followup.reference_filter(request.query_params.get("reference", ""))
        task = self.base_queryset().filter(reference).first() if reference else None
        if task is None:
            raise NotFound(_("No task has this reference."))
        return Response(TaskSerializer(task, context=self.get_serializer_context()).data)

    @extend_schema(summary="Submit the task with what was delivered and its evidence (its assignees)",
                   parameters=[TASK], request=SubmitSerializer, responses=TaskDetailSerializer)
    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        access = work_access_for(request)
        with transaction.atomic():
            task = self.locked(pk)
            require(access.works_on(task), _("The people assigned to this task submit it."))
            at_step(task, [TaskStatus.IN_PROGRESS, TaskStatus.NEEDS_REVISION], _("This task is not in progress."))
            data = self.valid(SubmitSerializer, request)
            evidence = None
            if data.get("evidence_url"):
                evidence = {
                    "url": data["evidence_url"], "label": data.get("evidence_label", ""),
                    "link_type": data.get("evidence_type", "other"),
                }
            elif not task.links.exists():
                raise ValidationError({"evidence_url": [_("A task is submitted with its evidence: add a link.")]})
            workflow.submit(task, request.user, data["actual_deliverable"], evidence)
        return self.detail_response(task)

    @extend_schema(summary="Validate a submitted task with its quality mark (its leaders)", parameters=[TASK],
                   request=ValidateSerializer, responses=TaskDetailSerializer)
    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        access = work_access_for(request)
        with transaction.atomic():
            task = self.locked(pk)
            require(access.is_validator(task), _("A leader of the task validates it, never one assigned to it."))
            at_step(task, [TaskStatus.SUBMITTED], _("This task is not submitted."))
            data = self.valid(ValidateSerializer, request)
            workflow.validate(task, request.user, data["quality_mark"])
        return self.detail_response(task)

    @extend_schema(summary="Send a submitted task back for revision, saying what to rework (its leaders)",
                   parameters=[TASK], request=ReviseSerializer, responses=TaskDetailSerializer)
    @action(detail=True, methods=["post"])
    def revise(self, request, pk=None):
        access = work_access_for(request)
        with transaction.atomic():
            task = self.locked(pk)
            require(access.is_validator(task), _("A leader of the task validates it, never one assigned to it."))
            at_step(task, [TaskStatus.SUBMITTED], _("This task is not submitted."))
            data = self.valid(ReviseSerializer, request)
            workflow.revise(task, request.user, data["comment"])
        return self.detail_response(task)

    @extend_schema(summary="Add a link to a task (its people)", parameters=[TASK], request=TaskLinkWriteSerializer,
                   responses={201: TaskLinkSerializer})
    @action(detail=True, methods=["post"])
    def links(self, request, pk=None):
        task = self.get_object()
        require(work_access_for(request).can_add_link(task), _("Only the people of this task add links to it."))
        data = self.valid(TaskLinkWriteSerializer, request)
        link = workflow.add_link(task, request.user, **data)
        return Response(TaskLinkSerializer(link, context=self.get_serializer_context()).data, status=201)

    # --- Blockers ---

    def blocker_response(self, blocker, status=200):
        fresh = Blocker.objects.select_related(
            "task__project", "task__subsystem", "responsible", "responsible_unit", "reported_by", "decided_by"
        ).get(pk=blocker.pk)
        return Response(BlockerSerializer(fresh, context=self.get_serializer_context()).data, status=status)

    def blocker_of(self, task, blocker_id):
        return get_object_or_404(
            Blocker.objects.select_for_update(of=("self",)).select_related("task__project", "task__subsystem"),
            pk=blocker_id, task=task,
        )

    @extend_schema(summary="Declare a blocker on a task (its people): its leaders decide", parameters=[TASK],
                   request=BlockerWriteSerializer, responses={201: BlockerSerializer})
    @action(detail=True, methods=["post"])
    def blockers(self, request, pk=None):
        access = work_access_for(request)
        with transaction.atomic():
            task = self.locked(pk)
            require(access.can_declare_blocker(task), _("Only the people of this task declare its blockers."))
            if task.status == TaskStatus.VALIDATED:
                raise ValidationError({"detail": _("This task is validated: it has nothing left to block.")})
            blocker = workflow.declare_blocker(task, request.user, dict(self.valid(BlockerWriteSerializer, request)))
        return self.blocker_response(blocker, status=201)

    @extend_schema(summary="Validate (the due date is frozen) or reject a blocker (the task's leaders)",
                   parameters=[TASK, BLOCKER], request=BlockerDecisionSerializer, responses=BlockerSerializer)
    @action(detail=True, methods=["post"], url_path=r"blockers/(?P<blocker_id>\d+)/decide")
    def decide_blocker(self, request, pk=None, blocker_id=None):
        access = work_access_for(request)
        with transaction.atomic():
            task = self.locked(pk)
            blocker = self.blocker_of(task, blocker_id)
            require(access.is_validator(task), _("A leader of the task decides its blockers."))
            if blocker.status != BlockerStatus.OPEN:
                raise ValidationError({"detail": _("This blocker is already decided.")})
            data = self.valid(BlockerDecisionSerializer, request)
            workflow.decide_blocker(blocker, request.user, data["accept"], data.get("note", ""))
        return self.blocker_response(blocker)

    @extend_schema(summary="Resolve a blocker (who must solve it, who declared it, the task's people and leaders)",
                   parameters=[TASK, BLOCKER], request=BlockerResolutionSerializer, responses=BlockerSerializer)
    @action(detail=True, methods=["post"], url_path=r"blockers/(?P<blocker_id>\d+)/resolve")
    def resolve_blocker(self, request, pk=None, blocker_id=None):
        access = work_access_for(request)
        with transaction.atomic():
            task = self.locked(pk)
            blocker = self.blocker_of(task, blocker_id)
            blocker.task = task  # with its assignees, for the rights
            require(access.can_resolve_blocker(blocker), _("You cannot resolve this blocker."))
            if blocker.status not in UNRESOLVED:
                raise ValidationError({"detail": _("This blocker is not open.")})
            data = self.valid(BlockerResolutionSerializer, request)
            workflow.resolve_blocker(blocker, request.user, data["resolution"])
        return self.blocker_response(blocker)

    # --- Comments ---

    @extend_schema(
        summary="Comment on a task (any member)",
        parameters=[TASK],
        request=TaskCommentSerializer,
        responses={201: TaskCommentSerializer},
    )
    @action(detail=True, methods=["post"], url_path="comments")
    def comment(self, request, pk=None):
        task = self.get_object()
        serializer = TaskCommentSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        comment = serializer.save(task=task, author=request.user)
        workflow.record(task, TaskEventKind.COMMENTED, request.user, comment=comment.pk)
        notify.task_commented(task, comment, request.user)
        return Response(TaskCommentSerializer(comment, context=self.get_serializer_context()).data, status=201)

    @extend_schema(
        summary="Delete a comment (its author or a club admin)",
        parameters=[TASK, OpenApiParameter("comment_id", int, OpenApiParameter.PATH)],
        request=None,
        responses={204: OpenApiResponse(description="Deleted.")},
    )
    @action(detail=True, methods=["delete"], url_path=r"comments/(?P<comment_id>\d+)")
    def delete_comment(self, request, pk=None, comment_id=None):
        comment = get_object_or_404(TaskComment, pk=comment_id, task=self.get_object())
        if not work_access_for(request).can_delete_comment(comment):
            raise PermissionDenied(_("You cannot delete this comment."))
        comment.delete()
        return Response(status=204)
