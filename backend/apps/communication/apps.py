from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class CommunicationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.communication"
    label = "communication"
    verbose_name = _("Communication")