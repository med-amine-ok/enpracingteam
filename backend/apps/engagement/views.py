"""
The goals, trainings, volunteering and member sheet API (decision D-019, knowledge base:
PROJECTS/ERP/engagement_design.md). Who may do what: access.py; the rules of each change: workflow.py.
"""

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.discipline.models import season_of
from apps.members.models import Member
from apps.members.rules import charter_issues

from . import workflow
from .access import engagement_access_for
from .models import Objective, ObjectiveStatus, Training, TrainingStatus, VolunteeringActivity, VolunteeringStatus
from .serializers import (
    CharterIssueSerializer, EngagementRightsSerializer, FollowedMemberSerializer, GoalChangeSerializer,
    GoalCreateSerializer, GoalSerializer, MemberSheetSerializer, TrainingCreateSerializer, TrainingDropSerializer,
    TrainingFollowSerializer, TrainingPlanSerializer, TrainingSerializer, VolunteeringCreateSerializer,
    VolunteeringRefuseSerializer, VolunteeringSerializer,
)
from .sheet import member_sheet

ID = OpenApiParameter("id", int, OpenApiParameter.PATH)
MEMBER = OpenApiParameter("member_id", int, OpenApiParameter.PATH)
MONTH = OpenApiParameter("month", str, description="YYYY-MM; the current month by default.")


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def followed_ids(access):
    """None: everyone (the Team Manager, the Bureau); else the members the viewer heads (never themself)."""
    return None if access.sees_all() else access.led_member_ids() - {access.viewer.pk}


def seen(queryset, access, field="member"):
    """Rows about the viewer or about the members they head."""
    ids = followed_ids(access)
    if ids is None:
        return queryset
    return queryset.filter(Q(**{field: access.viewer}) | Q(**{f"{field}_id__in": ids}))


def month_day(request):
    text = request.query_params.get("month")
    if not text:
        return timezone.localdate()
    try:
        year, month = text.split("-")
        return timezone.localdate().replace(year=int(year), month=int(month), day=1)
    except ValueError as wrong:
        raise ValidationError({"month": [_("A month is written YYYY-MM.")]}) from wrong


class EngagementViewSet(viewsets.ViewSet):
    @extend_schema(summary="What the viewer may do with goals, trainings and volunteering",
                   responses=EngagementRightsSerializer)
    @action(detail=False, methods=["get"])
    def rights(self, request):
        access = engagement_access_for(request)
        return Response(EngagementRightsSerializer({"leads": access.leads_anyone(), "sees_all": access.sees_all()}).data)

    @extend_schema(summary="The members the viewer heads, with their goals and this month's volunteering",
                   responses=FollowedMemberSerializer(many=True))
    @action(detail=False, methods=["get"])
    def members(self, request):
        access = engagement_access_for(request)
        members = workflow.team_members().exclude(pk=request.user.pk).order_by("first_name", "last_name")
        ids = followed_ids(access)
        if ids is not None:
            members = members.filter(pk__in=ids)
        members = list(members)
        season = season_of(timezone.localdate())
        done = workflow.covered([member.pk for member in members], timezone.localdate())
        goals = {}
        for member_id in Objective.objects.filter(
            member__in=members, season=season, status=ObjectiveStatus.IN_PROGRESS
        ).values_list("member_id", flat=True):
            goals[member_id] = goals.get(member_id, 0) + 1
        rows = [
            {"id": m.pk, "first_name": m.first_name, "last_name": m.last_name, "goals": goals.get(m.pk, 0),
             "volunteered": m.pk in done}
            for m in members
        ]
        return Response(FollowedMemberSerializer(rows, many=True).data)

    @extend_schema(summary="A member's full sheet (the member, their heads, the Team Manager, the Bureau)",
                   parameters=[MEMBER], responses=MemberSheetSerializer)
    @action(detail=False, methods=["get"], url_path=r"sheet/(?P<member_id>\d+)")
    def sheet(self, request, member_id=None):
        member = get_object_or_404(
            Member.objects.select_related("alumni_profile")
            .prefetch_related("memberships__role", "memberships__org_unit"), pk=member_id
        )
        require(engagement_access_for(request).sees_sheet(member),
                _("Only the member, their heads, the Team Manager and the Bureau see this sheet."))
        return Response(MemberSheetSerializer(member_sheet(member), context={"request": request}).data)

    @extend_schema(summary="The memberships that break the charter (art. 13 and 14), for the Bureau",
                   responses=CharterIssueSerializer(many=True))
    @action(detail=False, methods=["get"], url_path="charter-issues")
    def charter_issues(self, request):
        require(engagement_access_for(request).sees_all(), _("Only the Bureau sees this list."))
        return Response(CharterIssueSerializer(charter_issues(), many=True).data)


