from django.contrib import admin

from .models import Objective, Training, VolunteeringActivity


@admin.register(Objective)
class ObjectiveAdmin(admin.ModelAdmin):
    list_display = ("member", "title", "season", "progress", "status", "set_by")
    list_filter = ("season", "status")
    search_fields = ("title", "member__first_name", "member__last_name")


@admin.register(Training)
class TrainingAdmin(admin.ModelAdmin):
    list_display = ("member", "topic", "status", "followed_on")
    list_filter = ("status",)
    search_fields = ("topic", "member__first_name", "member__last_name")


@admin.register(VolunteeringActivity)
class VolunteeringActivityAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "date", "organiser", "status")
    list_filter = ("status", "kind")
    filter_horizontal = ("participants",)
