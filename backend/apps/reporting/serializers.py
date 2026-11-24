"""The shapes of the dashboard and of the reports, for the screens and the API's documentation."""

from rest_framework import serializers

from apps.members.serializers import MemberSummarySerializer

COLOURS = [("green", "green"), ("orange", "orange"), ("red", "red"), ("neutral", "neutral")]
MEMBER_STATUSES = [("active", "active"), ("at_risk", "at risk"), ("inactive", "inactive")]
WARNING_KINDS = [(kind, kind) for kind in (
    "critical_blocked", "department_overdue_critical", "member_inactive", "member_overdue", "member_at_risk",
    "knowledge_concentration", "workload", "deadline_close",
)]


class ReportingRightsSerializer(serializers.Serializer):
    dashboard = serializers.BooleanField(help_text="Sees the dashboard (the whole team, or their departments).")
    reports = serializers.BooleanField(help_text="Sees the team's reports (the Team Manager, the bureau, the admins).")


class IndicatorSerializer(serializers.Serializer):
    value = serializers.FloatField(allow_null=True)
    total = serializers.IntegerField(allow_null=True, help_text="Out of how many (members), when it is a share.")
    status = serializers.ChoiceField(choices=COLOURS)


class IndicatorsSerializer(serializers.Serializer):
    active_members = IndicatorSerializer()
    inactive_members = IndicatorSerializer(help_text="Inactive or at risk.")
    attendance_rate = IndicatorSerializer(help_text="In %, the last 30 days.")
    completion_rate = IndicatorSerializer(help_text="In %: the tasks due in the last 30 days that are validated.")
    overdue_tasks = IndicatorSerializer()
    blocked_tasks = IndicatorSerializer()
    critical_tasks = IndicatorSerializer(help_text="4 or 5 points, not validated.")
    members_without_objectives = IndicatorSerializer(help_text="No goal in progress this season.")
    unresolved_blockers = IndicatorSerializer()


class RefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class TaskRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()


class UnitRefSerializer(RefSerializer):
    type = serializers.CharField()


class WarningSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=WARNING_KINDS)
    severity = serializers.ChoiceField(choices=COLOURS)
    member = MemberSummarySerializer(allow_null=True)
    task = TaskRefSerializer(allow_null=True)
    department = RefSerializer(allow_null=True)
    count = serializers.IntegerField(allow_null=True)
    days = serializers.IntegerField(allow_null=True)


class DepartmentRowSerializer(serializers.Serializer):
    unit = UnitRefSerializer()
    members = serializers.IntegerField()
    validated = serializers.IntegerField(help_text="Tasks validated in the last 30 days.")
    in_progress = serializers.IntegerField(help_text="Tasks not validated yet.")
    overdue = serializers.IntegerField()
    critical = serializers.IntegerField()
    blockers = serializers.IntegerField(help_text="Unresolved.")
    attendance_rate = serializers.FloatField(allow_null=True)
    status = serializers.ChoiceField(choices=COLOURS)


class MemberRowSerializer(serializers.Serializer):
    member = MemberSummarySerializer()
    status = serializers.ChoiceField(choices=MEMBER_STATUSES)
    last_activity = serializers.DateTimeField(allow_null=True)
    units = serializers.ListField(child=serializers.CharField())
    overdue = serializers.IntegerField()
    open_tasks = serializers.IntegerField()
    open_points = serializers.IntegerField()


class DashboardSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=[("team", "team"), ("department", "department")])
    generated_at = serializers.DateTimeField()
    overall = serializers.ChoiceField(choices=COLOURS)
    indicators = IndicatorsSerializer()
    warnings = WarningSerializer(many=True)
    departments = DepartmentRowSerializer(many=True)
    members = MemberRowSerializer(many=True)


class ReportTaskSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    project = serializers.CharField()
    department = serializers.CharField()
    points = serializers.IntegerField(allow_null=True)
    quality_mark = serializers.IntegerField(allow_null=True)
    due_date = serializers.DateField(allow_null=True)
    people = serializers.ListField(child=serializers.CharField())
    days_late = serializers.IntegerField(required=False)


class ReportBlockerSerializer(serializers.Serializer):
    task = TaskRefSerializer()
    description = serializers.CharField()
    severity = serializers.CharField()
    status = serializers.CharField()
    reported_at = serializers.DateTimeField()
    resolved_at = serializers.DateTimeField(allow_null=True)


class WeeklyReportSerializer(serializers.Serializer):
    kind = serializers.CharField()
    title = serializers.CharField()
    language = serializers.CharField()
    start = serializers.DateField()
    end = serializers.DateField()
    generated_at = serializers.DateTimeField()
    overall = serializers.ChoiceField(choices=COLOURS)
    indicators = IndicatorsSerializer()
    achievements = ReportTaskSerializer(many=True)
    delayed = ReportTaskSerializer(many=True)
    critical_blockers = ReportBlockerSerializer(many=True)
    attention = MemberRowSerializer(many=True)
    departments = DepartmentRowSerializer(many=True)
    workload = WarningSerializer(many=True)
    risks = WarningSerializer(many=True)
    priorities = ReportTaskSerializer(many=True)


class MonthlyMemberSerializer(serializers.Serializer):
    member = MemberSummarySerializer()
    units = serializers.ListField(child=serializers.CharField())
    status = serializers.ChoiceField(choices=MEMBER_STATUSES)
    validated = serializers.IntegerField()
    delivered_points = serializers.FloatField(help_text="Σ points × quality mark ÷ 5 of the tasks validated.")
    presence = serializers.FloatField(allow_null=True)
    open_tasks = serializers.IntegerField()


class MonthlyDepartmentSerializer(serializers.Serializer):
    unit = UnitRefSerializer()
    validated = serializers.IntegerField()
    delivered_points = serializers.FloatField()
    overdue = serializers.IntegerField()
    attendance_rate = serializers.FloatField(allow_null=True)


class TrendSerializer(serializers.Serializer):
    start = serializers.DateField()
    attendance_rate = serializers.FloatField(allow_null=True)
    validated = serializers.IntegerField()
    created = serializers.IntegerField()


class ProjectProgressSerializer(serializers.Serializer):
    project = RefSerializer()
    tasks = serializers.IntegerField()
    validated = serializers.IntegerField()
    progress = serializers.FloatField()


class MonthlyReportSerializer(serializers.Serializer):
    kind = serializers.CharField()
    title = serializers.CharField()
    language = serializers.CharField()
    month = serializers.CharField()
    start = serializers.DateField()
    end = serializers.DateField()
    generated_at = serializers.DateTimeField()
    members = MonthlyMemberSerializer(many=True)
    departments = MonthlyDepartmentSerializer(many=True)
    trends = TrendSerializer(many=True)
    major_blockers = ReportBlockerSerializer(many=True)
    projects = ProjectProgressSerializer(many=True)
    risks = WarningSerializer(many=True)
