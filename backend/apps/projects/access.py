# apps/projects/access.py
"""
Who may do what on projects, subsystems and tasks. Single place for these rules (as
apps/members/access.py for members), used by the API, so they can be changed in one spot.

Every logged-in member sees every project, subsystem and task: the work of the team is shared.
(Personal contact details stay protected by apps/members/access.py.)

- Club admins (superusers, the "Admins" group, the Board of Directors and the Team Manager: decision D-025)
  may do everything.
- To "lead" a unit is to hold an active leadership role in it; it covers the units below it
  (the Formula Student team leaders lead every Formula Student department).
- Projects: created by club admins (the Board of Directors and the Team Manager, decision D-025), who name
  their manager (charter art. 2 and 6); their details (name, description, status, dates) are edited
  by admins and the project manager. Changing the owning unit or the manager: admins only.
- Subsystems: their status is edited by admins, the project manager and the leaders of the
  subsystem's unit. Lifecycle steps are ticked by those people and the members assigned to the
  subsystem; a step that requires validation ("Validation par le chef") only by admins and the
  leaders of the unit, and the steps after it wait for that validation.
- Tasks: created by the people involved in the project (admins, project manager, project team,
  leaders of the project's unit or of one of its subsystems' units, members assigned to one of its
  subsystems). Edited by admins, the
  project manager, the task's author and the leaders of the project's or the subsystem's unit; the
  people assigned to a task also move its status. Deleted by admins, the project manager and the
  task's author.
- Comments: written by any member, deleted by their author and club admins.
"""

from django.db.models import Q

from apps.members.access import is_club_admin
from apps.members.models import Membership, OrgUnit
from apps.subsystems.models import MemberSubsystem, Subsystem
from apps.tasks.models import OPEN_STATUSES, UNRESOLVED, BlockerStatus, TaskStatus

from .models import Project, ProjectMember


