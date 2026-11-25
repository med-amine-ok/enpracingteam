"""The confidential scoring API, under /api/scoring/ (guide §13–14, plan §3.3).

Everything, the quality inputs included, belongs to the club admins only (decision of 25/11/2026: the Heads review
the work but do not enter ranking data).
Whoever may not see an endpoint gets 404, as if it did not exist (plan §4.4)."""

from decimal import Decimal

from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, extend_schema_field
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from apps.members.serializers import MemberSummarySerializer

from .access import access_for, hidden
from .models import (
    CalculationRun, Deliverable, DeliverableStatus, FormulaVersion, QualityDataStatus, RankingAuditLog, ScoreSnapshot,
    Season,
)
from .services import scoring
from .services.common import refuse
from .services.submissions import set_quality


class ScoringAdmin(BasePermission):
    def has_permission(self, request, view):
        if not access_for(request).is_scoring_admin:
            raise hidden()
        return True


# --- Serializers (scoring data: never used by the operational API) ---


class FormulaVersionSerializer(serializers.ModelSerializer):
    created_by = MemberSummarySerializer(read_only=True)
    reason = serializers.CharField(write_only=True)

    class Meta:
        model = FormulaVersion
        exclude = []
        read_only_fields = ["created_at", "created_by"]

    def validate(self, attrs):
        weights = sum(attrs.get(name, Decimal("0")) for name in (
            "weight_effort", "weight_complexity", "weight_uncertainty", "weight_responsibility"))
        if weights != Decimal("1"):
            raise serializers.ValidationError({"weight_effort": ["The four rubric weights must total 1."]})
        return attrs


class RunSerializer(serializers.ModelSerializer):
    formula_version = serializers.SlugRelatedField(slug_field="code", read_only=True)
    triggered_by = MemberSummarySerializer(read_only=True)
    published_by = MemberSummarySerializer(read_only=True)
    season_label = serializers.CharField(source="season.label", read_only=True)

    class Meta:
        model = CalculationRun
        fields = [
            "id", "season", "season_label", "formula_version", "triggered_by", "triggered_at", "completed_at",
            "status", "records_processed", "warnings_count", "errors_count", "issues", "notes", "is_published",
            "published_at", "published_by",
        ]


class ScoreSnapshotSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    deliverable = serializers.SerializerMethodField()
    formula_version = serializers.SlugRelatedField(slug_field="code", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default="")

    class Meta:
        model = ScoreSnapshot
        fields = [
            "id", "member", "deliverable", "department", "department_name", "formula_version", "calculation_run",
            "budget_tier", "weight", "allocated_points", "raw_quality", "quality_factor", "time_factor",
            "revision_penalty", "revision_rounds", "delay_ratio", "effective_deadline", "first_submission_at",
            "member_count", "earned_points", "is_superseded", "superseded_by", "superseded_reason", "created_at",
        ]

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_deliverable(self, snapshot):
        deliverable = snapshot.deliverable
        return {"id": deliverable.pk, "code": deliverable.code, "title": deliverable.title,
                "work_order": {"id": deliverable.work_order_id, "code": deliverable.work_order.code,
                               "title": deliverable.work_order.title}}


class AuditSerializer(serializers.ModelSerializer):
    actor = MemberSummarySerializer(read_only=True)

    class Meta:
        model = RankingAuditLog
        fields = ["id", "action", "entity_type", "entity_id", "actor", "old_value", "new_value", "reason", "occurred_at"]


class QualityWriteSerializer(serializers.Serializer):
    raw_quality = serializers.DecimalField(max_digits=3, decimal_places=1, min_value=0, max_value=5, allow_null=True,
                                           required=False)
    data_status = serializers.ChoiceField(choices=QualityDataStatus.choices)
    note = serializers.CharField(required=False, allow_blank=True, default="")
    reason = serializers.CharField(required=False, allow_blank=True, default="")


def season_of(request):
    value = request.query_params.get("season")
    if value:
        return get_object_or_404(Season, pk=value) if str(value).isdigit() else refuse("A season id is expected.")
    season = Season.objects.filter(is_active=True).first()
    if season is None:
        refuse("No current season.")
    return season


