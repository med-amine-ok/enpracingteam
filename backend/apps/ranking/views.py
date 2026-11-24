"""
The monthly ranking API (decision D-017, knowledge base: PROJECTS/ERP/ranking_design.md). The scores are computed
on demand (scoring.py); who sees and does what: access.py; the changes: workflow.py.
"""

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.members.models import Member

from . import scoring, workflow
from .access import ranking_access_for
from .models import ContributionPoint, ContributionStatus, MonthlyAssessment, MonthlyScore, RankingPublication
from .serializers import (
    AssessmentWriteSerializer, ContributionCreateSerializer, ContributionSerializer, MemberMonthSerializer,
    MonthTableSerializer, MyRankingSerializer, RankingRightsSerializer, RejectSerializer,
)

MONTH_PATH = OpenApiParameter("month", str, OpenApiParameter.PATH, description="YYYY-MM")
MONTH_QUERY = OpenApiParameter("month", str, description="YYYY-MM; the current month by default.")
MEMBER = OpenApiParameter("member_id", int, OpenApiParameter.PATH)
POINT = OpenApiParameter("id", int, OpenApiParameter.PATH)
SCORE_FIELDS = (
    "delivery", "performance", "load", "presence", "reliability", "team", "final", "ranking_score", "category", "rank",
)


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def month_from(text):
    try:
        month = scoring.parse_month(text)
        if not 2000 <= month.first.year <= 2100:  # 9999-12 would overflow the dates computed from it
            raise ValueError(text)
        return month
    except (ValueError, TypeError, OverflowError) as wrong:
        raise ValidationError({"month": [_("A month is written YYYY-MM.")]}) from wrong


def requested_month(request):
    text = request.query_params.get("month")
    return month_from(text) if text else scoring.month_of(timezone.localdate())


def is_published(month):
    return RankingPublication.objects.filter(month=month.first).exists()


def score_of(row, month, published):
    return {
        "month": month.key, **{name: row[name] for name in SCORE_FIELDS},
        "provisional": row["provisional"] or not published, "details": row["result"].details(),
    }


def member_month(request, member, month):
    row = scoring.member_row(month, member.pk)
    if row is None:
        raise NotFound(_("This member is not in the ranking: no membership in progress."))
    access = ranking_access_for(request)
    published = is_published(month)
    contributions = ContributionPoint.objects.filter(
        member=member, occurred_on__gte=month.first, occurred_on__lte=month.last
    ).select_related("member", "proposed_by", "decided_by")
    data = {
        "member": member, "department": row["department"], "month": month.key, "published": published,
        "score": score_of(row, month, published),
        "assessment": MonthlyAssessment.objects.filter(member=member, month=month.first)
        .select_related("assessed_by").first(),
        "contributions": contributions,
        "permissions": {"assess": access.can_assess(member)},
    }
    return MemberMonthSerializer(data, context={"request": request}).data


