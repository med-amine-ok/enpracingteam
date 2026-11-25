"""The operational API of the work module, under /api/work/ (Members and Heads). The scoring API is apart, in
scoring_views.py. Every change goes through a service (services/), which checks the workflow and logs it."""

from collections import Counter
from datetime import timedelta

from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.members.serializers import OrgUnitSummarySerializer
from apps.projects.models import Project

from . import serializers as s
from .access import access_for
from .models import (
    ActivityLog, Assignment, Blocker, BlockerStatus, Deliverable, DeliverableStatus, DependencyLink,
    DependencyProposal, DependencyState, LinkStatus, Milestone, NOT_OFFICIAL, ProjectDepartment, ProposalStatus,
    ReliefInterval, Season, Submission, WorkOrder, WorkOrderStatus,
)
from .services import blockers, deliverables, dependencies, progress, submissions, work_orders


def number(params, name):
    value = params.get(name)
    if value in (None, ""):
        return None
    if not str(value).isdigit():
        raise ValidationError({name: ["A number is expected."]})
    return int(value)


def date_param(params, name):
    value = params.get(name)
    if not value:
        return None
    try:
        return timezone.datetime.fromisoformat(value).date()
    except ValueError:
        raise ValidationError({name: ["A date (YYYY-MM-DD) is expected."]}) from None


def as_float(value):
    return None if value is None else float(value)


BUDGET_ACTIONS = ("weight_changed", "budget_changed")


def visible_activity(access, queryset):
    """Budget and weight changes stay with those who see the budget (guide §2.1): not even their name."""
    if access.is_admin or access.is_scoring_admin:
        return queryset
    return queryset.exclude(Q(action__in=BUDGET_ACTIONS) & ~Q(work_order__department_id__in=access.led_unit_ids))


def params(*names, ints=()):
    """The query filters of a list, for the API schema (strings, or numbers for `ints`)."""
    return [OpenApiParameter(name, int if name in ints else str) for name in (*names, *ints)]


WORK_ORDER_FILTERS = params("status", "proposals", "mine", "search", ints=("season", "department", "project"))
DELIVERABLE_FILTERS = params(
    "status", "dep_state", "execution_state", "assignee", "deadline_before", "deadline_after", "proposals", "search",
    ints=("work_order", "department", "season", "project"),
)
DEPENDENCY_FILTERS = params("state", "all", ints=("deliverable", "work_order", "department"))
BLOCKER_FILTERS = params("status", "mine", ints=("deliverable", "work_order", "department"))

ASSIGNMENTS = Prefetch("assignments", queryset=Assignment.objects.select_related("member"))
DELIVERABLE_LIST = ("work_order__department", "work_order__project", "proposed_by")


class Base(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]

    @property
    def access(self):
        return access_for(self.request)

    def done(self, instance, serializer_class=None, code=status.HTTP_200_OK):
        serializer_class = serializer_class or self.detail_serializer
        instance = self.get_queryset().get(pk=instance.pk)
        return Response(serializer_class(instance, context=self.get_serializer_context()).data, status=code)


# --- Me, seasons, projects ---


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="What the viewer may do in the work module, and the current season")
    def get(self, request):
        access = access_for(request)
        season = Season.objects.filter(is_active=True).first()
        return Response({
            **access.capabilities(),
            "current_season": s.SeasonSerializer(season, context={"request": request}).data if season else None,
        })


class SeasonViewSet(Base, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                    mixins.UpdateModelMixin):
    serializer_class = s.SeasonSerializer
    queryset = Season.objects.all()
    pagination_class = None

    def check_admin(self):
        if not self.access.is_admin:
            raise PermissionDenied("Only the club admins manage the seasons.")

    def perform_create(self, serializer):
        self.check_admin()
        serializer.save()

    def perform_update(self, serializer):
        self.check_admin()
        serializer.save()

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="A season's progress: the plain average of its projects, each with its departments")
    @action(detail=True)
    def overview(self, request, pk=None):
        season = self.get_object()
        total, by_project = progress.season_progress(season)
        projects = []
        for project in season.projects.order_by("name"):
            value, by_department = progress.project_progress(project)
            projects.append({
                "id": project.pk, "name": project.name, "status": project.status, "progress": as_float(value),
                "departments": department_rows(by_department),
            })
        return Response({
            "season": s.SeasonSerializer(season, context={"request": request}).data,
            "progress": as_float(total), "projects": projects,
        })


def department_rows(by_department):
    from apps.members.models import OrgUnit

    units = {unit.pk: unit for unit in OrgUnit.objects.filter(pk__in=list(by_department))}
    return [
        {**OrgUnitSummarySerializer(units[pk]).data, "progress": as_float(value)}
        for pk, value in sorted(by_department.items(), key=lambda item: units[item[0]].name)
    ]


class ProjectProgressViewSet(Base):
    """The projects seen through the work hierarchy (Season → Project → Department)."""

    queryset = Project.objects.select_related("season").order_by("name")

    @extend_schema(responses=OpenApiTypes.OBJECT, operation_id="work_projects_list", summary="The projects, their season, participating departments and progress")
    def list(self, request):
        season = number(request.query_params, "season")
        rows = []
        projects = self.get_queryset()
        if season:
            projects = projects.filter(season_id=season)
        for project in projects:
            value, by_department = progress.project_progress(project)
            rows.append({
                "id": project.pk, "name": project.name, "status": project.status, "season": project.season_id,
                "progress": as_float(value), "departments": department_rows(by_department),
            })
        return Response(rows)

    @extend_schema(responses=OpenApiTypes.OBJECT, operation_id="work_projects_retrieve", summary="A project's departments, their Work Orders and progress")
    def retrieve(self, request, pk=None):
        project = get_object_or_404(self.get_queryset(), pk=pk)
        value, by_department = progress.project_progress(project)
        work_orders_ = self.access.visible_work_orders(
            WorkOrder.objects.filter(project=project).select_related("department", "project", "coordinator", "proposed_by")
            .prefetch_related("deliverables")
        )
        return Response({
            "id": project.pk, "name": project.name, "status": project.status, "season": project.season_id,
            "progress": as_float(value), "departments": department_rows(by_department),
            "work_orders": s.WorkOrderSerializer(work_orders_, many=True, context=self.get_serializer_context()).data,
            "can_manage": self.access.is_admin or project.project_manager_id == request.user.pk,
        })

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT, summary="Set the project's season and participating departments (club admins, its manager)")
    @action(detail=True, methods=["post"])
    def setup(self, request, pk=None):
        project = get_object_or_404(self.get_queryset(), pk=pk)
        if not (self.access.is_admin or project.project_manager_id == request.user.pk):
            raise PermissionDenied("Only the club admins and the project manager set this.")
        if "season" in request.data:
            season = request.data["season"]
            project.season = get_object_or_404(Season, pk=season) if season else None
            project.save(update_fields=["season", "updated_at"])
        if "departments" in request.data:
            wanted = {int(pk) for pk in request.data["departments"]}
            ProjectDepartment.objects.filter(project=project).exclude(org_unit_id__in=wanted).delete()
            for unit in wanted:
                ProjectDepartment.objects.get_or_create(project=project, org_unit_id=unit)
        return self.retrieve(request, pk)


