"""
The warnings API (decision D-018, knowledge base: PROJECTS/ERP/discipline_design.md, charter art. 27-28).
Who may do what: access.py; the rules of each change: workflow.py.
"""

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.members.access import is_club_admin
from apps.members.models import Member, MemberStatus, Membership
from apps.projects.models import Project

from . import workflow
from .access import OPEN_PROJECTS, discipline_access_for
from .models import Exclusion, ExclusionStatus, MemberWarning, Report, ReportStatus, WarningStatus, season_of
from .serializers import (
    CouncilDecisionSerializer, DisciplineRightsSerializer, ExclusionCreateSerializer, ExclusionSerializer, DisciplineNoteSerializer,
    CancelReasonSerializer, BreachReportCreateSerializer, BreachReportSerializer, WarningResponseSerializer, DisciplineStandingSerializer,
    DisciplineTargetSerializer, MemberWarningCreateSerializer, MemberWarningSerializer,
)

ID = OpenApiParameter("id", int, OpenApiParameter.PATH)
MEMBER = OpenApiParameter("member_id", int, OpenApiParameter.PATH)


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def team_members():
    """The members of the team: active accounts with a membership in progress, alumni excepted."""
    active = Membership.objects.filter(end_date__isnull=True).values("member_id")
    return Member.objects.filter(is_active=True, pk__in=active).exclude(status=MemberStatus.ALUMNI)


class DisciplineViewSet(viewsets.ViewSet):
    @extend_schema(summary="What the viewer may do about warnings, and their own count this season",
                   responses=DisciplineRightsSerializer)
    @action(detail=False, methods=["get"])
    def rights(self, request):
        access = discipline_access_for(request)
        season = season_of(timezone.localdate())
        data = {
            "report": access.sees_all() or bool(access.led_member_ids() - {request.user.pk})
            or bool(access.managed_member_ids() - {request.user.pk}),
            "issue": access.sees_all() or bool(access.managed_member_ids() - {request.user.pk}),
            "sees_all": access.sees_all(),
            "season": season,
            "my_warnings": workflow.active_warnings(request.user, season).count(),
        }
        return Response(DisciplineRightsSerializer(data).data)

    @extend_schema(summary="The members the viewer may report (and whether they may warn them)",
                   responses=DisciplineTargetSerializer(many=True))
    @action(detail=False, methods=["get"])
    def members(self, request):
        access = discipline_access_for(request)
        members = team_members().exclude(pk=request.user.pk).order_by("first_name", "last_name")
        if not access.sees_all():
            members = members.filter(pk__in=access.led_member_ids() | access.managed_member_ids())
        rows = [
            {"id": m.pk, "first_name": m.first_name, "last_name": m.last_name, "can_issue": access.can_issue(m)}
            for m in members
        ]
        return Response(DisciplineTargetSerializer(rows, many=True).data)

    @extend_schema(summary="A member's warnings this season and the number the next one would have",
                   parameters=[MEMBER], responses=DisciplineStandingSerializer)
    @action(detail=False, methods=["get"], url_path=r"standing/(?P<member_id>\d+)")
    def standing(self, request, member_id=None):
        access = discipline_access_for(request)
        member = get_object_or_404(Member, pk=member_id)
        require(access.is_viewer(member.pk) or access.follows(member.pk),
                _("Only the member and those who follow them see their warnings."))
        data = {"member": member, **workflow.standing(member), "can_report": access.can_report(member),
                "can_issue": access.can_issue(member)}
        return Response(DisciplineStandingSerializer(data).data)