# --- The Heads' ranking data management ---


class QualityInputViewSet(viewsets.GenericViewSet):
    """The quality marks of the submitted and validated Deliverables, entered by the club admins."""

    permission_classes = [ScoringAdmin]
    pagination_class = None
    queryset = Deliverable.objects.all()
    serializer_class = QualityWriteSerializer

    def scope(self, request):
        queryset = Deliverable.objects.filter(
            status__in=(DeliverableStatus.VALIDATED, DeliverableStatus.SUBMITTED, DeliverableStatus.REVISION_REQUESTED)
        ).select_related("work_order__department", "work_order__season", "first_complete").prefetch_related(
            "assignments__member", "submissions__review__revision"
        )
        return queryset

    def row(self, deliverable):
        from .models import QualityInput

        quality = QualityInput.objects.filter(deliverable=deliverable).select_related("entered_by").first()
        rounds = [
            {"number": item.submission_number, "complete": item.is_complete, "submitted_at": item.submitted_at,
             "decision": item.review.decision if hasattr(item, "review") else None,
             "severity": item.review.revision.severity if hasattr(item, "review") and hasattr(item.review, "revision") else None,
             "attributable": item.review.revision.is_attributable
             if hasattr(item, "review") and hasattr(item.review, "revision") else None}
            for item in deliverable.submissions.all()
        ]
        first = getattr(deliverable, "first_complete", None)
        return {
            "deliverable": {"id": deliverable.pk, "code": deliverable.code, "title": deliverable.title,
                            "status": deliverable.status, "acceptance_criteria": deliverable.acceptance_criteria},
            "work_order": {"id": deliverable.work_order_id, "code": deliverable.work_order.code,
                           "title": deliverable.work_order.title},
            "department": {"id": deliverable.work_order.department_id, "name": deliverable.work_order.department.name},
            "season": deliverable.work_order.season_id,
            "members": MemberSummarySerializer(
                [a.member for a in deliverable.assignments.all() if a.is_active], many=True
            ).data,
            "first_complete_submission_at": first.first_submitted_at if first else None,
            "rounds": rounds,
            "raw_quality": str(quality.raw_quality) if quality and quality.raw_quality is not None else None,
            "data_status": quality.data_status if quality else QualityDataStatus.INCOMPLETE,
            "note": quality.note if quality else "",
            "last_modified_at": quality.last_modified_at if quality else None,
            "entered_by": MemberSummarySerializer(quality.entered_by).data if quality and quality.entered_by else None,
        }

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="Quality inputs to enter or confirm (season, department, status filters)")
    def list(self, request):
        queryset = self.scope(request)
        season = request.query_params.get("season")
        if season and season.isdigit():
            queryset = queryset.filter(work_order__season_id=season)
        department = request.query_params.get("department")
        if department and department.isdigit():
            queryset = queryset.filter(work_order__department_id=department)
        rows = [self.row(item) for item in queryset.order_by("work_order__department__name", "code")]
        wanted = request.query_params.get("data_status")
        if wanted:
            rows = [row for row in rows if row["data_status"] in wanted.split(",")]
        return Response(rows)

    @extend_schema(request=QualityWriteSerializer, responses=OpenApiTypes.OBJECT, summary="Save, confirm or flag a quality input")
    def update(self, request, pk=None):
        deliverable = get_object_or_404(self.scope(request), pk=pk)
        serializer = QualityWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if deliverable.status != DeliverableStatus.VALIDATED:
            refuse("The quality mark is entered once the Deliverable is validated.")
        set_quality(request.user, deliverable, data.get("raw_quality"), data["data_status"], data["note"], data["reason"])
        return Response(self.row(deliverable))

    @extend_schema(responses=AuditSerializer(many=True), summary="The changes of a quality input")
    @action(detail=True)
    def history(self, request, pk=None):
        deliverable = get_object_or_404(self.scope(request), pk=pk)
        rows = RankingAuditLog.objects.filter(entity_type="deliverable", entity_id=deliverable.pk).select_related("actor")
        return Response(AuditSerializer(rows, many=True).data)


# --- The scoring admins' workspace ---


