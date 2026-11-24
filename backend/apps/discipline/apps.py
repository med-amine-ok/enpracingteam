from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class DisciplineConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.discipline"
    label = "discipline"
    verbose_name = _("Warnings and exclusions")