@extend_schema_view(
    list=extend_schema(
        summary="The breach reports the viewer sees (never those about themself)",
        parameters=[OpenApiParameter("status", enum=ReportStatus.values)],
    ),
    create=extend_schema(summary="Report a breach (art. 27.3): the authority over the member is told",
                         request=BreachReportCreateSerializer, responses={201: BreachReportSerializer}),
)
class ReportViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = BreachReportSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        reports = discipline_access_for(self.request).reports_seen(
            Report.objects.select_related("member", "reported_by", "handled_by")
        )
        status = self.request.query_params.get("status")
        return reports.filter(status=status) if status else reports

    def create(self, request, *args, **kwargs):
        serializer = BreachReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        member = data["member_id"]
        require(discipline_access_for(request).can_report(member),
                _("Only the member's department heads, project managers and the Bureau report a breach."))
        with transaction.atomic():
            report = workflow.report(member, data["ground"], data["facts"], request.user)
        return Response(BreachReportSerializer(report, context=self.get_serializer_context()).data, status=201)

    @extend_schema(summary="Dismiss a report, saying why (the authority over the member)", parameters=[ID],
                   request=DisciplineNoteSerializer, responses=BreachReportSerializer)
    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        serializer = DisciplineNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            report = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
            require(discipline_access_for(request).handles(report),
                    _("Only the project manager or the Bureau decides what follows a report."))
            workflow.dismiss(report, request.user, serializer.validated_data["note"])
        return Response(BreachReportSerializer(report, context=self.get_serializer_context()).data)


