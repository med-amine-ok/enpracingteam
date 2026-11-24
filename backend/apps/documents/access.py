"""
Who may do what with the documents and the lessons learned (decisions D-015 and D-020):

- a document of the whole team (no unit, no project): every member;
- a document of a unit: its members (and those of the units below it) and its leaders (or those of a unit
  above it); of a project: the people of the project (its team, its manager, the members of its subsystems,
  the leaders of its unit or of its subsystems' units); of both: the people of either;
- always: the member who uploaded it, the Team Manager, the bureau and the admins;
- its author, the leaders of its unit, its project manager and the admins change it and upload its versions;
  its author or an admin deletes it;
- any member writes a lesson; its author, the leaders of its unit, the bureau and the admins correct it;
  its author or an admin deletes it.
"""

from django.db.models import Q

from apps.meetings.access import meeting_access_for
from apps.members.models import Membership, OrgUnit


class DocumentAccess:
    def __init__(self, request):
        meetings = meeting_access_for(request)
        self.work = meetings.work
        self.viewer = self.work.viewer
        self.is_admin = self.work.is_admin
        self.is_bureau = meetings.is_bureau
        self._units = None

    def is_viewer(self, member_id):
        return self.work.is_viewer(member_id)

    def sees_all(self):
        return self.is_admin or self.is_bureau

    @property
    def unit_ids(self):
        """The units the viewer belongs to (active memberships), every unit above them, and the units they lead."""
        if self._units is None:
            above = set()
            if self.work.authenticated:
                parents = dict(OrgUnit.objects.values_list("pk", "parent_id"))
                for unit_id in Membership.objects.filter(member=self.viewer, end_date__isnull=True).values_list(
                    "org_unit_id", flat=True
                ):
                    while unit_id is not None and unit_id not in above:
                        above.add(unit_id)
                        unit_id = parents.get(unit_id)
            self._units = above | self.work.led_unit_ids
        return self._units

    # --- Documents ---

    def manages(self, document):
        """The leaders of its unit (or of a unit above it), its project manager, the admins."""
        if self.is_admin:
            return True
        project = document.project
        if project is not None and self.is_viewer(project.project_manager_id):
            return True
        if document.org_unit_id is not None:
            return self.work.leads(document.org_unit_id)
        if project is None:
            return self.is_bureau  # a document of the whole team
        return self.work.leads(project.org_unit_id)

    def can_edit(self, document):
        return self.is_viewer(document.uploaded_by_id) or self.manages(document)

    def can_delete(self, document):
        return self.is_admin or self.is_viewer(document.uploaded_by_id)

    def visible(self, documents):
        """The documents the viewer sees, in the lists and to download."""
        if self.sees_all():
            return documents
        return documents.filter(
            Q(org_unit__isnull=True, project__isnull=True) | Q(uploaded_by=self.viewer)
            | Q(org_unit_id__in=self.unit_ids) | Q(project_id__in=self.work.project_ids)
            | Q(project__org_unit_id__in=self.work.led_unit_ids)
        )

    # --- Lessons learned ---

    def can_edit_lesson(self, lesson):
        return (
            self.sees_all() or self.is_viewer(lesson.author_id)
            or (lesson.org_unit_id is not None and self.work.leads(lesson.org_unit_id))
        )

    def can_delete_lesson(self, lesson):
        return self.is_admin or self.is_viewer(lesson.author_id)


def document_access_for(request):
    access = getattr(request, "_document_access", None)
    if access is None:
        access = DocumentAccess(request)
        request._document_access = access
    return access