class WorkAccess:
    """Per-request answers to "may this viewer…?" about projects, subsystems and tasks.

    The viewer's admin status, led units, projects and subsystems are computed once (lazily), then
    every answer is a set lookup on objects already loaded by the view.
    """

    def __init__(self, viewer):
        self.viewer = viewer
        self.authenticated = bool(getattr(viewer, "is_authenticated", False))
        self.is_admin = is_club_admin(viewer)
        self._led_units = None
        self._project_ids = None
        self._subsystem_ids = None

    # --- What the viewer leads, belongs to, works on ---

    @property
    def led_unit_ids(self):
        """Units where the viewer holds an active leadership role, and every unit below them."""
        if self._led_units is None:
            self._led_units = set()
            if self.authenticated:
                roots = Membership.objects.filter(
                    member=self.viewer, end_date__isnull=True, role__is_leadership=True
                ).values_list("org_unit_id", flat=True)
                for unit in OrgUnit.objects.filter(pk__in=list(roots)):
                    self._led_units.update(unit.descendant_ids())
        return self._led_units

    @property
    def subsystem_ids(self):
        """Subsystems the viewer is currently assigned to."""
        if self._subsystem_ids is None:
            self._subsystem_ids = set()
            if self.authenticated:
                self._subsystem_ids = set(
                    MemberSubsystem.objects.filter(member=self.viewer, end_date__isnull=True).values_list(
                        "subsystem_id", flat=True
                    )
                )
        return self._subsystem_ids

    @property
    def project_ids(self):
        """Projects the viewer works on: their team, the ones they manage, those of their subsystems."""
        if self._project_ids is None:
            self._project_ids = set()
            if self.authenticated:
                self._project_ids |= set(
                    ProjectMember.objects.filter(member=self.viewer, is_active=True, end_date__isnull=True)
                    .values_list("project_id", flat=True)
                )
                self._project_ids |= set(
                    Project.objects.filter(project_manager=self.viewer).values_list("pk", flat=True)
                )
                # Projects with a subsystem they are assigned to, or owned by a unit they lead.
                self._project_ids |= set(
                    Subsystem.objects.filter(Q(pk__in=self.subsystem_ids) | Q(org_unit_id__in=self.led_unit_ids))
                    .values_list("project_id", flat=True)
                )
        return self._project_ids

    def leads(self, unit_id):
        return unit_id in self.led_unit_ids

    def is_viewer(self, member_id):
        return self.authenticated and member_id == self.viewer.pk

    # --- Projects ---

    def can_create_project(self):
        return self.is_admin

    def manages(self, project):
        return self.is_viewer(project.project_manager_id)

    def can_edit_project(self, project):
        return self.is_admin or self.manages(project)

    def is_involved(self, project):
        return self.can_edit_project(project) or project.pk in self.project_ids or self.leads(project.org_unit_id)

    # --- Subsystems and lifecycle ---

    def can_edit_subsystem(self, subsystem):
        return self.can_edit_project(subsystem.project) or self.leads(subsystem.org_unit_id)

    def can_validate(self, subsystem):
        return self.is_admin or self.leads(subsystem.org_unit_id)

    def can_tick_step(self, subsystem, step):
        if step.requires_validation:
            return self.can_validate(subsystem)
        return self.can_edit_subsystem(subsystem) or subsystem.pk in self.subsystem_ids

    # --- Tasks ---

    def can_create_task(self, project):
        return self.is_involved(project)

    def can_edit_task(self, task):
        return (
            self.can_edit_project(task.project)
            or self.is_viewer(task.created_by_id)
            or self.leads(task.project.org_unit_id)
            or (task.subsystem_id is not None and self.leads(task.subsystem.org_unit_id))
        )

    def is_assigned(self, task):
        return any(self.is_viewer(assignee.member_id) for assignee in task.assignees.all())

    # --- The steps of a task and its blockers (decision D-012, knowledge base: tasks_v2_design.md) ---

    def validates(self, project, subsystem=None):
        """Leads the work of this project or subsystem: admins, the project manager, the leaders of the
        project's or the subsystem's unit (and of the units above)."""
        return (
            self.is_admin
            or self.manages(project)
            or self.leads(project.org_unit_id)
            or (subsystem is not None and self.leads(subsystem.org_unit_id))
        )

    def is_validator(self, task):
        """Sets the points and dates, validates the task and decides its blockers: one who leads its
        work, never on a task they are assigned to (admins excepted)."""
        if self.is_admin:
            return True
        return self.validates(task.project, task.subsystem) and not self.is_assigned(task)

    def works_on(self, task):
        """Starts and submits it: the people assigned to it, else those who manage it."""
        if self.is_assigned(task):
            return True
        return not task.assignees.all() and self.can_edit_task(task)

    def can_start(self, task):
        return self.is_assigned(task) or self.can_edit_task(task)

    def can_declare_blocker(self, task):
        return self.is_assigned(task) or self.can_edit_task(task)

    def can_add_link(self, task):
        return self.is_assigned(task) or self.can_edit_task(task)

    def can_resolve_blocker(self, blocker):
        return (
            self.is_viewer(blocker.responsible_id)
            or self.is_viewer(blocker.reported_by_id)
            or self.is_assigned(blocker.task)
            or self.is_validator(blocker.task)
        )

    def task_rights(self, task):
        """What the viewer may do with the task now (its status included), for the screens."""
        return {
            "edit": self.can_edit_task(task),
            "delete": self.can_delete_task(task),
            "comment": self.can_comment(task),
            "start": task.status == TaskStatus.PLANNED and self.can_start(task),
            "submit": task.status in (TaskStatus.IN_PROGRESS, TaskStatus.NEEDS_REVISION) and self.works_on(task),
            "validate": task.status == TaskStatus.SUBMITTED and self.is_validator(task),
            "estimate": task.status == TaskStatus.PLANNED and self.is_validator(task),
            "declare_blocker": task.status != TaskStatus.VALIDATED and self.can_declare_blocker(task),
            "update_progress": task.status in OPEN_STATUSES and self.can_update_progress(task),
        }

    def can_update_progress(self, task):
        """Its progress, phase and next step: who works on it and who manages it."""
        return self.works_on(task) or self.can_edit_task(task)

    def blocker_rights(self, blocker):
        return {
            "decide": blocker.status == BlockerStatus.OPEN and self.is_validator(blocker.task),
            "resolve": blocker.status in UNRESOLVED and self.can_resolve_blocker(blocker),
        }

    def can_delete_task(self, task):
        return self.is_admin or self.manages(task.project) or self.is_viewer(task.created_by_id)

    def can_comment(self, task):
        return self.authenticated

    def can_delete_comment(self, comment):
        return self.is_admin or self.is_viewer(comment.author_id)


def work_access_for(request):
    """WorkAccess cached on the request object (one per request)."""
    access = getattr(request, "_work_access", None)
    if access is None:
        access = WorkAccess(getattr(request, "user", None))
        request._work_access = access
    return access