class FormulaVersionViewSet(viewsets.GenericViewSet):
    permission_classes = [ScoringAdmin]
    pagination_class = None
    queryset = FormulaVersion.objects.all()
    serializer_class = FormulaVersionSerializer

    @extend_schema(responses=FormulaVersionSerializer(many=True))

    def list(self, request):
        return Response(FormulaVersionSerializer(FormulaVersion.objects.select_related("created_by"), many=True).data)

    @extend_schema(request=FormulaVersionSerializer, responses=FormulaVersionSerializer, summary="A new formula version (configuration admins)")
    def create(self, request):
        if not access_for(request).is_scoring_config_admin:
            raise hidden()
        serializer = FormulaVersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        reason = data.pop("reason")
        formula = scoring.new_formula(request.user, data, reason)
        return Response(FormulaVersionSerializer(formula).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=FormulaVersionSerializer, summary="Make this version the current one (configuration admins)")
    @action(detail=True, methods=["post"], url_path="set-current")
    def set_current(self, request, pk=None):
        if not access_for(request).is_scoring_config_admin:
            raise hidden()
        formula = get_object_or_404(FormulaVersion, pk=pk)
        reason = (request.data.get("reason") or "").strip() or refuse("Give the reason.", "reason")
        return Response(FormulaVersionSerializer(scoring.set_current(request.user, formula, reason)).data)


class RunViewSet(viewsets.GenericViewSet):
    permission_classes = [ScoringAdmin]
    pagination_class = None
    queryset = CalculationRun.objects.all()
    serializer_class = RunSerializer

    @extend_schema(responses=RunSerializer(many=True))

    def list(self, request):
        runs = CalculationRun.objects.select_related("formula_version", "triggered_by", "published_by", "season")
        season = request.query_params.get("season")
        if season and season.isdigit():
            runs = runs.filter(season_id=season)
        return Response(RunSerializer(runs[:100], many=True).data)

    @extend_schema(responses=RunSerializer)
    def retrieve(self, request, pk=None):
        run = get_object_or_404(CalculationRun.objects.select_related("formula_version", "season"), pk=pk)
        return Response(RunSerializer(run).data)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=RunSerializer, summary="Run a calculation for a season (publication admins)")
    def create(self, request):
        if not access_for(request).is_scoring_publish_admin:
            raise hidden()
        season = get_object_or_404(Season, pk=request.data.get("season") or 0)
        formula = None
        if request.data.get("formula_version"):
            formula = get_object_or_404(FormulaVersion, pk=request.data["formula_version"])
        run = scoring.run(request.user, season, formula, request.data.get("notes", ""))
        return Response(RunSerializer(run).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=RunSerializer, summary="Publish (finalise) a completed calculation (publication admins)")
    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        if not access_for(request).is_scoring_publish_admin:
            raise hidden()
        run = get_object_or_404(CalculationRun, pk=pk)
        return Response(RunSerializer(scoring.publish(request.user, run, request.data.get("reason", ""))).data)

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="Members' and departments' rankings in this run (department filter)")
    @action(detail=True)
    def rankings(self, request, pk=None):
        run = get_object_or_404(CalculationRun, pk=pk)
        department = request.query_params.get("department")
        members, departments = scoring.run_rankings(run, int(department) if department and department.isdigit() else None)
        for row in members + departments:
            row["total"] = str(row["total"])
        return Response({"run": RunSerializer(run).data, "members": members, "departments": departments})


