from django.contrib import admin

from .models import Exclusion, MemberWarning, Report


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ("member", "ground", "reported_by", "created_at", "status")
    list_filter = ("status", "ground")


@admin.register(MemberWarning)
class MemberWarningAdmin(admin.ModelAdmin):
    list_display = ("member", "level", "season", "ground", "issued_by", "issued_at", "status")
    list_filter = ("season", "status", "ground")


@admin.register(Exclusion)
class ExclusionAdmin(admin.ModelAdmin):
    list_display = ("member", "cause", "status", "proposed_by", "proposed_at", "decided_by")
    list_filter = ("status", "cause")
