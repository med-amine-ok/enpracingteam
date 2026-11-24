from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member
from apps.members.serializers import MemberSummarySerializer

from .access import discipline_access_for
from .models import Exclusion, Ground, MemberWarning, Report, SeriousGround


class DisciplineProjectSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class CouncilRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    starts_at = serializers.DateTimeField()
    location = serializers.CharField()


class BreachReportPermissionsSerializer(serializers.Serializer):
    handle = serializers.BooleanField(help_text="May give a warning from it, or dismiss it (the authority, while open).")


class BreachReportSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    reported_by = MemberSummarySerializer(read_only=True, allow_null=True)
    handled_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = [
            "id", "member", "ground", "facts", "reported_by", "created_at", "status", "handled_by", "handled_at",
            "handling_note", "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(BreachReportPermissionsSerializer)
    def get_permissions(self, report):
        access = discipline_access_for(self.context["request"])
        return {"handle": report.status == "open" and access.handles(report)}


class MemberWarningPermissionsSerializer(serializers.Serializer):
    respond = serializers.BooleanField(help_text="May write their response (the member, while active).")
    record_council = serializers.BooleanField(help_text="May record the council's decision (a second warning).")
    cancel = serializers.BooleanField(help_text="May cancel it (the Bureau, the admins).")


class MemberWarningSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    issued_by = MemberSummarySerializer(read_only=True, allow_null=True)
    project = DisciplineProjectSerializer(read_only=True, allow_null=True)
    council = serializers.SerializerMethodField()
    council_decided_by = MemberSummarySerializer(read_only=True, allow_null=True)
    cancelled_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = MemberWarning
        fields = [
            "id", "member", "level", "season", "ground", "rule", "facts", "expected", "project", "report", "issued_by",
            "issued_at", "status", "member_response", "responded_at", "council", "council_decision",
            "council_decided_by", "council_decided_at", "cancelled_by", "cancelled_at", "cancel_reason",
            "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(CouncilRefSerializer(allow_null=True))
    def get_council(self, warning):
        meeting = warning.council
        if meeting is None:
            return None
        return {"id": meeting.pk, "starts_at": meeting.starts_at, "location": meeting.location}

    @extend_schema_field(MemberWarningPermissionsSerializer)
    def get_permissions(self, warning):
        access = discipline_access_for(self.context["request"])
        active = warning.status == "active"
        return {
            "respond": active and access.is_viewer(warning.member_id),
            "record_council": active and warning.council_id is not None and access.can_record_council(warning),
            "cancel": active and access.sees_all(),
        }


class ExclusionPermissionsSerializer(serializers.Serializer):
    decide = serializers.BooleanField(help_text="May confirm or abandon it (the Bureau, the admins, while pending).")


class ExclusionSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    # Empty for an exclusion that comes from a third warning.
    serious_ground = serializers.ChoiceField(choices=SeriousGround.choices, allow_blank=True, read_only=True)
    proposed_by = MemberSummarySerializer(read_only=True, allow_null=True)
    decided_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Exclusion
        fields = [
            "id", "member", "cause", "warning", "serious_ground", "facts", "proposed_by", "proposed_at", "status",
            "decided_by", "decided_at", "decision_note", "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(ExclusionPermissionsSerializer)
    def get_permissions(self, exclusion):
        access = discipline_access_for(self.context["request"])
        return {
            "decide": exclusion.status == "pending" and access.sees_all() and not access.is_viewer(exclusion.member_id)
        }


@extend_schema_field(OpenApiTypes.INT)
class ActiveMemberField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        return Member.objects.filter(is_active=True)


class BreachReportCreateSerializer(serializers.Serializer):
    member_id = ActiveMemberField()
    ground = serializers.ChoiceField(choices=Ground.choices)
    facts = serializers.CharField()


class MemberWarningCreateSerializer(serializers.Serializer):
    member_id = ActiveMemberField()
    ground = serializers.ChoiceField(choices=Ground.choices)
    rule = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    facts = serializers.CharField()
    expected = serializers.CharField(required=False, allow_blank=True, default="")
    project_id = serializers.IntegerField(required=False, allow_null=True, help_text="For the Bureau; a project "
                                          "manager's warning takes their project.")
    report_id = serializers.IntegerField(required=False, allow_null=True)
    council_starts_at = serializers.DateTimeField(required=False, help_text="Needed for a second warning.")
    council_ends_at = serializers.DateTimeField(required=False)
    council_location = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class ExclusionCreateSerializer(serializers.Serializer):
    member_id = ActiveMemberField()
    serious_ground = serializers.ChoiceField(choices=SeriousGround.choices)
    facts = serializers.CharField()


class DisciplineNoteSerializer(serializers.Serializer):
    note = serializers.CharField(allow_blank=True)


class CancelReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=True)


class WarningResponseSerializer(serializers.Serializer):
    response = serializers.CharField(allow_blank=True)


class CouncilDecisionSerializer(serializers.Serializer):
    decision = serializers.CharField(allow_blank=True)


class DisciplineStandingSerializer(serializers.Serializer):
    member = MemberSummarySerializer()
    season = serializers.IntegerField(help_text="The year it starts: 2026 for 2026/2027.")
    active_warnings = serializers.IntegerField()
    next_level = serializers.IntegerField(help_text="4: already three, an exclusion follows.")
    can_report = serializers.BooleanField()
    can_issue = serializers.BooleanField()


class DisciplineTargetSerializer(serializers.Serializer):
    """A member the viewer may report, and perhaps warn."""

    id = serializers.IntegerField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    can_issue = serializers.BooleanField()


class DisciplineRightsSerializer(serializers.Serializer):
    report = serializers.BooleanField(help_text="Reports breaches (a leader, a project manager, the Bureau).")
    issue = serializers.BooleanField(help_text="Gives warnings (a project manager, the Bureau, the admins).")
    sees_all = serializers.BooleanField(help_text="The Bureau and the admins: everything, the exclusions too.")
    season = serializers.IntegerField()
    my_warnings = serializers.IntegerField(help_text="The viewer's active warnings this season.")