class ScoreViewSet(viewsets.GenericViewSet):
    permission_classes = [ScoringAdmin]
    pagination_class = None
    queryset = ScoreSnapshot.objects.all()
    serializer_class = ScoreSnapshotSerializer

    def snapshots(self):
        return ScoreSnapshot.objects.select_related(
            "member", "deliverable__work_order", "department", "formula_version"
        )

    @extend_schema(responses=ScoreSnapshotSerializer(many=True), summary="Score snapshots (run, member, deliverable, department, current=1)")
    def list(self, request):
        queryset = self.snapshots()
        for name in ("calculation_run", "member", "deliverable", "department"):
            value = request.query_params.get(name)
            if value and value.isdigit():
                queryset = queryset.filter(**{f"{name}_id": value})
        if request.query_params.get("current"):
            queryset = queryset.filter(is_superseded=False)
        return Response(ScoreSnapshotSerializer(queryset[:500], many=True).data)

    @extend_schema(responses=ScoreSnapshotSerializer)
    def retrieve(self, request, pk=None):
        return Response(ScoreSnapshotSerializer(get_object_or_404(self.snapshots(), pk=pk)).data)

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="A member's score in a run, traced to every Deliverable (guide §14.2)")
    @action(detail=False, url_path=r"member/(?P<member_id>\d+)")
    def member(self, request, member_id=None):
        run_id = request.query_params.get("run")
        queryset = self.snapshots().filter(member_id=member_id)
        if run_id and run_id.isdigit():
            queryset = queryset.filter(calculation_run_id=run_id)
        else:
            queryset = queryset.filter(is_superseded=False)
        rows = ScoreSnapshotSerializer(queryset, many=True).data
        total = sum((Decimal(row["earned_points"]) for row in rows), Decimal("0"))
        history = ScoreSnapshot.objects.filter(member_id=member_id).exclude(pk__in=[row["id"] for row in rows])
        return Response({"member_id": int(member_id), "total": str(total), "scores": rows,
                         "earlier": ScoreSnapshotSerializer(history.select_related(
                             "member", "deliverable__work_order", "department", "formula_version")[:200], many=True).data})


class ScoringDashboardView(viewsets.GenericViewSet):
    permission_classes = [ScoringAdmin]
    pagination_class = None
    queryset = CalculationRun.objects.none()

    @extend_schema(responses=OpenApiTypes.OBJECT, operation_id="scoring_dashboard", summary="The scoring process for a season: completeness, latest run, publication")
    def list(self, request):
        season = season_of(request)
        issues = scoring.validation_issues(season)
        deliverables = scoring.season_deliverables(season)
        latest = CalculationRun.objects.filter(season=season).select_related("formula_version", "season").first()
        published = CalculationRun.objects.filter(season=season, is_published=True).first()
        validated = deliverables.filter(status=DeliverableStatus.VALIDATED).count()
        complete = deliverables.filter(
            status=DeliverableStatus.VALIDATED,
            quality_input__data_status__in=(QualityDataStatus.COMPLETE, QualityDataStatus.SUBMITTED),
        ).count()
        return Response({
            "season": {"id": season.pk, "label": season.label, "scoring_cutoff_at": season.scoring_cutoff_at},
            "deliverables": deliverables.count(),
            "validated": validated,
            "quality_complete": complete,
            "departments": deliverables.values("work_order__department").distinct().count(),
            "members": ScoreSnapshot.objects.filter(calculation_run=latest).values("member").distinct().count()
            if latest else 0,
            "issues": issues,
            "latest_run": RunSerializer(latest).data if latest else None,
            "published_run": RunSerializer(published).data if published else None,
            "current_formula": FormulaVersion.objects.filter(is_current=True).values_list("code", flat=True).first(),
            "recent": AuditSerializer(RankingAuditLog.objects.select_related("actor")[:10], many=True).data,
        })

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="Missing or inconsistent scoring inputs for a season (guide screen 29)")
    @action(detail=False)
    def validation(self, request):
        return Response(scoring.validation_issues(season_of(request)))


class AuditViewSet(viewsets.GenericViewSet):
    permission_classes = [ScoringAdmin]
    pagination_class = None
    queryset = RankingAuditLog.objects.all()
    serializer_class = AuditSerializer

    @extend_schema(responses=AuditSerializer(many=True), summary="The scoring audit log (action, entity_type, entity_id, actor filters)")
    def list(self, request):
        rows = RankingAuditLog.objects.select_related("actor")
        params = request.query_params
        for name in ("action", "entity_type"):
            if params.get(name):
                rows = rows.filter(**{name: params[name]})
        for name in ("entity_id", "actor"):
            value = params.get(name)
            if value and value.isdigit():
                rows = rows.filter(**{f"{name}_id" if name == "actor" else name: value})
        if params.get("search"):
            rows = rows.filter(Q(reason__icontains=params["search"]) | Q(action__icontains=params["search"]))
        return Response(AuditSerializer(rows[:300], many=True).data)
