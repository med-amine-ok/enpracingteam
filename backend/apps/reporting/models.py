from django.db import models
from django.utils.translation import gettext_lazy as _


class SavedReport(models.Model):
    name = models.CharField(_("name"), max_length=255)
    created_by = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="saved_reports", verbose_name=_("created by")
    )
    config_json = models.JSONField(_("configuration"), default=dict)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("saved report")
        verbose_name_plural = _("saved reports")

    def __str__(self):
        return self.name
