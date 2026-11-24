from django.contrib import admin

from .models import Attendance, Meeting, MeetingAction, MeetingDecision


class AttendanceInline(admin.TabularInline):
    model = Attendance
    extra = 0
    autocomplete_fields = ["member"]
    fields = ["member", "status", "checked_in_at", "excuse_status", "excuse_reason"]


class DecisionInline(admin.TabularInline):
    model = MeetingDecision
    extra = 0
    fields = ["text"]


class ActionInline(admin.TabularInline):
    model = MeetingAction
    extra = 0
    autocomplete_fields = ["responsible"]
    fields = ["description", "responsible", "due_date", "is_done"]


@admin.register(Meeting)
class MeetingAdmin(admin.ModelAdmin):
    list_display = ["title", "kind", "org_unit", "starts_at", "is_mandatory", "is_critical", "status"]
    list_filter = ["kind", "is_mandatory", "is_critical", "status"]
    search_fields = ["title", "location"]
    date_hierarchy = "starts_at"
    autocomplete_fields = ["organiser", "org_unit"]
    inlines = [AttendanceInline, DecisionInline, ActionInline]
