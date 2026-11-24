from django.utils.translation import gettext_lazy as _
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.projects.access import work_access_for


class SubsystemPermission(BasePermission):
    """Status changes need the edit right; ticking lifecycle steps is checked step by step in the view."""

    def has_object_permission(self, request, view, subsystem):
        if request.method in SAFE_METHODS or view.action == "step":
            return True
        self.message = _("You cannot change this subsystem.")
        return work_access_for(request).can_edit_subsystem(subsystem)
