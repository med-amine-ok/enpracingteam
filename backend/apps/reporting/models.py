from django.db import models


class SavedReport(models.Model):
    name = models.CharField(max_length=255)
    created_by = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="saved_reports"
    )
    config_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name