@extend_schema_view(
    list=extend_schema(
        summary="The goals the viewer sees: theirs, and those of the members they head",
        parameters=[
            OpenApiParameter("member", int),
            OpenApiParameter("season", str, description="A year (2026 for 2026/2027), \"current\" (the default) or "
                                                       "\"all\"."),
            OpenApiParameter("status", enum=ObjectiveStatus.values),
        ],
    ),
    retrieve=extend_schema(summary="A goal", parameters=[ID]),
    create=extend_schema(summary="Set a goal of a member (their head), never one's own", request=GoalCreateSerializer,
                         responses={201: GoalSerializer}),
    partial_update=extend_schema(summary="Move a goal forward (the member: progress) or change it (a head)",
                                 parameters=[ID], request=GoalChangeSerializer, responses=GoalSerializer),
)
class GoalViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                  mixins.UpdateModelMixin, viewsets.GenericViewSet):
    serializer_class = GoalSerializer
    http_method_names = ["get", "post", "patch"]
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        goals = seen(Objective.objects.select_related("member", "set_by", "assessed_by"),
                     engagement_access_for(self.request))
        params = self.request.query_params
        if params.get("member", "").isdigit():
            goals = goals.filter(member_id=int(params["member"]))
        season = params.get("season", "current")
        if season == "current":
            goals = goals.filter(season=season_of(timezone.localdate()))
        elif season.isdigit():
            goals = goals.filter(season=int(season))
        if params.get("status"):
            goals = goals.filter(status=params["status"])
        return goals

    def create(self, request, *args, **kwargs):
        serializer = GoalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        member = data.pop("member_id")
        require(engagement_access_for(request).follows(member.pk),
                _("Only the member's heads set their goals, never one's own."))
        with transaction.atomic():
            goal = workflow.set_goal(member, data, request.user)
        return Response(GoalSerializer(goal, context=self.get_serializer_context()).data, status=201)

    def partial_update(self, request, *args, **kwargs):
        access = engagement_access_for(request)
        goal = get_object_or_404(seen(Objective.objects.all(), access), pk=kwargs["pk"])  # any season
        serializer = GoalChangeSerializer(goal, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            changed = workflow.change_goal(goal, dict(serializer.validated_data), request.user,
                                           access.follows(goal.member_id))
        require(changed, _("The member moves the progress forward; their heads change the rest."))
        fresh = Objective.objects.select_related("member", "set_by", "assessed_by").get(pk=goal.pk)
        return Response(GoalSerializer(fresh, context=self.get_serializer_context()).data)


@extend_schema_view(
    list=extend_schema(
        summary="The trainings the viewer sees: theirs, and those of the members they head",
        parameters=[OpenApiParameter("member", int), OpenApiParameter("status", enum=TrainingStatus.values)],
    ),
    create=extend_schema(summary="Wish a training (oneself), or record one followed (a head, for a member)",
                         request=TrainingCreateSerializer, responses={201: TrainingSerializer}),
    destroy=extend_schema(summary="Withdraw one's wish, before it is planned", parameters=[ID]),
)
class TrainingViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin,
                      viewsets.GenericViewSet):
    serializer_class = TrainingSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        trainings = seen(Training.objects.select_related("member", "session", "updated_by"),
                         engagement_access_for(self.request))
        params = self.request.query_params
        if params.get("member", "").isdigit():
            trainings = trainings.filter(member_id=int(params["member"]))
        if params.get("status"):
            trainings = trainings.filter(status=params["status"])
        return trainings

    def create(self, request, *args, **kwargs):
        access = engagement_access_for(request)
        serializer = TrainingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        member = data.get("member_id") or request.user
        followed = data["status"] == TrainingStatus.FOLLOWED
        if followed or member.pk != request.user.pk:
            require(access.follows(member.pk), _("Only the member's heads record a training for them."))
        if followed:
            training = workflow.record_followed(member, data["topic"], data["followed_on"], request.user,
                                                data["reason"])
        else:
            training = workflow.wish(member, data["topic"], data["reason"])
        fresh = self.get_queryset().get(pk=training.pk)
        return Response(TrainingSerializer(fresh, context=self.get_serializer_context()).data, status=201)

    def destroy(self, request, *args, **kwargs):
        training = get_object_or_404(self.get_queryset(), pk=kwargs["pk"])
        require(engagement_access_for(request).is_viewer(training.member_id), _("Only the member withdraws a wish."))
        workflow.withdraw(training)
        return Response(status=204)

    def change(self, request, pk, apply):
        with transaction.atomic():
            training = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
            require(engagement_access_for(request).follows(training.member_id),
                    _("Only the member's heads plan their trainings."))
            apply(training)
        fresh = self.get_queryset().get(pk=training.pk)
        return Response(TrainingSerializer(fresh, context=self.get_serializer_context()).data)

    @extend_schema(summary="Plan a training, maybe through a \"Training\" session (a head)", parameters=[ID],
                   request=TrainingPlanSerializer, responses=TrainingSerializer)
    @action(detail=True, methods=["post"])
    def plan(self, request, pk=None):
        serializer = TrainingPlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        return self.change(request, pk, lambda t: workflow.plan(t, request.user, data["session_id"], data["note"]))

    @extend_schema(summary="Mark a training followed (a head)", parameters=[ID], request=TrainingFollowSerializer,
                   responses=TrainingSerializer)
    @action(detail=True, methods=["post"])
    def follow(self, request, pk=None):
        serializer = TrainingFollowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        return self.change(request, pk, lambda t: workflow.follow(t, request.user, data["followed_on"], data["note"]))

    @extend_schema(summary="Drop a training (a head)", parameters=[ID], request=TrainingDropSerializer,
                   responses=TrainingSerializer)
    @action(detail=True, methods=["post"])
    def drop(self, request, pk=None):
        serializer = TrainingDropSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.change(request, pk, lambda t: workflow.drop(t, request.user, serializer.validated_data["note"]))


