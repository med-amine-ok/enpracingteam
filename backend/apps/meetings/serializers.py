from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member, OrgUnit
from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer
from apps.projects.models import Project

from . import workflow
from .access import meeting_access_for
from .models import (
    Attendance, AttendanceStatus, ExcuseReason, ExcuseStatus, Meeting, MeetingAction, MeetingDecision, MeetingStatus,
)

MARKS = [AttendanceStatus.PRESENT, AttendanceStatus.LATE, AttendanceStatus.ABSENT]


class MyAttendanceSerializer(serializers.ModelSerializer):
    excuse_reason = serializers.ChoiceField(choices=ExcuseReason.choices, allow_blank=True, read_only=True)

    class Meta:
        model = Attendance
        fields = ["id", "status", "checked_in_at", "excuse_status", "excuse_reason"]
        read_only_fields = fields


class MeetingCountsSerializer(serializers.Serializer):
    invited = serializers.IntegerField()
    present = serializers.IntegerField()
    late = serializers.IntegerField()
    absent = serializers.IntegerField()
    excused = serializers.IntegerField(help_text="Excuses accepted.")


class MeetingPermissionsSerializer(serializers.Serializer):
    edit = serializers.BooleanField(help_text="May change or cancel it (the bureau and the admins).")
    run = serializers.BooleanField(help_text="May run it: invitees, attendance, minutes, decisions, actions.")
    check_in = serializers.BooleanField(help_text="May check in now.")
    ask_excuse = serializers.BooleanField()


class MeetingSerializer(serializers.ModelSerializer):
    """A session as listed, with the viewer's own attendance and what they may do."""

    org_unit = OrgUnitSummarySerializer(read_only=True, allow_null=True)
    organiser = MemberSummarySerializer(read_only=True)
    my_attendance = serializers.SerializerMethodField()
    counts = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Meeting
        fields = [
            "id", "title", "kind", "org_unit", "starts_at", "ends_at", "location", "is_mandatory", "is_critical",
            "status", "organiser", "attendance_confirmed_at", "minutes_published_at", "my_attendance", "counts",
            "permissions",
        ]
        read_only_fields = fields

    def mine(self, meeting):
        rows = getattr(meeting, "mine", None)
        if rows is None:
            viewer = self.context["request"].user
            rows = [row for row in meeting.attendances.all() if row.member_id == viewer.pk]
        return rows[0] if rows else None

    @extend_schema_field(MyAttendanceSerializer(allow_null=True))
    def get_my_attendance(self, meeting):
        mine = self.mine(meeting)
        return MyAttendanceSerializer(mine).data if mine else None

    @extend_schema_field(MeetingCountsSerializer)
    def get_counts(self, meeting):
        return {name: getattr(meeting, f"count_{name}", 0) for name in ("invited", "present", "late", "absent", "excused")}

    @extend_schema_field(MeetingPermissionsSerializer)
    def get_permissions(self, meeting):
        access = meeting_access_for(self.context["request"])
        now = self.context["now"]
        mine = self.mine(meeting)
        open_ = meeting.status == MeetingStatus.PLANNED
        return {
            "edit": open_ and access.can_schedule(),
            "run": open_ and access.can_run(meeting),
            "check_in": bool(
                open_ and mine is not None and mine.checked_in_at is None and meeting.attendance_confirmed_at is None
                and workflow.check_in_open(meeting, now)
            ),
            "ask_excuse": bool(
                open_ and mine is not None and mine.excuse_status != ExcuseStatus.ACCEPTED
                and workflow.may_ask_excuse(meeting, now)
            ),
        }


class AttendanceSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    marked_by = MemberSummarySerializer(read_only=True, allow_null=True)
    excuse_decided_by = MemberSummarySerializer(read_only=True, allow_null=True)
    excuse_reason = serializers.ChoiceField(choices=ExcuseReason.choices, allow_blank=True, read_only=True)

    class Meta:
        model = Attendance
        fields = [
            "id", "member", "status", "checked_in_at", "marked_by", "marked_at", "excuse_status", "excuse_reason",
            "excuse_note", "excuse_requested_at", "excuse_decided_by", "excuse_decided_at", "excuse_decision_note",
        ]
        read_only_fields = fields


class DecisionSerializer(serializers.ModelSerializer):
    created_by = MemberSummarySerializer(read_only=True, allow_null=True)

    class Meta:
        model = MeetingDecision
        fields = ["id", "text", "created_by", "created_at"]
        read_only_fields = ["id", "created_by", "created_at"]


class ActionTaskSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()


class ActionSerializer(serializers.ModelSerializer):
    responsible = MemberSummarySerializer(read_only=True, allow_null=True)
    task = serializers.SerializerMethodField()

    class Meta:
        model = MeetingAction
        fields = ["id", "description", "responsible", "due_date", "is_done", "done_at", "task", "created_at"]
        read_only_fields = fields

    @extend_schema_field(ActionTaskSerializer(allow_null=True))
    def get_task(self, action):
        return {"id": action.task.pk, "title": action.task.title} if action.task_id else None