@extend_schema_view(
    list=extend_schema(
        summary="The warnings the viewer sees: theirs, those of the members they follow, all for the Bureau",
        parameters=[
            OpenApiParameter("member", int),
            OpenApiParameter("season", str, description="A year (2026 for 2026/2027), \"current\" or \"all\" "
                                                       "(the default)."),
            OpenApiParameter("status", enum=WarningStatus.values),
        ],
    ),
    retrieve=extend_schema(summary="A warning", parameters=[ID]),
    create=extend_schema(summary="Give a warning (a project manager to their project's members, the Bureau)",
                         request=MemberWarningCreateSerializer, responses={201: MemberWarningSerializer}),
)
class WarningViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                     viewsets.GenericViewSet):
    serializer_class = MemberWarningSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        warnings = discipline_access_for(self.request).warnings_seen(
            MemberWarning.objects.select_related(
                "member", "issued_by", "project", "council", "council_decided_by", "cancelled_by"
            )
        )
        params = self.request.query_params
        if params.get("member", "").isdigit():
            warnings = warnings.filter(member_id=int(params["member"]))
        season = params.get("season", "all")
        if season == "current":
            warnings = warnings.filter(season=season_of(timezone.localdate()))
        elif season.isdigit():
            warnings = warnings.filter(season=int(season))
        if params.get("status"):
            warnings = warnings.filter(status=params["status"])
        return warnings

    def create(self, request, *args, **kwargs):
        access = discipline_access_for(request)
        serializer = MemberWarningCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        member = data.pop("member_id")
        require(access.can_issue(member), _("Only the member's project manager or the Bureau gives a warning "
                                            "(art. 27.1), never to oneself."))
        project = self.project(access, member, data.pop("project_id", None))
        report_id = data.pop("report_id", None)
        council = {
            "starts_at": data.pop("council_starts_at", None), "ends_at": data.pop("council_ends_at", None),
            "location": data.pop("council_location", ""),
        }
        with transaction.atomic():
            report = None
            if report_id:
                report = get_object_or_404(Report.objects.select_for_update(), pk=report_id)
            warning = workflow.issue(member, data, request.user, project=project, report_=report, council=council)
        fresh = self.get_queryset().get(pk=warning.pk)
        return Response(MemberWarningSerializer(fresh, context=self.get_serializer_context()).data, status=201)

    def project(self, access, member, project_id):
        """A project manager's warning is about their project; the Bureau may name one."""
        managed = Project.objects.filter(
            project_manager=access.viewer, status__in=OPEN_PROJECTS, members__member=member,
            members__is_active=True,
        ).first()
        if not access.sees_all() or project_id is None:
            return managed
        return get_object_or_404(Project, pk=project_id)

    def change(self, request, pk, apply):
        with transaction.atomic():
            seen = get_object_or_404(self.get_queryset(), pk=pk)
            warning = MemberWarning.objects.select_for_update(of=("self",)).get(pk=seen.pk)
            apply(discipline_access_for(request), warning)
        fresh = self.get_queryset().get(pk=warning.pk)
        return Response(MemberWarningSerializer(fresh, context=self.get_serializer_context()).data)

    @extend_schema(summary="Write one's response to a warning (the member)", parameters=[ID],
                   request=WarningResponseSerializer, responses=MemberWarningSerializer)
    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        serializer = WarningResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        def apply(access, warning):
            require(access.is_viewer(warning.member_id), _("Only the member answers their warning."))
            workflow.respond(warning, serializer.validated_data["response"])

        return self.change(request, pk, apply)

    @extend_schema(summary="Record the council's decision (a second warning)", parameters=[ID],
                   request=CouncilDecisionSerializer, responses=MemberWarningSerializer)
    @action(detail=True, methods=["post"])
    def council(self, request, pk=None):
        serializer = CouncilDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        def apply(access, warning):
            require(access.can_record_council(warning),
                    _("Only the Bureau or who gave the warning records the council's decision."))
            workflow.record_council(warning, request.user, serializer.validated_data["decision"])

        return self.change(request, pk, apply)

    @extend_schema(summary="Cancel a warning given by mistake, saying why (the Bureau)", parameters=[ID],
                   request=CancelReasonSerializer, responses=MemberWarningSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        serializer = CancelReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        def apply(access, warning):
            require(access.sees_all(), _("Only the Bureau cancels a warning."))
            workflow.cancel(warning, request.user, serializer.validated_data["reason"])

        return self.change(request, pk, apply)


@extend_schema_view(
    list=extend_schema(
        summary="The exclusions: all for the Bureau, the viewer's own otherwise",
        parameters=[OpenApiParameter("status", enum=ExclusionStatus.values)],
    ),
    create=extend_schema(summary="Propose an immediate exclusion (art. 28, the Bureau): to confirm",
                         request=ExclusionCreateSerializer, responses={201: ExclusionSerializer}),
)
class ExclusionViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = ExclusionSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        access = discipline_access_for(self.request)
        exclusions = Exclusion.objects.select_related("member", "proposed_by", "decided_by")
        if not access.sees_all():
            exclusions = exclusions.filter(member=self.request.user, status=ExclusionStatus.CONFIRMED)
        status = self.request.query_params.get("status")
        return exclusions.filter(status=status) if status else exclusions

    def create(self, request, *args, **kwargs):
        access = discipline_access_for(request)
        require(access.sees_all(), _("Only the Bureau proposes an immediate exclusion."))
        serializer = ExclusionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if access.is_viewer(data["member_id"].pk):
            raise ValidationError({"member_id": [_("Not oneself.")]})
        if not access.is_admin and is_club_admin(data["member_id"]):
            raise ValidationError({"member_id": [_("Only an admin proposes the exclusion of a club admin.")]})
        with transaction.atomic():
            exclusion = workflow.propose_exclusion(data["member_id"], data["serious_ground"], data["facts"],
                                                   request.user)
        return Response(ExclusionSerializer(exclusion, context=self.get_serializer_context()).data, status=201)

    def decide(self, request, pk, apply, confirming=False):
        access = discipline_access_for(request)
        require(access.sees_all(), _("Only the Bureau confirms or abandons an exclusion."))
        with transaction.atomic():
            exclusion = get_object_or_404(Exclusion.objects.select_for_update(), pk=pk)
            require(not access.is_viewer(exclusion.member_id), _("Not oneself."))
            # Two people for an exclusion: who proposed it does not confirm it alone (the admins excepted).
            if confirming and not access.is_admin:
                require(exclusion.proposed_by_id != request.user.pk,
                        _("Another member of the Bureau confirms the exclusion you proposed."))
                require(not is_club_admin(exclusion.member), _("Only an admin excludes a club admin."))
            apply(exclusion)
        fresh = self.get_queryset().get(pk=exclusion.pk)
        return Response(ExclusionSerializer(fresh, context=self.get_serializer_context()).data)

    @extend_schema(summary="Confirm an exclusion: the account is deactivated, the memberships end (the Bureau)",
                   parameters=[ID], request=None, responses=ExclusionSerializer)
    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        return self.decide(request, pk, lambda exclusion: workflow.confirm(exclusion, request.user), confirming=True)

    @extend_schema(summary="Abandon an exclusion, saying why (the Bureau)", parameters=[ID], request=DisciplineNoteSerializer,
                   responses=ExclusionSerializer)
    @action(detail=True, methods=["post"])
    def abandon(self, request, pk=None):
        serializer = DisciplineNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = serializer.validated_data["note"]
        return self.decide(request, pk, lambda exclusion: workflow.abandon(exclusion, request.user, note))
