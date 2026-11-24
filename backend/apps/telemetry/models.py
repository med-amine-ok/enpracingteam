from django.db import models
from django.utils.translation import gettext
from django.utils.translation import gettext_lazy as _


class CompetitionEdition(models.Model):
    name = models.CharField(_("name"), max_length=255)
    year = models.IntegerField(_("year"))
    location = models.CharField(_("location"), max_length=255, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("competition edition")
        verbose_name_plural = _("competition editions")
        constraints = [
            models.UniqueConstraint(fields=["name", "year"], name="uq_competition_edition_name_year"),
        ]

    def __str__(self):
        return f"{self.name} {self.year}"


class TelemetrySession(models.Model):
    # NULL for test sessions outside a competition.
    competition_edition = models.ForeignKey(
        CompetitionEdition, null=True, blank=True,
        on_delete=models.PROTECT, related_name="sessions", verbose_name=_("competition edition"),
    )
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="telemetry_sessions", verbose_name=_("subsystem"),
    )
    session_date = models.DateField(_("session date"))
    session_type = models.CharField(_("session type"), max_length=150, blank=True)
    recorded_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="telemetry_sessions", verbose_name=_("recorded by")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("telemetry session")
        verbose_name_plural = _("telemetry sessions")
        indexes = [models.Index(fields=["session_date"], name="idx_telemetry_session_date")]

    def __str__(self):
        return f"{self.session_date} - {self.session_type or gettext('session')}"


class TelemetryDataPoint(models.Model):
    """High-volume table: bigint id, compact values."""
    id = models.BigAutoField(_("ID"), primary_key=True)
    telemetry_session = models.ForeignKey(
        TelemetrySession, on_delete=models.CASCADE, related_name="data_points", verbose_name=_("telemetry session")
    )
    timestamp_ms = models.BigIntegerField(_("timestamp (ms)"))
    sensor_name = models.CharField(_("sensor"), max_length=150)
    value = models.FloatField(_("value"))
    unit = models.CharField(_("unit"), max_length=50, blank=True)

    class Meta:
        verbose_name = _("data point")
        verbose_name_plural = _("data points")
        indexes = [
            models.Index(
                fields=["telemetry_session", "sensor_name", "timestamp_ms"],
                name="idx_telemetry_dp_sess_sens_t",
            ),
        ]

    def __str__(self):
        return f"{self.sensor_name} @ {self.timestamp_ms}"
