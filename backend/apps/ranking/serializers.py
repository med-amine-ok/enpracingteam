from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member
from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer

from .access import ranking_access_for
from .models import Category, ContributionPoint, MonthlyAssessment


class TaskEntrySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    points = serializers.IntegerField()
    quality = serializers.IntegerField(help_text="0 to 5; 0 when not delivered.")
    timing = serializers.FloatField(help_text="1.1 early, 1.0 on time, 0.8 / 0.5 / 0.2 late, 0 not delivered.")
    not_delivered = serializers.BooleanField()


class CriterionSerializer(serializers.Serializer):
    """A Team Contribution criterion: its mark, or N/A with its reason, or not given yet (missing)."""

    mark = serializers.IntegerField(allow_null=True)
    score = serializers.FloatField(allow_null=True)
    na = serializers.CharField(required=False)
    missing = serializers.BooleanField(required=False)


class ScoreDetailsSerializer(serializers.Serializer):
    tasks = TaskEntrySerializer(many=True)
    delivered_points = serializers.FloatField()
    reference_load = serializers.FloatField(allow_null=True)
    weeks_in_progress = serializers.IntegerField()
    weeks_updated = serializers.IntegerField()
    update_rate = serializers.FloatField(allow_null=True)
    communication_mark = serializers.IntegerField(allow_null=True, help_text="After the cap of the late blockers.")
    communication_cap = serializers.IntegerField()
    late_blockers = serializers.IntegerField()
    contribution_points = serializers.IntegerField()
    workshop = CriterionSerializer()
    events = CriterionSerializer()
    logistics_mark = serializers.IntegerField(allow_null=True)
    effort_mark = serializers.IntegerField(allow_null=True, help_text="2 at most without evidence.")


class ScoreSerializer(serializers.Serializer):
    """A member's month: its parts out of 100 (None: not calculable), its final score and where it ranks."""

    month = serializers.CharField(help_text="YYYY-MM")
    delivery = serializers.FloatField(allow_null=True)
    performance = serializers.FloatField(allow_null=True)
    load = serializers.FloatField(allow_null=True)
    presence = serializers.FloatField(allow_null=True)
    reliability = serializers.FloatField(allow_null=True)
    team = serializers.FloatField(allow_null=True)
    final = serializers.FloatField(allow_null=True)
    provisional = serializers.BooleanField()
    ranking_score = serializers.FloatField(allow_null=True)
    category = serializers.ChoiceField(choices=Category.choices, allow_blank=True)
    rank = serializers.IntegerField(allow_null=True)
    details = ScoreDetailsSerializer()


class HistorySerializer(serializers.Serializer):
    """A published month of a member."""

    month = serializers.CharField(help_text="YYYY-MM")
    delivery = serializers.FloatField(allow_null=True)
    presence = serializers.FloatField(allow_null=True)
    reliability = serializers.FloatField(allow_null=True)
    team = serializers.FloatField(allow_null=True)
    final = serializers.FloatField(allow_null=True)
    provisional = serializers.BooleanField()
    ranking_score = serializers.FloatField(allow_null=True)
    category = serializers.ChoiceField(choices=Category.choices, allow_blank=True)
    rank = serializers.IntegerField(allow_null=True)
    published_at = serializers.DateTimeField()


class MyRankingSerializer(serializers.Serializer):
    month = serializers.CharField(help_text="The month shown (YYYY-MM).")
    published = serializers.BooleanField(help_text="This month is published (else its score is provisional).")
    score = ScoreSerializer()
    history = HistorySerializer(many=True)


class AssessmentSerializer(serializers.ModelSerializer):
    assessed_by = MemberSummarySerializer(read_only=True, allow_null=True)

    class Meta:
        model = MonthlyAssessment
        fields = [
            "communication_mark", "workshop_mark", "workshop_na_reason", "events_mark", "events_na_reason",
            "logistics_mark", "effort_mark", "effort_evidence", "excused_weeks", "no_work_available", "note",
            "assessed_by", "updated_at",
        ]
        read_only_fields = ["assessed_by", "updated_at"]


class AssessmentWriteSerializer(AssessmentSerializer):
    month = serializers.RegexField(r"^\d{4}-\d{2}$", write_only=True, help_text="YYYY-MM")

    class Meta(AssessmentSerializer.Meta):
        fields = ["month", *AssessmentSerializer.Meta.fields]


class ContributionPermissionsSerializer(serializers.Serializer):
    decide = serializers.BooleanField(help_text="May validate or refuse them (who assesses the member, while proposed).")


class ContributionSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    proposed_by = MemberSummarySerializer(read_only=True, allow_null=True)
    decided_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = ContributionPoint
        fields = [
            "id", "member", "points", "description", "occurred_on", "proposed_by", "status", "decided_by",
            "decided_at", "decision_note", "created_at", "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(ContributionPermissionsSerializer)
    def get_permissions(self, point):
        access = ranking_access_for(self.context["request"])
        return {"decide": point.status == "proposed" and access.can_assess(point.member)}


class ContributionCreateSerializer(serializers.Serializer):
    member_id = serializers.PrimaryKeyRelatedField(queryset=Member.objects.filter(is_active=True))
    points = serializers.IntegerField(min_value=1, max_value=3)
    description = serializers.CharField()
    occurred_on = serializers.DateField(default=timezone.localdate)


class RejectSerializer(serializers.Serializer):
    note = serializers.CharField(allow_blank=True)

    def validate_note(self, note):
        if not note.strip():
            raise serializers.ValidationError(_("Say why they are refused."))
        return note


class MemberMonthPermissionsSerializer(serializers.Serializer):
    assess = serializers.BooleanField()


class MemberMonthSerializer(serializers.Serializer):
    member = MemberSummarySerializer()
    department = OrgUnitSummarySerializer(allow_null=True)
    month = serializers.CharField(help_text="YYYY-MM")
    published = serializers.BooleanField()
    score = ScoreSerializer()
    assessment = AssessmentSerializer(allow_null=True)
    contributions = ContributionSerializer(many=True)
    permissions = MemberMonthPermissionsSerializer()


class MonthRowSerializer(serializers.Serializer):
    member = MemberSummarySerializer()
    department = OrgUnitSummarySerializer(allow_null=True)
    delivery = serializers.FloatField(allow_null=True)
    presence = serializers.FloatField(allow_null=True)
    reliability = serializers.FloatField(allow_null=True)
    team = serializers.FloatField(allow_null=True)
    final = serializers.FloatField(allow_null=True)
    provisional = serializers.BooleanField()
    ranking_score = serializers.FloatField(allow_null=True)
    category = serializers.ChoiceField(choices=Category.choices, allow_blank=True)
    rank = serializers.IntegerField(allow_null=True)


class MonthTablePermissionsSerializer(serializers.Serializer):
    publish = serializers.BooleanField(help_text="May publish this month now (the Team Manager, once it is over).")


class MonthTableSerializer(serializers.Serializer):
    month = serializers.CharField(help_text="YYYY-MM")
    published_at = serializers.DateTimeField(allow_null=True)
    published_by = MemberSummarySerializer(allow_null=True)
    rows = MonthRowSerializer(many=True)
    permissions = MonthTablePermissionsSerializer()


class RankingRightsSerializer(serializers.Serializer):
    team = serializers.BooleanField(help_text="Sees a team's table (a leader, the Team Manager, the bureau).")
    publish = serializers.BooleanField(help_text="Publishes the months (the Team Manager, the admins).")