class RankingViewSet(viewsets.ViewSet):
    @extend_schema(summary="What the viewer may see and do in the ranking", responses=RankingRightsSerializer)
    @action(detail=False, methods=["get"])
    def rights(self, request):
        access = ranking_access_for(request)
        return Response(RankingRightsSerializer({"team": access.sees_a_team(), "publish": access.can_publish()}).data)

    @extend_schema(summary="The viewer's score of a month (provisional until published) and published history",
                   parameters=[MONTH_QUERY], responses=MyRankingSerializer)
    @action(detail=False, methods=["get"])
    def me(self, request):
        month = requested_month(request)
        row = scoring.member_row(month, request.user.pk)
        if row is None:
            raise NotFound(_("You are not in the ranking: no membership in progress."))
        published = is_published(month)
        history = [
            {
                "month": score.publication.month.strftime("%Y-%m"), "delivery": score.delivery,
                "presence": score.presence, "reliability": score.reliability, "team": score.team,
                "final": score.final, "provisional": score.provisional, "ranking_score": score.ranking_score,
                "category": score.category, "rank": score.rank, "published_at": score.publication.published_at,
            }
            for score in MonthlyScore.objects.filter(member=request.user).select_related("publication")
            .order_by("-publication__month")
        ]
        data = {"month": month.key, "published": published, "score": score_of(row, month, published),
                "history": history}
        return Response(MyRankingSerializer(data).data)

    @extend_schema(summary="A month's table: the members the viewer sees, with their parts, rank and category",
                   parameters=[MONTH_PATH], responses=MonthTableSerializer)
    @action(detail=False, methods=["get"], url_path=r"months/(?P<month>\d{4}-\d{2})")
    def month(self, request, month=None):
        return Response(self.table(request, month_from(month)))

    def table(self, request, month):
        access = ranking_access_for(request)
        require(access.sees_a_team(), _("Only the department heads, the Board, the Team Manager and the Bureau's positions see a team's table."))
        publication = RankingPublication.objects.filter(month=month.first).select_related("published_by").first()
        rows = scoring.month_rows(month, access.scope())
        current = scoring.month_of(timezone.localdate())
        data = {
            "month": month.key,
            "published_at": publication.published_at if publication else None,
            "published_by": publication.published_by if publication else None,
            "rows": [{**row, "provisional": row["provisional"] or publication is None} for row in rows],
            "permissions": {"publish": access.can_publish() and month.first < current.first},
        }
        return MonthTableSerializer(data).data

    @extend_schema(summary="Publish a month once it is over (the Team Manager): the members with a score are told",
                   parameters=[MONTH_PATH], request=None, responses=MonthTableSerializer)
    @action(detail=False, methods=["post"], url_path=r"months/(?P<month>\d{4}-\d{2})/publish")
    def publish(self, request, month=None):
        month = month_from(month)
        require(ranking_access_for(request).can_publish(), _("Only the Team Manager publishes the ranking."))
        workflow.publish(month, request.user)
        return Response(self.table(request, month))

    @extend_schema(summary="A member's month: score, details, the department head's marks, contribution points",
                   parameters=[MEMBER, MONTH_QUERY], responses=MemberMonthSerializer)
    @action(detail=False, methods=["get"], url_path=r"members/(?P<member_id>\d+)")
    def member(self, request, member_id=None):
        member = get_object_or_404(Member, pk=member_id)
        require(ranking_access_for(request).can_see(member), _("Only the member, their department heads and the "
                                                               "Team Manager see this score."))
        return Response(member_month(request, member, requested_month(request)))

    @extend_schema(summary="Give or correct a member's marks of a month (their department head, the Team Manager)",
                   parameters=[MEMBER], request=AssessmentWriteSerializer, responses=MemberMonthSerializer)
    @action(detail=False, methods=["put"], url_path=r"members/(?P<member_id>\d+)/assessment")
    def assessment(self, request, member_id=None):
        member = get_object_or_404(Member, pk=member_id)
        require(ranking_access_for(request).can_assess(member),
                _("Only the member's department heads and the Team Manager assess them, never themself."))
        serializer = AssessmentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        month = month_from(data.pop("month"))
        with transaction.atomic():
            workflow.save_assessment(member, month, data, request.user)
        return Response(member_month(request, member, month))


@extend_schema_view(
    list=extend_schema(
        summary="The contribution points the viewer sees: theirs, those they proposed, those they decide",
        parameters=[
            OpenApiParameter("status", enum=ContributionStatus.values),
            OpenApiParameter("member", int),
            OpenApiParameter("month", str, description="YYYY-MM"),
        ],
    ),
    create=extend_schema(summary="Propose contribution points (validated at once when entered by who decides them)",
                         request=ContributionCreateSerializer, responses={201: ContributionSerializer}),
)
class ContributionViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = ContributionSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        access = ranking_access_for(self.request)
        points = ContributionPoint.objects.select_related("member", "proposed_by", "decided_by")
        viewer = self.request.user
        if not access.sees_team():
            points = points.filter(
                Q(member=viewer) | Q(proposed_by=viewer) | Q(member_id__in=access.led_member_ids() - {viewer.pk})
            )
        params = self.request.query_params
        if params.get("status"):
            points = points.filter(status=params["status"])
        if params.get("member", "").isdigit():
            points = points.filter(member_id=int(params["member"]))
        if params.get("month"):
            month = month_from(params["month"])
            points = points.filter(occurred_on__gte=month.first, occurred_on__lte=month.last)
        return points

    def create(self, request, *args, **kwargs):
        serializer = ContributionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        member = data["member_id"]
        decides = ranking_access_for(request).can_assess(member)
        with transaction.atomic():
            point = workflow.add_contribution(
                member, data["points"], data["description"], data["occurred_on"], request.user, decides
            )
        return Response(ContributionSerializer(point, context=self.get_serializer_context()).data, status=201)

    def decide(self, request, pk, approve, note=""):
        with transaction.atomic():
            seen = get_object_or_404(self.get_queryset(), pk=pk)
            require(ranking_access_for(request).can_assess(seen.member),
                    _("Only the member's department heads and the Team Manager decide their points."))
            point = ContributionPoint.objects.select_for_update(of=("self",)).select_related("member").get(pk=seen.pk)
            workflow.decide(point, request.user, approve, note)
        fresh = self.get_queryset().get(pk=point.pk)
        return Response(ContributionSerializer(fresh, context=self.get_serializer_context()).data)

    @extend_schema(summary="Validate proposed points (who assesses the member)", parameters=[POINT], request=None,
                   responses=ContributionSerializer)
    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        return self.decide(request, pk, True)

    @extend_schema(summary="Refuse proposed points, saying why", parameters=[POINT], request=RejectSerializer,
                   responses=ContributionSerializer)
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        serializer = RejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.decide(request, pk, False, serializer.validated_data["note"])