@extend_schema_view(
    list=extend_schema(
        summary="The volunteering activities the viewer sees: theirs, and those of the members they head",
        parameters=[OpenApiParameter("status", enum=VolunteeringStatus.values), MONTH],
    ),
    create=extend_schema(summary="Record a volunteering activity with its participants (its organiser): to validate",
                         request=VolunteeringCreateSerializer, responses={201: VolunteeringSerializer}),
    destroy=extend_schema(summary="Delete one's activity, before it is decided", parameters=[ID]),
)
class VolunteeringViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin,
                          viewsets.GenericViewSet):
    serializer_class = VolunteeringSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        access = engagement_access_for(self.request)
        activities = VolunteeringActivity.objects.select_related("organiser", "decided_by").prefetch_related(
            "participants"
        )
        ids = followed_ids(access)
        if ids is not None:
            viewer = self.request.user
            activities = activities.filter(
                Q(organiser=viewer) | Q(participants=viewer) | Q(organiser_id__in=ids) | Q(participants__in=ids)
            ).distinct()
        params = self.request.query_params
        if params.get("status"):
            activities = activities.filter(status=params["status"])
        if params.get("month"):
            first, last = workflow.month_bounds(month_day(self.request))
            activities = activities.filter(date__gte=first, date__lte=last)
        return activities

    def create(self, request, *args, **kwargs):
        serializer = VolunteeringCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        participants = data.pop("participant_ids")
        with transaction.atomic():
            activity = workflow.organise(request.user, data, participants)
        fresh = VolunteeringActivity.objects.prefetch_related("participants").select_related(
            "organiser", "decided_by").get(pk=activity.pk)
        return Response(VolunteeringSerializer(fresh, context=self.get_serializer_context()).data, status=201)

    def destroy(self, request, *args, **kwargs):
        activity = get_object_or_404(self.get_queryset(), pk=kwargs["pk"])
        require(engagement_access_for(request).is_viewer(activity.organiser_id),
                _("Only its organiser deletes an activity."))
        if activity.status != VolunteeringStatus.PROPOSED:
            raise ValidationError({"detail": _("This activity is already decided.")})
        activity.delete()
        return Response(status=204)

    def decide(self, request, pk, approve, note=""):
        with transaction.atomic():
            seen_activity = get_object_or_404(self.get_queryset(), pk=pk)
            require(engagement_access_for(request).validates(seen_activity),
                    _("A head of its organiser validates an activity, never its organiser."))
            activity = VolunteeringActivity.objects.select_for_update().get(pk=seen_activity.pk)
            workflow.decide(activity, request.user, approve, note)
        fresh = VolunteeringActivity.objects.prefetch_related("participants").select_related(
            "organiser", "decided_by").get(pk=activity.pk)
        return Response(VolunteeringSerializer(fresh, context=self.get_serializer_context()).data)

    @extend_schema(summary="Validate an activity: it covers the month of its participants", parameters=[ID],
                   request=None, responses=VolunteeringSerializer)
    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        return self.decide(request, pk, True)

    @extend_schema(summary="Refuse an activity, saying why", parameters=[ID], request=VolunteeringRefuseSerializer,
                   responses=VolunteeringSerializer)
    @action(detail=True, methods=["post"])
    def refuse(self, request, pk=None):
        serializer = VolunteeringRefuseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.decide(request, pk, False, serializer.validated_data["note"])

    @extend_schema(summary="The members the viewer heads (themself included) without a validated volunteering in "
                           "the month", parameters=[MONTH], responses=FollowedMemberSerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def missing(self, request):
        access = engagement_access_for(request)
        require(access.leads_anyone(), _("Only the heads, the Team Manager and the Bureau see this list."))
        day = month_day(request)
        members = workflow.team_members().order_by("first_name", "last_name")
        if not access.sees_all():
            members = members.filter(pk__in=access.led_member_ids())
        members = list(members)
        done = workflow.covered([member.pk for member in members], day)
        rows = [
            {"id": m.pk, "first_name": m.first_name, "last_name": m.last_name, "goals": 0, "volunteered": False}
            for m in members if m.pk not in done
        ]
        return Response(FollowedMemberSerializer(rows, many=True).data)
