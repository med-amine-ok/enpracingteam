"""
The sessions API (decision D-013, knowledge base: PROJECTS/ERP/meetings_design.md): schedule, change and
cancel (the bureau), check in and ask for an excuse (the invitees), confirm the attendance and write the
minutes, decisions and actions (the organiser), decide the excuses (the Team Manager), and the presence
score of a member (Ranking System §4). Who may do what: access.py; what happens: workflow.py.
"""

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.communication import notify
from apps.members.models import Member
from apps.projects.access import work_access_for

from . import workflow
from .access import meeting_access_for
from .models import (
    Attendance, AttendanceStatus, ExcuseStatus, Meeting, MeetingAction, MeetingDecision, MeetingKind, MeetingStatus,
)
from .scores import counted_attendances, presence_score
from .serializers import (
    ActionSerializer, ActionToTaskSerializer, ActionWriteSerializer, AttendanceConfirmSerializer, CancelSerializer,
    DecisionSerializer, ExcuseDecisionSerializer, ExcuseRowSerializer, ExcuseSerializer, InviteeSerializer,
    MeetingDetailSerializer, MeetingRightsSerializer, MeetingSerializer, MeetingWriteSerializer, MinutesSerializer,
    PresenceSerializer,
)

MEETING = OpenApiParameter("id", int, OpenApiParameter.PATH)
LOCKED_ONCE_STARTED = ("starts_at", "ends_at", "is_mandatory", "is_critical", "org_unit")
PRESENCE_DAYS = 90


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def counts():
    accepted = Q(attendances__excuse_status=ExcuseStatus.ACCEPTED)
    return {
        "count_invited": Count("attendances"),
        "count_present": Count("attendances", filter=Q(attendances__status=AttendanceStatus.PRESENT) & ~accepted),
        "count_late": Count("attendances", filter=Q(attendances__status=AttendanceStatus.LATE) & ~accepted),
        "count_absent": Count("attendances", filter=Q(attendances__status=AttendanceStatus.ABSENT) & ~accepted),
        "count_excused": Count("attendances", filter=accepted),
    }


