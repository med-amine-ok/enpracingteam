from django.contrib import admin

from .models import ContributionPoint, MonthlyAssessment, MonthlyScore, RankingPublication


@admin.register(ContributionPoint)
class ContributionPointAdmin(admin.ModelAdmin):
    list_display = ("member", "points", "occurred_on", "status", "proposed_by", "decided_by")
    list_filter = ("status",)


@admin.register(MonthlyAssessment)
class MonthlyAssessmentAdmin(admin.ModelAdmin):
    list_display = ("member", "month", "communication_mark", "workshop_mark", "events_mark", "assessed_by")
    list_filter = ("month",)


class MonthlyScoreInline(admin.TabularInline):
    model = MonthlyScore
    extra = 0
    fields = ("member", "final", "ranking_score", "category", "rank", "provisional")
    readonly_fields = fields
    can_delete = False


@admin.register(RankingPublication)
class RankingPublicationAdmin(admin.ModelAdmin):
    list_display = ("month", "published_by", "published_at")
    inlines = [MonthlyScoreInline]
