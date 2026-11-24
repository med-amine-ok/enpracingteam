from django.utils.translation import gettext_lazy as _
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.projects.access import work_access_for

# The steps of a task, its links and its blockers: each action checks its own rights and the step
# (apps/tasks/views.py).
WORKFLOW_ACTIONS = {
    "start", "submit", "validate", "revise", "links", "blockers", "decide_blocker", "resolve_blocker", "progress",
}


class TaskPermission(BasePermission):
    """Rights on an existing task. Creating one is checked in the view, once its project is known;
    comments, steps, links and blockers in their own actions."""

    def has_object_permission(self, request, view, task):
        if request.method in SAFE_METHODS or view.action in ("comment", "delete_comment", *WORKFLOW_ACTIONS):
            return True
        access = work_access_for(request)
        if view.action == "destroy":
            self.message = _("You cannot delete this task.")
            return access.can_delete_task(task)
        if access.is_assigned(task) and not access.can_edit_task(task):
            self.message = _("As an assignee, you move this task forward through its steps: start, submit, blockers.")
            return False
        self.message = _("You cannot change this task.")
        return access.can_edit_task(task)