@extend_schema_view(
    list=extend_schema(
        summary="The sessions the viewer is invited to or runs (all of them for the bureau and the admins)",
        parameters=[OpenApiParameter("when", str, enum=["upcoming", "past"], description="Not ended yet, or ended.")],
    ),
    retrieve=extend_schema(summary="A session, with its attendance, minutes, decisions and actions",
                           parameters=[MEETING]),
    create=extend_schema(summary="Schedule a session (the bureau and the admins)", request=MeetingWriteSerializer,
                         responses={201: MeetingDetailSerializer}),
    partial_update=extend_schema(summary="Change a session (the bureau and the admins)", parameters=[MEETING],
                                 request=MeetingWriteSerializer, responses=MeetingDetailSerializer),
)
class MeetingViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                     mixins.UpdateModelMixin, viewsets.GenericViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    lookup_value_regex = r"\d+"

    def get_serializer_class(self):
        if self.action == "list":
            return MeetingSerializer
        if self.action in ("create", "partial_update"):
            return MeetingWriteSerializer
        return MeetingDetailSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "now": timezone.now()}

    def get_queryset(self):
        viewer = self.request.user
        meetings = Meeting.objects.select_related("org_unit", "organiser").annotate(**counts()).order_by(
            "starts_at", "id"
        ).prefetch_related(
            Prefetch("attendances", queryset=Attendance.objects.filter(member=viewer), to_attr="mine")
        )
        if self.action == "retrieve":
            meetings = meetings.select_related("created_by", "attendance_confirmed_by").prefetch_related(
                Prefetch("attendances", queryset=Attendance.objects.select_related(
                    "member", "marked_by", "excuse_decided_by")),
                Prefetch("decisions", queryset=MeetingDecision.objects.select_related("created_by")),
                Prefetch("actions", queryset=MeetingAction.objects.select_related("responsible", "task")),
            )
        if self.action in ("list", "retrieve"):
            meetings = meeting_access_for(self.request).visible(meetings)
        if self.action == "list":
            when = self.request.query_params.get("when")
            now = timezone.now()
            if when == "upcoming":
                meetings = meetings.filter(ends_at__gte=now)
            elif when == "past":
                meetings = meetings.filter(ends_at__lt=now).order_by("-starts_at", "-id")
        return meetings

    def detail_response(self, meeting, status=200):
        self.action = "retrieve"
        fresh = self.get_queryset().get(pk=meeting.pk)
        return Response(MeetingDetailSerializer(fresh, context=self.get_serializer_context()).data, status=status)

    def meeting(self, pk):
        """The session, locked for the change (any session: the checks below say who may act)."""
        return get_object_or_404(Meeting.objects.select_for_update(of=("self",)).select_related("org_unit"), pk=pk)

    def valid(self, serializer_class, data=None, **kwargs):
        serializer = serializer_class(data=self.request.data if data is None else data,
                                      context=self.get_serializer_context(), **kwargs)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def require_open(self, meeting):
        if meeting.status == MeetingStatus.CANCELLED:
            raise ValidationError({"detail": _("This session is cancelled.")})

    def attendance_of(self, meeting):
        attendance = meeting.attendances.filter(member=self.request.user).first()
        require(attendance is not None, _("You are not invited to this session."))
        return attendance

    # --- Scheduling ---

    def create(self, request, *args, **kwargs):
        access = meeting_access_for(request)
        require(access.can_schedule(), _("Only the Executive Bureau schedules the sessions."))
        data = self.valid(MeetingWriteSerializer)
        if data.get("is_mandatory") and data["starts_at"] <= timezone.now():
            raise ValidationError({"is_mandatory": [_("A session is made mandatory before it starts, never after.")]})
        with transaction.atomic():
            meeting = Meeting.objects.create(
                **{"organiser": request.user, **data}, created_by=request.user,
            )
            invited = workflow.invite(meeting, workflow.invitees(meeting))
            notify.meeting_scheduled(meeting, invited, request.user)
        return self.detail_response(meeting, status=201)

    def partial_update(self, request, *args, **kwargs):
        access = meeting_access_for(request)
        require(access.can_schedule(), _("Only the Executive Bureau changes the sessions."))
        now = timezone.now()
        with transaction.atomic():
            meeting = self.meeting(kwargs["pk"])
            self.require_open(meeting)
            serializer = MeetingWriteSerializer(meeting, data=request.data, partial=True,
                                                context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            changed = [field for field in data if data[field] != getattr(meeting, field)]
            if meeting.kind == MeetingKind.COUNCIL and "org_unit" in changed:
                raise ValidationError({"org_unit_id": [_("A council's invitees are set by its warning.")]})
            if workflow.has_started(meeting, now):
                locked = [field for field in changed if field in LOCKED_ONCE_STARTED]
                if locked:
                    message = _("Locked since the session started.")
                    raise ValidationError({("org_unit_id" if f == "org_unit" else f): [message] for f in locked})
            mandatory = data.get("is_mandatory", meeting.is_mandatory)
            if mandatory and "is_mandatory" in changed and data.get("starts_at", meeting.starts_at) <= now:
                raise ValidationError(
                    {"is_mandatory": [_("A session is made mandatory before it starts, never after.")]}
                )
            meeting = serializer.save()
            if "org_unit" in changed:
                notify.meeting_scheduled(meeting, workflow.reinvite(meeting), request.user)
            if {"starts_at", "ends_at", "location"} & set(changed):
                notify.meeting_updated(meeting, request.user)
        return self.detail_response(meeting)

    @extend_schema(summary="Cancel a session (the bureau and the admins): its invitees are told",
                   parameters=[MEETING], request=CancelSerializer, responses=MeetingDetailSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        require(meeting_access_for(request).can_schedule(), _("Only the Executive Bureau changes the sessions."))
        data = self.valid(CancelSerializer)
        with transaction.atomic():
            meeting = self.meeting(pk)
            self.require_open(meeting)
            meeting.status = MeetingStatus.CANCELLED
            meeting.cancel_reason = data.get("reason", "")
            meeting.save(update_fields=["status", "cancel_reason", "updated_at"])
            notify.meeting_updated(meeting, request.user, cancelled=True)
        return self.detail_response(meeting)

    @extend_schema(summary="Invite one more person (who runs it)", parameters=[MEETING], request=InviteeSerializer,
                   responses={201: MeetingDetailSerializer})
    @action(detail=True, methods=["post"])
    def invitees(self, request, pk=None):
        with transaction.atomic():
            meeting = self.meeting(pk)
            require(meeting_access_for(request).can_run(meeting), _("Only who runs the session changes its invitees."))
            self.require_open(meeting)
            if timezone.now() > meeting.ends_at:
                raise ValidationError({"detail": _("This session is over.")})
            member = self.valid(InviteeSerializer)["member"]
            notify.meeting_scheduled(meeting, workflow.invite(meeting, [member]), request.user)
        return self.detail_response(meeting, status=201)

    @extend_schema(summary="Take a person off the invitees (who runs it)",
                   parameters=[MEETING, OpenApiParameter("member_id", int, OpenApiParameter.PATH)], request=None,
                   responses={204: OpenApiResponse(description="No longer invited.")})
    @action(detail=True, methods=["delete"], url_path=r"invitees/(?P<member_id>\d+)")
    def remove_invitee(self, request, pk=None, member_id=None):
        with transaction.atomic():
            meeting = self.meeting(pk)
            require(meeting_access_for(request).can_run(meeting), _("Only who runs the session changes its invitees."))
            # As for inviting: only before the end (meetings_design §2). Afterwards the row is the member's
            # recorded presence or absence, which counts in their presence score and ranking.
            self.require_open(meeting)
            if timezone.now() > meeting.ends_at:
                raise ValidationError({"detail": _("This session is over.")})
            get_object_or_404(Attendance, meeting=meeting, member_id=member_id).delete()
        return Response(status=204)

    # --- Attendance ---

    @extend_schema(summary="« Je suis là »: check in (from 15 min before the start to its end)", parameters=[MEETING],
                   request=None, responses=MeetingDetailSerializer)
    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        now = timezone.now()
        with transaction.atomic():
            meeting = self.meeting(pk)
            attendance = self.attendance_of(meeting)
            self.require_open(meeting)
            if meeting.attendance_confirmed_at is not None:
                raise ValidationError({"detail": _("The attendance of this session is already confirmed.")})
            if attendance.checked_in_at is not None:
                raise ValidationError({"detail": _("You already checked in.")})
            if not workflow.check_in_open(meeting, now):
                raise ValidationError({"detail": _("The check-in opens 15 minutes before the start and closes at the end.")})
            workflow.check_in(attendance, now)
        return self.detail_response(meeting)

    @extend_schema(summary="Confirm the attendance (who runs it, once it started): the others are absent",
                   parameters=[MEETING], request=AttendanceConfirmSerializer, responses=MeetingDetailSerializer)
    @action(detail=True, methods=["post"])
    def attendance(self, request, pk=None):
        now = timezone.now()
        with transaction.atomic():
            meeting = self.meeting(pk)
            require(meeting_access_for(request).can_run(meeting), _("Only who runs the session confirms its attendance."))
            self.require_open(meeting)
            if not workflow.has_started(meeting, now):
                raise ValidationError({"detail": _("The attendance is confirmed once the session has started.")})
            entries = self.valid(AttendanceConfirmSerializer).get("entries", [])
            marks = {entry["member_id"]: entry["status"] for entry in entries}
            invited = set(meeting.attendances.values_list("member_id", flat=True))
            if set(marks) - invited:
                raise ValidationError({"entries": [_("Only the people invited are marked.")]})
            workflow.confirm(meeting, request.user, marks, now)
        return self.detail_response(meeting)

    @extend_schema(summary="Ask for an excuse (an invitee, up to 7 days after the end): the Team Manager decides",
                   parameters=[MEETING], request=ExcuseSerializer, responses=MeetingDetailSerializer)
    @action(detail=True, methods=["post"])
    def excuse(self, request, pk=None):
        now = timezone.now()
        with transaction.atomic():
            meeting = self.meeting(pk)
            attendance = self.attendance_of(meeting)
            self.require_open(meeting)
            if not workflow.may_ask_excuse(meeting, now):
                raise ValidationError({"detail": _("An excuse is asked at the latest 7 days after the session.")})
            if attendance.excuse_status == ExcuseStatus.ACCEPTED:
                raise ValidationError({"detail": _("Your excuse is already accepted.")})
            data = self.valid(ExcuseSerializer)
            workflow.ask_excuse(attendance, request.user, data["reason"], data.get("note", ""), now)
        return self.detail_response(meeting)

    # --- Minutes, decisions, actions ---

    def require_run(self, meeting):
        require(meeting_access_for(self.request).can_run(meeting), _("Only who runs the session writes its minutes."))

    @extend_schema(summary="Write the minutes, and publish them (the invitees are told the first time)",
                   parameters=[MEETING], request=MinutesSerializer, responses=MeetingDetailSerializer)
    @action(detail=True, methods=["post"])
    def minutes(self, request, pk=None):
        with transaction.atomic():
            meeting = self.meeting(pk)
            self.require_run(meeting)
            data = self.valid(MinutesSerializer)
            meeting.minutes = data["minutes"]
            first = data["publish"] and meeting.minutes_published_at is None
            if first:
                meeting.minutes_published_at = timezone.now()
            meeting.save(update_fields=["minutes", "minutes_published_at", "updated_at"])
            if first:
                notify.minutes_published(meeting, request.user)
        return self.detail_response(meeting)

    @extend_schema(summary="Record a decision taken", parameters=[MEETING], request=DecisionSerializer,
                   responses={201: DecisionSerializer})
    @action(detail=True, methods=["post"])
    def decisions(self, request, pk=None):
        meeting = get_object_or_404(Meeting, pk=pk)
        self.require_run(meeting)
        text = self.valid(DecisionSerializer)["text"]
        decision = MeetingDecision.objects.create(meeting=meeting, text=text, created_by=request.user)
        return Response(DecisionSerializer(decision).data, status=201)

    @extend_schema(summary="Remove a decision", request=None,
                   parameters=[MEETING, OpenApiParameter("decision_id", int, OpenApiParameter.PATH)],
                   responses={204: OpenApiResponse(description="Removed.")})
    @action(detail=True, methods=["delete"], url_path=r"decisions/(?P<decision_id>\d+)")
    def delete_decision(self, request, pk=None, decision_id=None):
        meeting = get_object_or_404(Meeting, pk=pk)
        self.require_run(meeting)
        get_object_or_404(MeetingDecision, pk=decision_id, meeting=meeting).delete()
        return Response(status=204)

    @extend_schema(summary="Give an action to someone (its responsible is told)", parameters=[MEETING],
                   request=ActionWriteSerializer, responses={201: ActionSerializer})
    @action(detail=True, methods=["post"])
    def actions(self, request, pk=None):
        meeting = get_object_or_404(Meeting, pk=pk)
        self.require_run(meeting)
        data = self.valid(ActionWriteSerializer)
        with transaction.atomic():
            item = MeetingAction.objects.create(meeting=meeting, created_by=request.user, **data)
            if item.responsible is not None:
                notify.action_assigned(item, request.user)
        return Response(ActionSerializer(item).data, status=201)

    def action_of(self, meeting, action_id):
        return get_object_or_404(MeetingAction.objects.select_related("meeting", "task"), pk=action_id, meeting=meeting)

    @extend_schema(summary="Change an action (who runs it), or tick it done (its responsible too)",
                   parameters=[MEETING, OpenApiParameter("action_id", int, OpenApiParameter.PATH)],
                   request=ActionWriteSerializer, responses=ActionSerializer)
    @action(detail=True, methods=["patch"], url_path=r"actions/(?P<action_id>\d+)")
    def change_action(self, request, pk=None, action_id=None):
        meeting = get_object_or_404(Meeting, pk=pk)
        item = self.action_of(meeting, action_id)
        access = meeting_access_for(request)
        data = self.valid(ActionWriteSerializer, partial=True)
        if set(data) - {"is_done"}:
            self.require_run(meeting)
        require(access.can_tick(item), _("Only its responsible and who runs the session tick an action."))
        before = item.responsible_id
        for field, value in data.items():
            setattr(item, field, value)
        if "is_done" in data:
            item.done_at = timezone.now() if data["is_done"] else None
        with transaction.atomic():
            item.save()
            if item.responsible is not None and item.responsible_id != before:
                notify.action_assigned(item, request.user)
        return Response(ActionSerializer(item).data)

    @extend_schema(summary="Make an action a task of a project, assigned to its responsible",
                   parameters=[MEETING, OpenApiParameter("action_id", int, OpenApiParameter.PATH)],
                   request=ActionToTaskSerializer, responses={201: ActionSerializer})
    @action(detail=True, methods=["post"], url_path=r"actions/(?P<action_id>\d+)/task")
    def action_task(self, request, pk=None, action_id=None):
        meeting = get_object_or_404(Meeting, pk=pk)
        self.require_run(meeting)
        project = self.valid(ActionToTaskSerializer)["project"]
        work = work_access_for(request)
        require(work.can_create_task(project), _("You cannot create tasks in this project."))
        with transaction.atomic():
            item = get_object_or_404(MeetingAction.objects.select_for_update(of=("self",)), pk=action_id, meeting=meeting)
            if item.task_id is not None:
                raise ValidationError({"detail": _("This action is already a task.")})
            may_set_due_date = work.validates(project) and (work.is_admin or item.responsible_id != request.user.pk)
            workflow.action_to_task(item, request.user, project, may_set_due_date=may_set_due_date)
        return Response(ActionSerializer(self.action_of(meeting, item.pk)).data, status=201)


@extend_schema_view(
    list=extend_schema(summary="The excuses awaiting a decision (the Team Manager and the admins)"),
)
class ExcuseViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = ExcuseRowSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        access = meeting_access_for(self.request)
        require(access.can_decide_excuses(), _("The Team Manager decides the excuses."))
        rows = Attendance.objects.filter(excuse_status=ExcuseStatus.REQUESTED).select_related("meeting", "member")
        if not access.is_admin:
            rows = rows.exclude(member=self.request.user)
        return rows.order_by("excuse_requested_at", "id")

    @extend_schema(summary="Accept or refuse an excuse (the Team Manager; never their own)",
                   parameters=[OpenApiParameter("id", int, OpenApiParameter.PATH)], request=ExcuseDecisionSerializer,
                   responses=ExcuseRowSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        access = meeting_access_for(request)
        require(access.can_decide_excuses(), _("The Team Manager decides the excuses."))
        serializer = ExcuseDecisionSerializer(data=request.data)
        with transaction.atomic():
            attendance = get_object_or_404(
                Attendance.objects.select_for_update(of=("self",)).select_related("meeting", "member"),
                pk=pk, excuse_status=ExcuseStatus.REQUESTED,
            )
            require(access.can_decide(attendance), _("Another person decides your own excuse."))
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            workflow.decide_excuse(attendance, request.user, data["accept"], data.get("note", ""), timezone.now())
        return Response(ExcuseRowSerializer(attendance).data)


class MeetingRightsView(APIView):
    @extend_schema(summary="What the viewer may do with the sessions, for the screens", responses=MeetingRightsSerializer)
    def get(self, request):
        access = meeting_access_for(request)
        decides = access.can_decide_excuses()
        pending = 0
        if decides:
            rows = Attendance.objects.filter(excuse_status=ExcuseStatus.REQUESTED)
            pending = (rows if access.is_admin else rows.exclude(member=request.user)).count()
        data = {"schedule": access.can_schedule(), "decide_excuses": decides, "pending_excuses": pending}
        return Response(MeetingRightsSerializer(data).data)


class PresenceView(APIView):
    @extend_schema(
        summary="A member's presence score and attendance history (themselves, the bureau, the admins)",
        parameters=[
            OpenApiParameter("member", int, description="Default: the viewer."),
            OpenApiParameter("start", str, description="ISO date-time (default: 90 days ago)."),
            OpenApiParameter("end", str, description="ISO date-time (default: now)."),
        ],
        responses=PresenceSerializer,
    )
    def get(self, request):
        access = meeting_access_for(request)
        params = request.query_params
        member_id = params.get("member")
        if member_id and not member_id.isdigit():
            raise ValidationError({"member": _("A number is expected.")})
        member = get_object_or_404(Member, pk=int(member_id)) if member_id else request.user
        require(access.sees_presence_of(member.pk), _("You see your own presence only."))
        now = timezone.now()
        start = self.moment(params, "start", now - timedelta(days=PRESENCE_DAYS))
        end = self.moment(params, "end", now)
        counted = {row.pk for row in counted_attendances(member, start, end)}
        rows = (
            Attendance.objects.filter(member=member, meeting__starts_at__gte=start, meeting__starts_at__lt=end)
            .select_related("meeting").order_by("-meeting__starts_at", "-id")[:100]
        )
        history = [
            {"meeting": row.meeting, "status": row.status, "excuse_status": row.excuse_status,
             "counted": row.pk in counted}
            for row in rows
        ]
        data = {"member": member, "start": start, "end": end, "score": presence_score(member, start, end),
                "history": history}
        return Response(PresenceSerializer(data).data)

    @staticmethod
    def moment(params, name, default):
        value = params.get(name)
        if not value:
            return default
        try:
            parsed = parse_datetime(value)
        except ValueError:  # well formed but impossible, e.g. 2026-02-30T10:00
            parsed = None
        if parsed is None:
            raise ValidationError({name: _("A date and time is expected.")})
        return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)
