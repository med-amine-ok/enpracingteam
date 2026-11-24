from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class AssistantConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.assistant"
    label = "assistant"
    verbose_name = _("Team assistant")
