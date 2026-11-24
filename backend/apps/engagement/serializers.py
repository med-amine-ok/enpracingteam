from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.discipline.models import Ground, WarningStatus
from apps.meetings.models import AttendanceStatus, Meeting, MeetingKind
from apps.members.models import Member
from apps.members.serializers import MemberDetailSerializer, MemberSummarySerializer, OrgUnitSummarySerializer
from apps.ranking.models import Category
from apps.tasks.models import TaskStatus

from .access import engagement_access_for
from .models import (
    Objective, ObjectiveStatus, Training, TrainingStatus, VolunteeringActivity, VolunteeringKind, VolunteeringStatus,
)


def access_of(serializer):
    return engagement_access_for(serializer.context["request"])


@extend_schema_field(OpenApiTypes.INT)
class ActiveMemberField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        return Member.objects.filter(is_active=True)


# --- Goals ---


class GoalPermissionsSerializer(serializers.Serializer):
    progress = serializers.BooleanField(help_text="May move its progress forward (the member, while in progress).")
    assess = serializers.BooleanField(help_text="May change it and record its result (a head of the member).")


class GoalSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    set_by = MemberSummarySerializer(read_only=True, allow_null=True)
    assessed_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Objective
        fields = [
            "id", "member", "season", "title", "description", "measure", "due_date", "progress", "member_note",
            "status", "set_by", "assessment_note", "assessed_by", "assessed_at", "created_at", "updated_at",
            "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(GoalPermissionsSerializer)
    def get_permissions(self, goal):
        access = access_of(self)
        return {
            "progress": goal.status == ObjectiveStatus.IN_PROGRESS and access.is_viewer(goal.member_id),
            "assess": access.follows(goal.member_id),
        }


class GoalCreateSerializer(serializers.Serializer):
    member_id = ActiveMemberField()
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    measure = serializers.CharField(required=False, allow_blank=True, default="")
    due_date = serializers.DateField(required=False, allow_null=True, default=None)


class GoalChangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Objective
        fields = ["title", "description", "measure", "due_date", "progress", "member_note", "status", "assessment_note"]


# --- Trainings ---


class SessionRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    starts_at = serializers.DateTimeField()


class TrainingPermissionsSerializer(serializers.Serializer):
    manage = serializers.BooleanField(help_text="May plan it, mark it followed or drop it (a head, while open).")
    withdraw = serializers.BooleanField(help_text="May withdraw the wish (the member, before it is planned).")


class TrainingSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    session = SessionRefSerializer(read_only=True, allow_null=True)
    updated_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Training
        fields = [
            "id", "member", "topic", "reason", "status", "session", "followed_on", "note", "updated_by", "created_at",
            "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(TrainingPermissionsSerializer)
    def get_permissions(self, training):
        access = access_of(self)
        open_ = training.status in (TrainingStatus.WISHED, TrainingStatus.PLANNED)
        return {
            "manage": open_ and access.follows(training.member_id),
            "withdraw": training.status == TrainingStatus.WISHED and access.is_viewer(training.member_id),
        }


class TrainingCreateSerializer(serializers.Serializer):
    topic = serializers.CharField(max_length=255)
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    member_id = ActiveMemberField(required=False, help_text="For a head recording a member's training; oneself "
                                  "otherwise.")
    status = serializers.ChoiceField(choices=[TrainingStatus.WISHED, TrainingStatus.FOLLOWED],
                                     default=TrainingStatus.WISHED)
    followed_on = serializers.DateField(required=False, allow_null=True, default=None)


@extend_schema_field(OpenApiTypes.INT)
class TrainingSessionField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        return Meeting.objects.filter(kind=MeetingKind.TRAINING)


class TrainingPlanSerializer(serializers.Serializer):
    session_id = TrainingSessionField(required=False, allow_null=True, default=None,
                                        help_text="A \"Training\" session of Meetings.")
    note = serializers.CharField(required=False, allow_blank=True, default="")


class TrainingFollowSerializer(serializers.Serializer):
    followed_on = serializers.DateField(default=timezone.localdate)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class TrainingDropSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, default="")


# --- Volunteering ---


class VolunteeringPermissionsSerializer(serializers.Serializer):
    decide = serializers.BooleanField(help_text="May validate or refuse it (a head of its organiser, while proposed).")
    withdraw = serializers.BooleanField(help_text="May delete it (its organiser, while proposed).")


class VolunteeringSerializer(serializers.ModelSerializer):
    organiser = MemberSummarySerializer(read_only=True)
    participants = MemberSummarySerializer(read_only=True, many=True)
    decided_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = VolunteeringActivity
        fields = [
            "id", "title", "kind", "description", "date", "organiser", "participants", "status", "decided_by",
            "decided_at", "decision_note", "created_at", "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(VolunteeringPermissionsSerializer)
    def get_permissions(self, activity):
        access = access_of(self)
        proposed = activity.status == VolunteeringStatus.PROPOSED
        return {
            "decide": proposed and access.validates(activity),
            "withdraw": proposed and access.is_viewer(activity.organiser_id),
        }


class VolunteeringCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    kind = serializers.ChoiceField(choices=VolunteeringKind.choices)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    date = serializers.DateField()
    participant_ids = serializers.ListField(child=ActiveMemberField(), required=False, default=list,
                                            help_text="The other members who took part (the organiser is one).")


class VolunteeringRefuseSerializer(serializers.Serializer):
    note = serializers.CharField(allow_blank=True)


# --- Rights, members followed, charter issues ---


class EngagementRightsSerializer(serializers.Serializer):
    leads = serializers.BooleanField(help_text="Heads members: sets goals, plans trainings, validates volunteering.")
    sees_all = serializers.BooleanField(help_text="The Team Manager, the Bureau, the admins.")


class FollowedMemberSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    goals = serializers.IntegerField(help_text="Goals in progress this season.")
    volunteered = serializers.BooleanField(help_text="A validated volunteering this month.")


class CharterIssueSerializer(serializers.Serializer):
    membership_id = serializers.IntegerField(source="membership.pk")
    member = MemberSummarySerializer(source="membership.member")
    unit = OrgUnitSummarySerializer(source="membership.org_unit")
    role = serializers.CharField(source="membership.role.name")
    problems = serializers.ListField(child=serializers.CharField())


# --- The full member sheet ---


class SheetHealthSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["active", "at_risk", "inactive"], allow_null=True)
    last_activity = serializers.DateTimeField(allow_null=True)
    idle_days = serializers.IntegerField(allow_null=True)


class SheetTaskSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    status = serializers.ChoiceField(choices=TaskStatus.choices)
    due_date = serializers.DateField(allow_null=True)
    overdue = serializers.BooleanField()


class SheetTasksSerializer(serializers.Serializer):
    open = serializers.IntegerField()
    overdue = serializers.IntegerField()
    validated_recently = serializers.IntegerField(help_text="Validated in the last 30 days.")
    current = SheetTaskSerializer(many=True)


class SheetSessionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    starts_at = serializers.DateTimeField()
    status = serializers.ChoiceField(choices=AttendanceStatus.choices)


class SheetPresenceSerializer(serializers.Serializer):
    month = serializers.FloatField(allow_null=True)
    season = serializers.FloatField(allow_null=True)
    recent = SheetSessionSerializer(many=True)


class SheetScoreSerializer(serializers.Serializer):
    month = serializers.CharField()
    final = serializers.FloatField(allow_null=True)
    category = serializers.ChoiceField(choices=Category.choices, allow_blank=True)
    rank = serializers.IntegerField(allow_null=True)


class SheetContributionsSerializer(serializers.Serializer):
    season_points = serializers.IntegerField()
    scores = SheetScoreSerializer(many=True)


class SheetWarningSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    level = serializers.IntegerField()
    ground = serializers.ChoiceField(choices=Ground.choices)
    issued_at = serializers.DateTimeField()
    status = serializers.ChoiceField(choices=WarningStatus.choices)


class SheetActivitySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    kind = serializers.ChoiceField(choices=VolunteeringKind.choices)
    date = serializers.DateField()
    status = serializers.ChoiceField(choices=VolunteeringStatus.choices)


class SheetVolunteeringSerializer(serializers.Serializer):
    activities = SheetActivitySerializer(many=True)
    months_covered = serializers.ListField(child=serializers.CharField(), help_text="YYYY-MM")


class MemberSheetSerializer(serializers.Serializer):
    member = MemberDetailSerializer()
    season = serializers.IntegerField()
    health = SheetHealthSerializer()
    objectives = GoalSerializer(many=True)
    tasks = SheetTasksSerializer()
    presence = SheetPresenceSerializer()
    contributions = SheetContributionsSerializer()
    warnings = SheetWarningSerializer(many=True)
    trainings = TrainingSerializer(many=True)
    volunteering = SheetVolunteeringSerializer()