# --- Work Orders ---


class WorkOrderViewSet(Base, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    serializer_class = s.WorkOrderSerializer
    detail_serializer = s.WorkOrderDetailSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # the API schema's generation
            return WorkOrder.objects.none()
        queryset = WorkOrder.objects.select_related(
            "department", "project", "coordinator", "proposed_by", "proposal_decided_by", "created_by", "season",
            "budget_rubric",
        ).prefetch_related(Prefetch("deliverables", queryset=Deliverable.objects.prefetch_related(ASSIGNMENTS)))
        return self.access.visible_work_orders(queryset)

    def get_serializer_class(self):
        return self.detail_serializer if self.action == "retrieve" else s.WorkOrderSerializer

    @extend_schema(parameters=WORK_ORDER_FILTERS, summary="Work Orders (official ones for everybody; proposals for their author and Heads)")
    def list(self, request, *args, **kwargs):
        params = request.query_params
        queryset = self.get_queryset()
        for name in ("season", "department", "project"):
            value = number(params, name)
            if value:
                queryset = queryset.filter(**{f"{name}_id": value})
        if params.get("status"):
            queryset = queryset.filter(status__in=params["status"].split(","))
        proposals = params.get("proposals")
        if proposals == "only":
            queryset = queryset.filter(proposal_status__in=NOT_OFFICIAL)
        elif proposals != "include":
            queryset = queryset.exclude(proposal_status__in=NOT_OFFICIAL)
        if params.get("mine"):
            queryset = queryset.filter(
                Q(deliverables__assignments__member=request.user, deliverables__assignments__is_active=True)
                | Q(coordinator=request.user) | Q(proposed_by=request.user)
            ).distinct()
        if params.get("search"):
            words = params["search"].strip()
            queryset = queryset.filter(Q(title__icontains=words) | Q(code__icontains=words))
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(s.WorkOrderSerializer(page, many=True, context=self.get_serializer_context()).data)

    @extend_schema(request=s.WorkOrderWriteSerializer, responses=s.WorkOrderDetailSerializer,
                   summary="A Head creates an official Work Order; anybody else's is a proposal (submit=false: a draft)")
    def create(self, request):
        serializer = s.WorkOrderWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("reason", None)
        submit = data.pop("submit", True)
        as_proposal = request.query_params.get("proposal") == "1" or not self.access.heads(data["department"].pk)
        if as_proposal:
            work_order = work_orders.propose(request.user, data, submit=submit)
        else:
            work_order = work_orders.create(request.user, data)
        return self.done(work_order, code=status.HTTP_201_CREATED)

    @extend_schema(request=s.WorkOrderUpdateSerializer, responses=s.WorkOrderDetailSerializer,
                   summary="Edit (Heads; the author while the proposal is pending)")
    def partial_update(self, request, pk=None):
        work_order = self.get_object()
        rights = s.work_order_rights(self.access, work_order)
        if not rights["edit"]:
            raise PermissionDenied("You may not edit this Work Order.")
        serializer = s.WorkOrderUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        reason = data.pop("reason", "")
        if "budget_tier" in data and not self.access.heads(work_order.department_id):
            raise PermissionDenied("Only the Head sets the budget.")
        work_order = work_orders.update(request.user, work_order, data, reason=reason)
        return self.done(work_order)

    def head_only(self, work_order):
        self.access.require_head(work_order.department_id)

    @extend_schema(request=None, responses=s.WorkOrderDetailSerializer, summary="Submit a draft proposal")
    @action(detail=True, methods=["post"], url_path="submit-proposal")
    def submit_proposal(self, request, pk=None):
        return self.done(work_orders.submit_proposal(request.user, self.get_object()))

    @extend_schema(request=s.WorkNoteSerializer, responses=s.WorkOrderDetailSerializer, summary="Approve the proposal")
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        work_order = self.get_object()
        self.head_only(work_order)
        return self.done(work_orders.approve(request.user, work_order, request.data.get("note", "")))

    @extend_schema(request=s.WorkNoteSerializer, responses=s.WorkOrderDetailSerializer, summary="Reject the proposal")
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        work_order = self.get_object()
        self.head_only(work_order)
        return self.done(work_orders.reject(request.user, work_order, request.data.get("note", "")))

    @extend_schema(request=None, responses=s.WorkOrderDetailSerializer, summary="Draft → planning")
    @action(detail=True, methods=["post"], url_path="to-planning")
    def to_planning(self, request, pk=None):
        work_order = self.get_object()
        self.head_only(work_order)
        return self.done(work_orders.to_planning(request.user, work_order))

    @extend_schema(request=None, responses=s.WorkOrderDetailSerializer,
                   summary="Activate: the credit plan must be valid (budget, dates, weights = 100 %)")
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        work_order = self.get_object()
        self.head_only(work_order)
        return self.done(work_orders.activate(request.user, work_order))

    @extend_schema(request=s.WorkReasonSerializer, responses=s.WorkOrderDetailSerializer, summary="Cancel (reason required)")
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        work_order = self.get_object()
        self.head_only(work_order)
        return self.done(work_orders.cancel(request.user, work_order, request.data.get("reason", "")))

    @extend_schema(request=s.RubricSerializer, responses=s.WorkOrderDetailSerializer,
                   summary="The four budget ratings; the suggested budget comes back in `rubric`")
    @action(detail=True, methods=["post"])
    def rubric(self, request, pk=None):
        work_order = self.get_object()
        self.head_only(work_order)
        serializer = s.RubricSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        work_orders.set_rubric(request.user, work_order, serializer.validated_data)
        return self.done(work_order)

    @extend_schema(request=s.WeightsSerializer, responses=s.WorkOrderDetailSerializer,
                   summary="Set the Deliverables' official weights (once active: total 100 % and a reason)")
    @action(detail=True, methods=["post"])
    def weights(self, request, pk=None):
        work_order = self.get_object()
        self.head_only(work_order)
        serializer = s.WeightsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deliverables.set_weights(request.user, work_order, serializer.validated_data["weights"],
                                 reason=serializer.validated_data.get("reason", ""))
        return self.done(work_order)

    @extend_schema(responses=s.ActivitySerializer(many=True), summary="The Work Order's activity, its Deliverables' included")
    @action(detail=True)
    def activity(self, request, pk=None):
        work_order = self.get_object()
        rows = visible_activity(self.access, ActivityLog.objects.filter(work_order=work_order).select_related(
            "actor", "work_order"))
        page = self.paginate_queryset(rows)
        return self.get_paginated_response(s.ActivitySerializer(page, many=True, context=self.get_serializer_context()).data)

    @extend_schema(responses=s.DependencyLinkSerializer(many=True),
                   summary="The dependencies of its Deliverables (derived: no Work Order dependency table, §10.9)")
    @action(detail=True, pagination_class=None)
    def dependencies(self, request, pk=None):
        work_order = self.get_object()
        links = links_queryset().filter(Q(prerequisite__work_order=work_order) | Q(dependent__work_order=work_order))
        return Response(s.DependencyLinkSerializer(links, many=True, context=self.get_serializer_context()).data)


# --- Deliverables ---


class DeliverableViewSet(Base, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    serializer_class = s.DeliverableSerializer
    detail_serializer = s.DeliverableDetailSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Deliverable.objects.none()
        queryset = Deliverable.objects.select_related(*DELIVERABLE_LIST, "work_order__season").prefetch_related(ASSIGNMENTS)
        if self.action != "list":
            queryset = queryset.select_related("proposal_decided_by", "first_complete").prefetch_related(
                Prefetch("milestones", queryset=Milestone.objects.select_related("created_by", "completed_by")
                         .prefetch_related("dependency_links")),
                Prefetch("submissions", queryset=Submission.objects.select_related(
                    "submitted_by", "review__reviewer", "review__revision").prefetch_related("evidence")),
                Prefetch("prerequisite_links", queryset=links_queryset()),
                Prefetch("dependents_links", queryset=links_queryset()),
                Prefetch("blockers", queryset=blockers_queryset()),
                Prefetch("relief_intervals", queryset=ReliefInterval.objects.select_related("claimed_by", "decided_by")),
            )
        return self.access.visible_deliverables(queryset)

    def get_serializer_class(self):
        return self.detail_serializer if self.action == "retrieve" else s.DeliverableSerializer

    @extend_schema(parameters=DELIVERABLE_FILTERS, summary="Deliverables across Work Orders, with filters (My Work: assignee=me)")
    def list(self, request, *args, **kwargs):
        params = request.query_params
        queryset = self.get_queryset()
        for name, field in (("work_order", "work_order_id"), ("department", "work_order__department_id"),
                            ("season", "work_order__season_id"), ("project", "work_order__project_id")):
            value = number(params, name)
            if value:
                queryset = queryset.filter(**{field: value})
        for name, field in (("status", "status__in"), ("dep_state", "dep_state__in"),
                            ("execution_state", "execution_state__in")):
            if params.get(name):
                queryset = queryset.filter(**{field: params[name].split(",")})
        assignee = params.get("assignee")
        if assignee:
            member = request.user.pk if assignee == "me" else number(params, "assignee")
            queryset = queryset.filter(assignments__member_id=member, assignments__is_active=True).distinct()
        before, after = date_param(params, "deadline_before"), date_param(params, "deadline_after")
        if before:
            queryset = queryset.filter(original_deadline__lte=before)
        if after:
            queryset = queryset.filter(original_deadline__gte=after)
        proposals = params.get("proposals")
        if proposals == "only":
            queryset = queryset.filter(proposal_status__in=NOT_OFFICIAL)
        elif proposals != "include":
            queryset = queryset.exclude(proposal_status__in=NOT_OFFICIAL)
        if params.get("search"):
            words = params["search"].strip()
            queryset = queryset.filter(Q(title__icontains=words) | Q(code__icontains=words))
        queryset = queryset.order_by("original_deadline", "pk")
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(s.DeliverableSerializer(page, many=True, context=self.get_serializer_context()).data)

    def work_order_for_create(self, request):
        work_order = get_object_or_404(
            self.access.visible_work_orders(WorkOrder.objects.select_related("department")),
            pk=number(request.data, "work_order") or 0,
        )
        return work_order

    @extend_schema(request=s.DeliverableWriteSerializer, responses=s.DeliverableDetailSerializer,
                   summary="A Head creates an official Deliverable; anybody else's is a proposal. Body: work_order + fields")
    def create(self, request):
        work_order = self.work_order_for_create(request)
        serializer = s.DeliverableWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        members = data.pop("member_ids", [])
        justification = data.pop("justification", "")
        submit = data.pop("submit", True)
        weight = data.pop("weight", None)
        for name in ("reason", "note"):
            data.pop(name, None)
        if self.access.heads(work_order.department_id) and request.query_params.get("proposal") != "1":
            deliverable = deliverables.create(request.user, work_order, data, members)
            if weight is not None:
                deliverables.set_weights(request.user, work_order, {deliverable.pk: weight},
                                         reason=request.data.get("reason", ""), partial=True)
        else:
            deliverable = deliverables.propose(request.user, work_order, data, justification=justification, submit=submit)
        return self.done(deliverable, code=status.HTTP_201_CREATED)

    @extend_schema(request=s.DeliverableWriteSerializer, responses=s.DeliverableDetailSerializer,
                   summary="Edit the official details (Head; reason once its Work Order is active)")
    def partial_update(self, request, pk=None):
        deliverable = self.get_object()
        rights = s.deliverable_rights(self.access, deliverable)
        if not rights["edit"]:
            raise PermissionDenied("You may not edit this Deliverable.")
        serializer = s.DeliverableWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = {key: value for key, value in serializer.validated_data.items() if key in deliverables.OFFICIAL_FIELDS}
        if serializer.validated_data.get("weight") is not None:
            self.access.require_head(deliverable.work_order.department_id)
            deliverables.set_weights(request.user, deliverable.work_order, {deliverable.pk: serializer.validated_data["weight"]},
                                     reason=serializer.validated_data.get("reason", ""), partial=True)
        deliverables.update(request.user, deliverable, data, reason=serializer.validated_data.get("reason", ""))
        return self.done(deliverable)

    def head_only(self, deliverable):
        self.access.require_head(deliverable.work_order.department_id)

    @extend_schema(request=None, responses=s.DeliverableDetailSerializer)
    @action(detail=True, methods=["post"], url_path="submit-proposal")
    def submit_proposal(self, request, pk=None):
        return self.done(deliverables.submit_proposal(request.user, self.get_object()))

    @extend_schema(request=s.DeliverableWriteSerializer, responses=s.DeliverableDetailSerializer,
                   summary="Approve the proposal, setting its official criteria, dates, weight and members")
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        deliverable = self.get_object()
        self.head_only(deliverable)
        serializer = s.DeliverableWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        members = data.pop("member_ids", [])
        note = data.pop("note", "")
        for name in ("justification", "submit", "reason"):
            data.pop(name, None)
        return self.done(deliverables.approve(request.user, deliverable, data, members, note))

    @extend_schema(request=s.WorkNoteSerializer, responses=s.DeliverableDetailSerializer)
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        deliverable = self.get_object()
        self.head_only(deliverable)
        return self.done(deliverables.reject(request.user, deliverable, request.data.get("note", "")))

    @extend_schema(request=None, responses=s.DeliverableDetailSerializer, summary="Draft → ready (Head)")
    @action(detail=True, methods=["post"], url_path="mark-ready")
    def mark_ready(self, request, pk=None):
        deliverable = self.get_object()
        self.head_only(deliverable)
        return self.done(deliverables.mark_ready(request.user, deliverable))

    @extend_schema(request=None, responses=s.DeliverableDetailSerializer,
                   summary="Start, or resume after a revision request (assigned members, Head)")
    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        deliverable = self.get_object()
        self.access.require_works_on(deliverable)
        return self.done(deliverables.start(request.user, deliverable))

    @extend_schema(request=s.WorkReasonSerializer, responses=s.DeliverableDetailSerializer,
                   summary="Cancel; its weight goes equally to the other active Deliverables")
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        deliverable = self.get_object()
        self.head_only(deliverable)
        return self.done(deliverables.cancel(request.user, deliverable, request.data.get("reason", "")))

    @extend_schema(request=s.WorkReasonSerializer, responses=s.DeliverableDetailSerializer,
                   summary="Reopen a validated Deliverable (explicit, audited)")
    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        deliverable = self.get_object()
        self.head_only(deliverable)
        return self.done(deliverables.reopen(request.user, deliverable, request.data.get("reason", "")))

    @extend_schema(request=s.WorkProgressSerializer, responses=s.DeliverableDetailSerializer,
                   summary="The progress slider, 0–100 % (assigned members, Head)")
    @action(detail=True, methods=["post"])
    def progress(self, request, pk=None):
        deliverable = self.get_object()
        self.access.require_works_on(deliverable)
        serializer = s.WorkProgressSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deliverables.update_progress(request.user, deliverable, serializer.validated_data["progress"],
                                     serializer.validated_data["note"])
        return self.done(deliverable)

    @extend_schema(request=s.AssignSerializer, responses=s.DeliverableDetailSerializer, summary="Assign a member (Head)")
    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        deliverable = self.get_object()
        self.head_only(deliverable)
        serializer = s.AssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        deliverables.assign(request.user, deliverable, data["member"], data["role"], data["reason"])
        return self.done(deliverable)

    @extend_schema(request=s.MilestoneWriteSerializer, responses=s.MilestoneSerializer,
                   summary="Add a Milestone (assigned members, Head)")
    @action(detail=True, methods=["post"])
    def milestones(self, request, pk=None):
        deliverable = self.get_object()
        self.access.require_works_on(deliverable)
        serializer = s.MilestoneWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        milestone = deliverables.create_milestone(request.user, deliverable, **serializer.validated_data)
        return Response(s.MilestoneSerializer(milestone, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)

    @extend_schema(request=s.WorkSubmitSerializer, responses=s.DeliverableDetailSerializer,
                   summary="Submit the work with its evidence (assigned members)")
    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        deliverable = self.get_object()
        serializer = s.WorkSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        submissions.submit(request.user, deliverable, data["submission_note"], data["evidence"], data["declares_complete"])
        return self.done(deliverable, code=status.HTTP_201_CREATED)

    @extend_schema(request=s.ReliefIntervalSerializer, responses=s.DeliverableDetailSerializer,
                   summary="Claim deadline relief for a period the work was genuinely prevented")
    @action(detail=True, methods=["post"])
    def relief(self, request, pk=None):
        deliverable = self.get_object()
        self.access.require_works_on(deliverable)
        serializer = s.ReliefIntervalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        dependencies.claim(request.user, deliverable, dict(serializer.validated_data))
        return self.done(deliverable, code=status.HTTP_201_CREATED)

    @extend_schema(responses=s.ActivitySerializer(many=True), summary="The Deliverable's activity")
    @action(detail=True)
    def activity(self, request, pk=None):
        deliverable = self.get_object()
        rows = visible_activity(self.access, ActivityLog.objects.filter(deliverable=deliverable).select_related(
            "actor", "work_order"))
        page = self.paginate_queryset(rows)
        return self.get_paginated_response(s.ActivitySerializer(page, many=True, context=self.get_serializer_context()).data)

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="The progress updates of a Deliverable")
    @action(detail=True, url_path="progress-log")
    def progress_log(self, request, pk=None):
        deliverable = self.get_object()
        rows = deliverable.progress_log.select_related("recorded_by")[:100]
        return Response([
            {"id": row.pk, "progress": row.progress_pct, "note": row.note, "recorded_at": row.recorded_at,
             "recorded_by": str(row.recorded_by) if row.recorded_by else None}
            for row in rows
        ])


class MilestoneViewSet(Base, mixins.RetrieveModelMixin):
    serializer_class = s.MilestoneSerializer
    detail_serializer = s.MilestoneSerializer

    def get_queryset(self):
        return Milestone.objects.select_related("deliverable__work_order", "created_by", "completed_by").prefetch_related(
            "dependency_links"
        )

    def get_object(self):
        milestone = super().get_object()
        if not self.access.sees_deliverable(milestone.deliverable):
            raise PermissionDenied()
        return milestone

    @extend_schema(request=s.MilestoneWriteSerializer, responses=s.MilestoneSerializer)
    def partial_update(self, request, pk=None):
        milestone = self.get_object()
        self.access.require_works_on(milestone.deliverable)
        serializer = s.MilestoneWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return self.done(deliverables.update_milestone(request.user, milestone, serializer.validated_data))

    def destroy(self, request, pk=None):
        milestone = self.get_object()
        self.access.require_head(milestone.deliverable.work_order.department_id)
        deliverables.delete_milestone(request.user, milestone)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=s.MilestoneCompleteSerializer, responses=s.MilestoneSerializer,
                   summary="Completed or not completed (assigned members, Head)")
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        milestone = self.get_object()
        self.access.require_works_on(milestone.deliverable)
        serializer = s.MilestoneCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        return self.done(deliverables.set_completed(request.user, milestone, data["is_completed"], data["note"]))

    @extend_schema(request=s.WorkReasonSerializer, responses=s.MilestoneSerializer,
                   summary="Cancel (Head); refused when a dependency refers to it")
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        milestone = self.get_object()
        self.access.require_head(milestone.deliverable.work_order.department_id)
        return self.done(deliverables.cancel_milestone(request.user, milestone, request.data.get("reason", "")))

    @extend_schema(responses=s.MilestoneHistorySerializer(many=True))
    @action(detail=True, pagination_class=None)
    def history(self, request, pk=None):
        milestone = self.get_object()
        return Response(s.MilestoneHistorySerializer(milestone.history.select_related("changed_by"), many=True).data)


class AssignmentViewSet(Base):
    queryset = Assignment.objects.select_related("deliverable__work_order", "member")

    @extend_schema(request=s.WorkReasonSerializer, responses=None, summary="Unassign (Head, audited)")
    @action(detail=True, methods=["post"])
    def unassign(self, request, pk=None):
        assignment = self.get_object()
        self.access.require_head(assignment.deliverable.work_order.department_id)
        deliverables.unassign(request.user, assignment, request.data.get("reason", ""))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=s.RoleSerializer, responses=None, summary="Lead or member (Head)")
    @action(detail=True, methods=["post"])
    def role(self, request, pk=None):
        assignment = self.get_object()
        self.access.require_head(assignment.deliverable.work_order.department_id)
        role = request.data.get("role")
        if role not in ("lead", "member"):
            raise ValidationError({"role": ["lead or member"]})
        deliverables.set_role(request.user, assignment, role)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SubmissionViewSet(Base):
    queryset = Submission.objects.select_related("deliverable__work_order")

    @extend_schema(request=s.ReviewWriteSerializer, responses=None,
                   summary="The single review of a submission: validated, or revision requested")
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        submission = self.get_object()
        serializer = s.ReviewWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submissions.review(self.access, submission, serializer.validated_data)
        return Response(status=status.HTTP_201_CREATED)


