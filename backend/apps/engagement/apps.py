from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class EngagementConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.engagement"
    label = "engagement"
    verbose_name = _("Goals, trainings and volunteering")
