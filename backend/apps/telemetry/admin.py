# apps/telemetry/admin.py
from django.contrib import admin
from .models import CompetitionEdition, TelemetryDataPoint, TelemetrySession

@admin.register(CompetitionEdition)
class CompetitionEditionAdmin(admin.ModelAdmin):
    list_display = ("name", "year", "location")

@admin.register(TelemetrySession)
class TelemetrySessionAdmin(admin.ModelAdmin):
    list_display = ("session_date", "session_type", "competition_edition", "subsystem", "recorded_by")

# TelemetryDataPoint is high-volume: no admin registration (browsing it in /admin/ would be painful).