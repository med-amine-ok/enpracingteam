from django.db import models


class CompetitionEdition(models.Model):
    name = models.CharField(max_length=255)
    year = models.IntegerField()
    location = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["name", "year"], name="uq_competition_edition_name_year"),
        ]

    def __str__(self):
        return f"{self.name} {self.year}"


class TelemetrySession(models.Model):
    # NULL for test sessions outside a competition.
    competition_edition = models.ForeignKey(
        CompetitionEdition, null=True, blank=True,
        on_delete=models.PROTECT, related_name="sessions",
    )
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="telemetry_sessions",
    )
    session_date = models.DateField()
    session_type = models.CharField(max_length=150, blank=True)
    recorded_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="telemetry_sessions"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["session_date"], name="idx_telemetry_session_date")]

    def __str__(self):
        return f"{self.session_date} - {self.session_type or 'session'}"


class TelemetryDataPoint(models.Model):
    """High-volume table: bigint id, compact values."""
    id = models.BigAutoField(primary_key=True)
    telemetry_session = models.ForeignKey(
        TelemetrySession, on_delete=models.CASCADE, related_name="data_points"
    )
    timestamp_ms = models.BigIntegerField()
    sensor_name = models.CharField(max_length=150)
    value = models.FloatField()
    unit = models.CharField(max_length=50, blank=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["telemetry_session", "sensor_name", "timestamp_ms"],
                name="idx_telemetry_dp_sess_sens_t",
            ),
        ]

    def __str__(self):
        return f"{self.sensor_name} @ {self.timestamp_ms}"