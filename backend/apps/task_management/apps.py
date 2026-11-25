from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class TaskManagementConfig(AppConfig):
    """Work Orders, Deliverables, Milestones, dependencies, blockers, submissions and reviews
    (documentation/documentation_Tasks), with the confidential scoring in the PostgreSQL schema "ranking"."""

    name = "apps.task_management"
    label = "task_management"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = _("Work management")
