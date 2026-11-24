from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class MembersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.members"
    label = "members"
    verbose_name = _("Members")

    def ready(self):
        import apps.members.signals  # noqa: F401 — register signal handlers
        import apps.members.checks  # noqa: F401 — register system checks (SECRET_KEY strength)
        import apps.members.schema  # noqa: F401 — register the API docs authentication extension
