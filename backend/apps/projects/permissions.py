"""DRF permission classes: the rules of access.py applied before a request is handled, so that a
refused action answers 403 (with a translated message) before its data is even checked."""

from django.utils.translation import gettext_lazy as _
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .access import work_access_for


class ProjectPermission(BasePermission):
    def has_permission(self, request, view):
        if view.action == "create" and not work_access_for(request).can_create_project():
            self.message = _("Only club admins can create projects.")
            return False
        return True

    def has_object_permission(self, request, view, project):
        if request.method in SAFE_METHODS:
            return True
        self.message = _("You cannot change this project.")
        return work_access_for(request).can_edit_project(project)