# --- Dependencies ---


def links_queryset():
    return DependencyLink.objects.select_related(
        "prerequisite__work_order", "dependent__work_order", "release_milestone", "created_by", "approved_by",
        "manual_release_by",
    )


def blockers_queryset():
    return Blocker.objects.select_related(
        "deliverable__work_order", "work_order", "reported_by", "resolved_by", "resolver", "responsible_unit",
        "validation__validated_by",
    )


class DependencyViewSet(Base, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    serializer_class = s.DependencyLinkSerializer
    detail_serializer = s.DependencyLinkSerializer

    def get_queryset(self):
        return links_queryset()

    @extend_schema(parameters=DEPENDENCY_FILTERS, summary="Dependencies (filters: deliverable, work_order, department, state=waiting|released, all=1)")
    def list(self, request, *args, **kwargs):
        params = request.query_params
        queryset = self.get_queryset()
        if not params.get("all"):
            queryset = queryset.filter(link_status=LinkStatus.ACTIVE)
        deliverable = number(params, "deliverable")
        if deliverable:
            queryset = queryset.filter(Q(prerequisite_id=deliverable) | Q(dependent_id=deliverable))
        work_order = number(params, "work_order")
        if work_order:
            queryset = queryset.filter(Q(prerequisite__work_order_id=work_order) | Q(dependent__work_order_id=work_order))
        department = number(params, "department")
        if department:
            queryset = queryset.filter(Q(prerequisite__work_order__department_id=department)
                                       | Q(dependent__work_order__department_id=department))
        state = params.get("state")
        if state == "waiting":
            queryset = queryset.filter(link_type="blocks", released_at__isnull=True)
        elif state == "released":
            queryset = queryset.filter(link_type="blocks", released_at__isnull=False)
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @extend_schema(request=s.DependencyCreateSerializer, responses=s.DependencyLinkSerializer,
                   summary="A Head of an involved department creates an active link (members: /dependency-proposals/)")
    def create(self, request):
        serializer = s.DependencyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not dependencies.involved_heads(self.access, data["prerequisite"], data["dependent"]):
            raise PermissionDenied("Only a Head of an involved department creates a dependency; propose it instead.")
        link = dependencies.create(request.user, data["prerequisite"], data["dependent"], data["link_type"],
                                   data["release_condition"], data.get("release_milestone"), data["reason"])
        return self.done(link, code=status.HTTP_201_CREATED)

    def involved(self, link):
        if not self.access.heads_any(link.prerequisite.work_order.department_id, link.dependent.work_order.department_id):
            raise PermissionDenied("Only a Head of an involved department may do this.")

    @extend_schema(request=s.WorkReasonSerializer, responses=s.DependencyLinkSerializer, summary="Cancel the link")
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        link = self.get_object()
        self.involved(link)
        return self.done(dependencies.cancel(request.user, link, request.data.get("reason", "")))

    @extend_schema(request=s.WorkReasonSerializer, responses=s.DependencyLinkSerializer,
                   summary="Permanent manual release (Head, reason required, never revoked)")
    @action(detail=True, methods=["post"], url_path="manual-release")
    def manual_release(self, request, pk=None):
        link = self.get_object()
        self.involved(link)
        return self.done(dependencies.manual_release(request.user, link, request.data.get("reason", "")))


class DependencyProposalViewSet(Base, mixins.ListModelMixin):
    serializer_class = s.DependencyProposalSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return DependencyProposal.objects.none()
        queryset = DependencyProposal.objects.select_related(
            "proposed_prerequisite__work_order", "proposed_dependent__work_order", "proposed_by", "decided_by"
        )
        if self.access.is_admin:
            return queryset
        units = self.access.led_unit_ids
        return queryset.filter(
            Q(proposed_by=self.request.user) | Q(proposed_prerequisite__work_order__department_id__in=units)
            | Q(proposed_dependent__work_order__department_id__in=units)
        )

    @extend_schema(parameters=params("status"), summary="Dependency proposals: mine, and those a Head of mine may decide (status=pending_review…)")
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        if request.query_params.get("status"):
            queryset = queryset.filter(status__in=request.query_params["status"].split(","))
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @extend_schema(request=s.DependencyCreateSerializer, responses=s.DependencyProposalSerializer,
                   summary="Propose a dependency (any member); a Head of an involved department decides")
    def create(self, request):
        serializer = s.DependencyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        for deliverable in (data["prerequisite"], data["dependent"]):
            if not self.access.sees_deliverable(deliverable):
                raise PermissionDenied()
        proposal = dependencies.propose(request.user, data["prerequisite"], data["dependent"], data["link_type"],
                                        data["release_condition"], data.get("release_milestone"), data["reason"])
        return Response(self.get_serializer(self.get_queryset().get(pk=proposal.pk)).data, status=status.HTTP_201_CREATED)

    def decide(self, request, approve):
        proposal = self.get_object()
        if not self.access.heads_any(proposal.proposed_prerequisite.work_order.department_id,
                                     proposal.proposed_dependent.work_order.department_id):
            raise PermissionDenied("Only a Head of an involved department decides.")
        dependencies.decide(request.user, proposal, approve, request.data.get("note", ""))
        return Response(self.get_serializer(self.get_queryset().get(pk=proposal.pk)).data)

    @extend_schema(request=s.WorkNoteSerializer, responses=s.DependencyProposalSerializer)
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self.decide(request, True)

    @extend_schema(request=s.WorkNoteSerializer, responses=s.DependencyProposalSerializer)
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self.decide(request, False)


class ReliefViewSet(Base):
    queryset = ReliefInterval.objects.select_related("deliverable__work_order", "dependency_link", "blocker")

    @extend_schema(request=s.ReliefDecisionSerializer, responses=s.ReliefIntervalSerializer,
                   summary="The Head approves the verified period (all or nothing) or rejects the claim")
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        interval = self.get_object()
        self.access.require_head(interval.deliverable.work_order.department_id,
                                 "Only the Head of Department approves deadline relief.")
        serializer = s.ReliefDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["approve"]:
            interval = dependencies.approve_relief(request.user, interval, data["approved_start"], data["approved_end"],
                                                   data["note"])
        else:
            interval = dependencies.reject_relief(request.user, interval, data["note"])
        return Response(s.ReliefIntervalSerializer(interval).data)


# --- Blockers ---


class BlockerViewSet(Base, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    serializer_class = s.WorkBlockerSerializer
    detail_serializer = s.WorkBlockerSerializer

    def get_queryset(self):
        return blockers_queryset()

    @extend_schema(parameters=BLOCKER_FILTERS, summary="Blockers (filters: status, deliverable, work_order, department, mine=1)")
    def list(self, request, *args, **kwargs):
        params = request.query_params
        queryset = self.get_queryset()
        if params.get("status"):
            queryset = queryset.filter(status__in=params["status"].split(","))
        for name, field in (("deliverable", "deliverable_id"), ("work_order", "work_order_id"),
                            ("department", "work_order__department_id")):
            value = number(params, name)
            if value:
                queryset = queryset.filter(**{field: value})
        if params.get("mine"):
            queryset = queryset.filter(
                Q(reported_by=request.user) | Q(resolver=request.user)
                | Q(deliverable__assignments__member=request.user, deliverable__assignments__is_active=True)
            ).distinct()
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @extend_schema(request=s.WorkBlockerWriteSerializer, responses=s.WorkBlockerSerializer, summary="Report a blocker (anybody)")
    def create(self, request):
        serializer = s.WorkBlockerWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = {key: value for key, value in serializer.validated_data.items() if value is not None}
        target = data.get("deliverable") or data.get("work_order")
        visible = self.access.sees_deliverable(target) if data.get("deliverable") else self.access.sees_work_order(target)
        if not visible:
            raise PermissionDenied()
        return self.done(blockers.report(request.user, data), code=status.HTTP_201_CREATED)

    def department(self, blocker):
        return (blocker.deliverable.work_order if blocker.deliverable_id else blocker.work_order).department_id

    @extend_schema(request=s.WorkBlockerUpdateSerializer, responses=s.WorkBlockerSerializer)
    def partial_update(self, request, pk=None):
        blocker = self.get_object()
        head = self.access.heads(self.department(blocker))
        if not (head or blocker.reported_by_id == request.user.pk):
            raise PermissionDenied()
        serializer = s.WorkBlockerUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        if not head and set(data) - {"description", "required_action", "severity", "impact", "origin"}:
            raise PermissionDenied("Only the Head assigns the resolver and the responsible unit.")
        return self.done(blockers.update(request.user, blocker, data))

    @extend_schema(request=s.WorkNoteSerializer, responses=s.WorkBlockerSerializer, summary="Resolve (terminal; note required)")
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        blocker = self.get_object()
        if not (self.access.heads(self.department(blocker)) or blocker.resolver_id == request.user.pk):
            raise PermissionDenied("Only its resolver or the Head resolves it.")
        return self.done(blockers.resolve(request.user, blocker, request.data.get("note", "")))

    @extend_schema(request=s.WorkReasonSerializer, responses=s.WorkBlockerSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        blocker = self.get_object()
        if not (self.access.heads(self.department(blocker)) or blocker.reported_by_id == request.user.pk):
            raise PermissionDenied()
        return self.done(blockers.cancel(request.user, blocker, request.data.get("reason", "")))

    @extend_schema(request=s.ImpactSerializer, responses=s.WorkBlockerSerializer,
                   summary="The Head validates the blocker's real impact on delivery (before any relief)")
    @action(detail=True, methods=["post"], url_path="validate-impact")
    def validate_impact(self, request, pk=None):
        blocker = self.get_object()
        self.access.require_head(self.department(blocker))
        serializer = s.ImpactSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        blockers.validate_impact(request.user, blocker, data["impact_confirmed"], data["impact_note"])
        return self.done(blocker)


# --- Proposals inbox, dashboard, reports, search ---


class ProposalsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="Proposals: those awaiting my decision (Heads) and mine")
    def get(self, request):
        access = access_for(request)
        context = {"request": request}
        pending = ProposalStatus.PENDING_REVIEW
        work_order_qs = WorkOrder.objects.select_related("department", "project", "proposed_by", "season").prefetch_related(
            "deliverables"
        )
        deliverable_qs = Deliverable.objects.select_related(*DELIVERABLE_LIST).prefetch_related(ASSIGNMENTS)
        to_decide_wo = work_order_qs.filter(proposal_status=pending).exclude(proposed_by=request.user)
        to_decide_del = deliverable_qs.filter(proposal_status=pending).exclude(proposed_by=request.user)
        to_decide_dep = DependencyProposal.objects.filter(status=pending).exclude(proposed_by=request.user)
        if not access.is_admin:
            units = access.led_unit_ids
            to_decide_wo = to_decide_wo.filter(department_id__in=units)
            to_decide_del = to_decide_del.filter(work_order__department_id__in=units)
            to_decide_dep = to_decide_dep.filter(Q(proposed_prerequisite__work_order__department_id__in=units)
                                                 | Q(proposed_dependent__work_order__department_id__in=units))
        to_decide_dep = to_decide_dep.select_related("proposed_prerequisite__work_order", "proposed_dependent__work_order",
                                                     "proposed_by")
        mine_dep = DependencyProposal.objects.filter(proposed_by=request.user).select_related(
            "proposed_prerequisite__work_order", "proposed_dependent__work_order", "proposed_by", "decided_by"
        )[:50]
        return Response({
            "to_decide": {
                "work_orders": s.WorkOrderSerializer(to_decide_wo, many=True, context=context).data,
                "deliverables": s.DeliverableSerializer(to_decide_del, many=True, context=context).data,
                "dependencies": s.DependencyProposalSerializer(to_decide_dep, many=True, context=context).data,
            },
            "mine": {
                "work_orders": s.WorkOrderSerializer(
                    work_order_qs.filter(proposed_by=request.user).order_by("-created_at")[:50], many=True, context=context
                ).data,
                "deliverables": s.DeliverableSerializer(
                    deliverable_qs.filter(proposed_by=request.user).order_by("-created_at")[:50], many=True, context=context
                ).data,
                "dependencies": s.DependencyProposalSerializer(mine_dep, many=True, context=context).data,
            },
        })


def open_deliverables(queryset):
    return queryset.exclude(status__in=(DeliverableStatus.CANCELLED, DeliverableStatus.VALIDATED)).exclude(
        proposal_status__in=NOT_OFFICIAL
    )


class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="My work, and for a Head the department's decisions and risks (guide §5)")
    def get(self, request):
        access = access_for(request)
        context = {"request": request}
        today = timezone.localdate()
        soon = today + timedelta(days=7)
        mine = open_deliverables(
            Deliverable.objects.filter(assignments__member=request.user, assignments__is_active=True)
        ).select_related(*DELIVERABLE_LIST).prefetch_related(ASSIGNMENTS).distinct().order_by("original_deadline", "pk")
        mine = list(mine)

        def deadline(item):
            return item.effective_deadline or item.original_deadline

        member = {
            "cards": {
                "active": len(mine),
                "due_soon": sum(1 for item in mine if deadline(item) and today <= deadline(item) <= soon),
                "overdue": sum(1 for item in mine if deadline(item) and deadline(item) < today
                               and item.status != DeliverableStatus.SUBMITTED),
                "waiting": sum(1 for item in mine if item.dep_state == DependencyState.WAITING),
                "revision_requested": sum(1 for item in mine if item.status == DeliverableStatus.REVISION_REQUESTED),
                "blockers": Blocker.objects.filter(status=BlockerStatus.OPEN).filter(
                    Q(reported_by=request.user) | Q(deliverable__in=[item.pk for item in mine])
                ).distinct().count(),
                "validated": Deliverable.objects.filter(
                    assignments__member=request.user, status=DeliverableStatus.VALIDATED
                ).distinct().count(),
            },
            "deliverables": s.DeliverableSerializer(mine, many=True, context=context).data,
            "recent": s.ActivitySerializer(
                visible_activity(access, ActivityLog.objects.filter(deliverable__in=[item.pk for item in mine]))
                .select_related("actor", "work_order")[:15], many=True, context=context,
            ).data,
        }
        result = {"member": member, "head": None}
        if access.is_head:
            scope = Q() if access.is_admin else Q(work_order__department_id__in=access.led_unit_ids)
            wo_scope = Q() if access.is_admin else Q(department_id__in=access.led_unit_ids)
            department = number(request.query_params, "department")
            if department:
                access.require_head(department)
                scope, wo_scope = Q(work_order__department_id=department), Q(department_id=department)
            deliverables_ = open_deliverables(Deliverable.objects.filter(scope)).select_related(*DELIVERABLE_LIST)
            deliverables_ = list(deliverables_.prefetch_related(ASSIGNMENTS))
            workload = Counter()
            for item in deliverables_:
                for assignment in item.assignments.all():
                    if assignment.is_active:
                        workload[(assignment.member_id, str(assignment.member))] += 1
            pending = ProposalStatus.PENDING_REVIEW
            result["head"] = {
                "cards": {
                    "active_work_orders": WorkOrder.objects.filter(wo_scope, status__in=(
                        WorkOrderStatus.ACTIVE, WorkOrderStatus.IN_PROGRESS)).count(),
                    "active_deliverables": len(deliverables_),
                    "wo_proposals": WorkOrder.objects.filter(wo_scope, proposal_status=pending).exclude(
                        proposed_by=request.user).count(),
                    "deliverable_proposals": Deliverable.objects.filter(scope, proposal_status=pending).exclude(
                        proposed_by=request.user).count(),
                    "to_review": sum(1 for item in deliverables_ if item.status == DeliverableStatus.SUBMITTED),
                    "open_blockers": Blocker.objects.filter(status=BlockerStatus.OPEN).filter(
                        Q(work_order__in=WorkOrder.objects.filter(wo_scope))).count(),
                    "relief_claims": ReliefInterval.objects.filter(
                        status="claimed", deliverable__in=Deliverable.objects.filter(scope)).count(),
                    "attention": sum(1 for item in deliverables_ if (
                        deadline(item) and deadline(item) < today and item.status != DeliverableStatus.SUBMITTED
                    ) or item.execution_state == "fully_blocked"),
                },
                "to_review": s.DeliverableSerializer(
                    [item for item in deliverables_ if item.status == DeliverableStatus.SUBMITTED], many=True,
                    context=context,
                ).data,
                "attention": s.DeliverableSerializer(
                    [item for item in deliverables_ if (deadline(item) and deadline(item) < today
                                                        and item.status != DeliverableStatus.SUBMITTED)
                     or item.execution_state == "fully_blocked"][:20], many=True, context=context,
                ).data,
                "workload": [
                    {"member_id": member_id, "name": name, "open_deliverables": count}
                    for (member_id, name), count in workload.most_common()
                ],
                "high_blockers": s.WorkBlockerSerializer(
                    blockers_queryset().filter(status=BlockerStatus.OPEN, severity__in=("high", "critical")).filter(
                        Q(work_order__in=WorkOrder.objects.filter(wo_scope)))[:10], many=True, context=context,
                ).data,
            }
        return Response(result)


class ReportView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="Operational report: progress by level, counts, overdue work, workload. No scoring.")
    def get(self, request):
        access = access_for(request)
        params = request.query_params
        work_orders_ = progress.official_work_orders().select_related("department", "project")
        for name in ("season", "department", "project"):
            value = number(params, name)
            if value:
                work_orders_ = work_orders_.filter(**{f"{name}_id": value})
        work_orders_ = list(work_orders_.prefetch_related(Prefetch("deliverables", queryset=Deliverable.objects.prefetch_related(ASSIGNMENTS))))
        today = timezone.localdate()
        departments = {}
        for work_order in work_orders_:
            departments.setdefault(work_order.department, []).append(work_order)
        deliverables_ = [item for wo in work_orders_ for item in wo.deliverables.all() if item.is_active]
        workload = Counter()
        for item in deliverables_:
            if item.status in (DeliverableStatus.VALIDATED, DeliverableStatus.CANCELLED):
                continue
            for assignment in item.assignments.all():
                if assignment.is_active:
                    workload[(assignment.member_id, str(assignment.member))] += 1
        overdue = [
            item for item in deliverables_
            if item.status not in (DeliverableStatus.VALIDATED, DeliverableStatus.SUBMITTED)
            and (item.effective_deadline or item.original_deadline)
            and (item.effective_deadline or item.original_deadline) < today
        ]
        context = {"request": request}
        return Response({
            "work_orders_by_status": Counter(wo.status for wo in work_orders_),
            "deliverables_by_status": Counter(item.status for item in deliverables_),
            "departments": [
                {**OrgUnitSummarySerializer(unit).data, "progress": as_float(progress.department_progress(items)),
                 "work_orders": len(items)}
                for unit, items in sorted(departments.items(), key=lambda pair: pair[0].name)
            ],
            "work_orders": [
                {"id": wo.pk, "code": wo.code, "title": wo.title, "status": wo.status, "department": wo.department.name,
                 "progress": as_float(progress.work_order_progress(wo)),
                 # Absent, not null, for whoever does not see the budget (guide §2.1).
                 **({"budget_tier": wo.budget_tier} if access.sees_budget(wo.department_id) else {})}
                for wo in work_orders_
            ],
            "overdue": s.DeliverableSerializer(
                Deliverable.objects.filter(pk__in=[item.pk for item in overdue]).select_related(*DELIVERABLE_LIST)
                .prefetch_related(ASSIGNMENTS), many=True, context=context,
            ).data,
            "waiting": DependencyLink.objects.filter(
                link_status=LinkStatus.ACTIVE, link_type="blocks", released_at__isnull=True,
                dependent__in=[item.pk for item in deliverables_],
            ).count(),
            "workload": [
                {"member_id": member_id, "name": name, "open_deliverables": count}
                for (member_id, name), count in workload.most_common()
            ],
        })


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="Search the accessible Work Orders, Deliverables, Milestones and blockers")
    def get(self, request):
        access = access_for(request)
        words = (request.query_params.get("q") or "").strip()
        if len(words) < 2:
            return Response({"work_orders": [], "deliverables": [], "milestones": [], "blockers": []})
        work_orders_ = access.visible_work_orders(WorkOrder.objects.filter(Q(title__icontains=words) | Q(code__icontains=words)))
        deliverables_ = access.visible_deliverables(
            Deliverable.objects.filter(Q(title__icontains=words) | Q(code__icontains=words)).select_related("work_order")
        )
        milestones = Milestone.objects.filter(title__icontains=words, is_cancelled=False).select_related("deliverable__work_order")
        found_blockers = Blocker.objects.filter(description__icontains=words).select_related("deliverable", "work_order")
        return Response({
            "work_orders": [{"id": wo.pk, "code": wo.code, "title": wo.title, "status": wo.status} for wo in work_orders_[:10]],
            "deliverables": [{"id": d.pk, "code": d.code, "title": d.title, "status": d.status} for d in deliverables_[:10]],
            "milestones": [
                {"id": m.pk, "title": m.title, "deliverable": m.deliverable_id, "is_completed": m.is_completed}
                for m in milestones[:10] if access.sees_deliverable(m.deliverable)
            ],
            "blockers": [
                {"id": b.pk, "description": b.description[:120], "status": b.status,
                 "deliverable": b.deliverable_id, "work_order": b.work_order_id}
                for b in found_blockers[:10]
            ],
        })
