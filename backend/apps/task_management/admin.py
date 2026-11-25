"""Django admin: read-mostly. The workflows go through the API (services/), which checks and logs them; the
scoring tables are not registered here (they belong to the separate scoring workspace)."""

from django.contrib import admin

from .models import (
    ActivityLog, Assignment, Blocker, Deliverable, DependencyLink, Milestone, ProjectDepartment, ReliefInterval, Season,
    Submission, WorkOrder,
)


@admin.register(Season)
class SeasonAdmin(admin.ModelAdmin):
    list_display = ["label", "year", "is_active", "scoring_cutoff_at"]


@admin.register(ProjectDepartment)
class ProjectDepartmentAdmin(admin.ModelAdmin):
    list_display = ["project", "org_unit"]
    list_select_related = ["project", "org_unit"]


class ReadOnlyWorkflow(admin.ModelAdmin):
    """The status fields move only through the API's actions."""

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(WorkOrder)
class WorkOrderAdmin(ReadOnlyWorkflow):
    list_display = ["code", "title", "department", "season", "status", "proposal_status"]
    list_filter = ["status", "season", "department"]
    search_fields = ["code", "title"]


@admin.register(Deliverable)
class DeliverableAdmin(ReadOnlyWorkflow):
    list_display = ["code", "title", "work_order", "status", "dep_state", "execution_state", "progress"]
    list_filter = ["status", "dep_state", "execution_state"]
    search_fields = ["code", "title"]


@admin.register(Milestone)
class MilestoneAdmin(ReadOnlyWorkflow):
    list_display = ["title", "deliverable", "is_completed", "is_cancelled"]


@admin.register(Assignment)
class AssignmentAdmin(ReadOnlyWorkflow):
    list_display = ["deliverable", "member", "role", "is_active"]


@admin.register(Submission)
class SubmissionAdmin(ReadOnlyWorkflow):
    list_display = ["deliverable", "submission_number", "is_complete", "submitted_by", "submitted_at"]


@admin.register(DependencyLink)
class DependencyLinkAdmin(ReadOnlyWorkflow):
    list_display = ["prerequisite", "dependent", "link_type", "release_condition", "link_status", "released_at"]


@admin.register(ReliefInterval)
class ReliefIntervalAdmin(ReadOnlyWorkflow):
    list_display = ["deliverable", "status", "approved_start", "approved_end", "approved_days"]


@admin.register(Blocker)
class BlockerAdmin(ReadOnlyWorkflow):
    list_display = ["description", "deliverable", "work_order", "severity", "impact", "status"]


@admin.register(ActivityLog)
class ActivityLogAdmin(ReadOnlyWorkflow):
    list_display = ["occurred_at", "entity_type", "entity_id", "action", "actor"]
    list_filter = ["entity_type", "action"]
