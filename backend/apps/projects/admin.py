from django.contrib import admin

from .models import Project, ProjectMember


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "org_unit", "status", "project_manager", "start_date", "end_date")
    list_filter = ("category", "status")
    search_fields = ("name",)
    list_select_related = ("org_unit", "project_manager")


@admin.register(ProjectMember)
class ProjectMemberAdmin(admin.ModelAdmin):
    list_display = ("member", "project", "role", "is_active", "start_date", "end_date")
    list_filter = ("project", "is_active")
    search_fields = ("member__email", "member__first_name", "member__last_name")
    list_select_related = ("member", "project")