class MeetingDetailSerializer(MeetingSerializer):
    created_by = MemberSummarySerializer(read_only=True, allow_null=True)
    attendance_confirmed_by = MemberSummarySerializer(read_only=True, allow_null=True)
    attendances = serializers.SerializerMethodField()
    decisions = DecisionSerializer(many=True, read_only=True)
    actions = ActionSerializer(many=True, read_only=True)

    class Meta(MeetingSerializer.Meta):
        fields = MeetingSerializer.Meta.fields + [
            "agenda", "cancel_reason", "minutes", "created_by", "created_at", "attendance_confirmed_by",
            "attendances", "decisions", "actions",
        ]
        read_only_fields = fields

    @extend_schema_field(AttendanceSerializer(many=True))
    def get_attendances(self, meeting):
        """Everyone's for those who run it (and the bureau), else the viewer's own."""
        rows = meeting.attendances.all()
        if not meeting_access_for(self.context["request"]).sees_everyone(meeting):
            viewer = self.context["request"].user
            rows = [row for row in rows if row.member_id == viewer.pk]
        return AttendanceSerializer(rows, many=True).data


class MeetingWriteSerializer(serializers.ModelSerializer):
    """Schedule or change a session (the bureau and the admins). The answer is the session as
    MeetingDetailSerializer shows it."""

    org_unit_id = serializers.PrimaryKeyRelatedField(
        source="org_unit", queryset=OrgUnit.objects.filter(is_active=True), allow_null=True, required=False,
        help_text="The invited unit, with the units below it; empty: the whole team.",
    )
    organiser_id = serializers.PrimaryKeyRelatedField(
        source="organiser", queryset=Member.objects.filter(is_active=True), required=False,
        help_text="Who runs it (default: who schedules it).",
    )

    class Meta:
        model = Meeting
        fields = [
            "title", "kind", "org_unit_id", "starts_at", "ends_at", "location", "agenda", "is_mandatory",
            "is_critical", "organiser_id",
        ]

    def validate(self, attrs):
        meeting = self.instance
        starts = attrs.get("starts_at", getattr(meeting, "starts_at", None))
        ends = attrs.get("ends_at", getattr(meeting, "ends_at", None))
        if starts is not None and ends is not None and ends <= starts:
            raise serializers.ValidationError({"ends_at": [_("A session ends after it starts.")]})
        return attrs


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)


class AttendanceMarkSerializer(serializers.Serializer):
    member_id = serializers.IntegerField()
    status = serializers.ChoiceField(choices=[(mark.value, mark.label) for mark in MARKS])


class AttendanceConfirmSerializer(serializers.Serializer):
    entries = AttendanceMarkSerializer(many=True, required=False, help_text="The marks; the others keep theirs.")


class InviteeSerializer(serializers.Serializer):
    member_id = serializers.PrimaryKeyRelatedField(source="member", queryset=Member.objects.filter(is_active=True))


class ExcuseSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=ExcuseReason.choices)
    note = serializers.CharField(required=False, allow_blank=True)


class ExcuseDecisionSerializer(serializers.Serializer):
    accept = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, help_text="Why it is refused (required then).")

    def validate(self, data):
        if not data["accept"] and not data.get("note", "").strip():
            raise serializers.ValidationError({"note": [_("Say why the excuse is refused.")]})
        return data


class ExcuseMeetingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Meeting
        fields = ["id", "title", "starts_at", "is_mandatory", "is_critical"]
        read_only_fields = fields


class ExcuseRowSerializer(serializers.ModelSerializer):
    """An excuse awaiting the Team Manager's decision."""

    meeting = ExcuseMeetingSerializer(read_only=True)
    member = MemberSummarySerializer(read_only=True)

    class Meta:
        model = Attendance
        fields = ["id", "meeting", "member", "status", "excuse_reason", "excuse_note", "excuse_requested_at"]
        read_only_fields = fields


class MinutesSerializer(serializers.Serializer):
    minutes = serializers.CharField(allow_blank=True)
    publish = serializers.BooleanField(default=False, help_text="Tell the invitees (the first time).")


class ActionWriteSerializer(serializers.ModelSerializer):
    responsible_id = serializers.PrimaryKeyRelatedField(
        source="responsible", queryset=Member.objects.filter(is_active=True), allow_null=True, required=False,
    )

    class Meta:
        model = MeetingAction
        fields = ["description", "responsible_id", "due_date", "is_done"]


class ActionToTaskSerializer(serializers.Serializer):
    project_id = serializers.PrimaryKeyRelatedField(source="project", queryset=Project.objects.all())


class PresenceMeetingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Meeting
        fields = ["id", "title", "kind", "starts_at", "is_mandatory", "is_critical", "status"]
        read_only_fields = fields


class PresenceRowSerializer(serializers.Serializer):
    meeting = PresenceMeetingSerializer()
    status = serializers.ChoiceField(choices=AttendanceStatus.choices)
    excuse_status = serializers.ChoiceField(choices=ExcuseStatus.choices)
    counted = serializers.BooleanField(help_text="Counts in the presence score.")


class PresenceSerializer(serializers.Serializer):
    member = MemberSummarySerializer()
    start = serializers.DateTimeField()
    end = serializers.DateTimeField()
    score = serializers.FloatField(allow_null=True, help_text="Out of 100; null: no mandatory session counted.")
    history = PresenceRowSerializer(many=True)


class MeetingRightsSerializer(serializers.Serializer):
    schedule = serializers.BooleanField(help_text="May schedule sessions (the bureau and the admins).")
    decide_excuses = serializers.BooleanField(help_text="Decides the excuses (the Team Manager and the admins).")
    pending_excuses = serializers.IntegerField(help_text="Excuses awaiting the viewer's decision.")
