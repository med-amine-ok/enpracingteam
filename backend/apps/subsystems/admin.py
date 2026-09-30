from django.contrib import admin

from .models import LifecycleStep, MemberSubsystem, Subsystem, SubsystemStepProgress


@admin.register(Subsystem)
class SubsystemAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "org_unit", "parent_subsystem", "status")
    list_filter = ("project", "org_unit", "status")
    search_fields = ("name",)
    list_select_related = ("project", "org_unit", "parent_subsystem")


@admin.register(LifecycleStep)
class LifecycleStepAdmin(admin.ModelAdmin):
    list_display = ("step_order", "name", "applies_to_ic", "applies_to_ev")


@admin.register(SubsystemStepProgress)
class SubsystemStepProgressAdmin(admin.ModelAdmin):
    list_display = ("subsystem", "lifecycle_step", "is_complete", "completed_at", "validated_by")
    list_filter = ("lifecycle_step", "is_complete")
    search_fields = ("subsystem__name",)
    list_select_related = ("subsystem", "lifecycle_step", "validated_by")


@admin.register(MemberSubsystem)
class MemberSubsystemAdmin(admin.ModelAdmin):
    list_display = ("member", "subsystem", "member_level", "start_date", "end_date")
    list_filter = ("subsystem", "member_level")
    search_fields = ("member__email", "member__first_name", "member__last_name")
    list_select_related = ("member", "subsystem")