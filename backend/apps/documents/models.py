"""
The team's documents and knowledge (decisions D-015 and D-020, knowledge base: PROJECTS/ERP/documents_design.md):
all the team's files, uploaded to the ERP version by version and arranged by department, project and season,
each version published at once (nothing is reviewed since D-020); and the lessons learned ("Team Manager – ERP
Requirements" §10).
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.text import get_valid_filename
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy


class DocumentType(models.TextChoices):
    CAD = "cad", _("CAD")
    REPORT = "report", _("Report")
    TECHNICAL_DOC = "technical_doc", _("Technical doc")
    DRAWING = "drawing", _("Drawing")
    # Context: an administrative document, not the "Admin" role (Administrateur).
    ADMIN = "admin", pgettext_lazy("document type", "Admin")
    FAQ = "faq", _("FAQ")
    PROCEDURE = "procedure", _("Procedure")
    TUTORIAL = "tutorial", _("Tutorial")
    MEDIA = "media", _("Photo or video")
    # Context: another kind of document (French "Autre", masculine).
    OTHER = "other", pgettext_lazy("document type", "Other")


class DocumentStatus(models.TextChoices):
    # Each version is approved at once since D-020; the other statuses stay for the versions saved before.
    # Context: state of a document (French le document: masculine; Arabic الوثيقة: feminine).
    DRAFT = "draft", pgettext_lazy("document status", "Draft")
    IN_REVIEW = "in_review", pgettext_lazy("document status", "In review")
    APPROVED = "approved", pgettext_lazy("document status", "Approved")
    REJECTED = "rejected", pgettext_lazy("document status", "Rejected")


class KnowledgeCategory(models.TextChoices):
    """The categories of the knowledge repository (Team Manager – ERP Requirements §9)."""

    TEAM_MANAGEMENT = "team_management", _("Team management")
    MECHANICAL = "mechanical", _("Mechanical")
    ELECTRONICS = "electronics", _("Electronics")
    AERODYNAMICS = "aerodynamics", _("Aerodynamics")
    SOFTWARE = "software", _("Software")
    MANUFACTURING = "manufacturing", _("Manufacturing")
    SPONSORING = "sponsoring", _("Sponsoring")
    COMPETITION = "competition", _("Competition")
    ADMINISTRATION = "administration", _("Administration")
    PREVIOUS_PROJECTS = "previous_projects", _("Previous projects")


def current_season():
    """The season of today: the year it starts (September 1st), as the warnings count them."""
    from apps.discipline.models import season_of

    return season_of(timezone.localdate())


class Document(models.Model):
    title = models.CharField(_("title"), max_length=255)
    description = models.TextField(_("description"), blank=True)
    type = models.CharField(_("type"), max_length=20, choices=DocumentType.choices)
    category = models.CharField(_("category"), max_length=30, choices=KnowledgeCategory.choices, blank=True)
    org_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True,
        on_delete=models.PROTECT, related_name="documents", verbose_name=_("organisational unit"),
    )
    project = models.ForeignKey(
        "projects.Project", null=True, blank=True, on_delete=models.PROTECT, related_name="documents",
        verbose_name=_("project"),
    )
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="documents", verbose_name=_("subsystem"),
    )
    season = models.PositiveSmallIntegerField(
        _("season"), default=current_season, help_text=_("The year it starts: 2026 for 2026/2027."),
    )
    uploaded_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="documents", verbose_name=_("uploaded by")
    )
    # The status of its latest version (the list shows it); the version everyone sees is current_version.
    status = models.CharField(
        _("status"), max_length=20, choices=DocumentStatus.choices, default=DocumentStatus.DRAFT
    )
    current_version = models.ForeignKey(
        "DocumentVersion", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
        verbose_name=_("current version"), help_text=_("The latest approved version, which every member sees."),
    )
    # The files are uploaded to the ERP since 22/10/2026 (D-015); a link to Google Drive stays possible.
    drive_url = models.URLField(_("Google Drive link"), max_length=500, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        ordering = ["title", "id"]
        verbose_name = _("document")
        verbose_name_plural = _("documents")
        indexes = [
            models.Index(fields=["status"], name="idx_document_status"),
            models.Index(fields=["type"], name="idx_document_type"),
            models.Index(fields=["season"], name="idx_document_season"),
        ]

    def __str__(self):
        return self.title


def version_path(version, filename):
    """documents/<document>/<random>/<file name>: the name kept readable, never guessable."""
    name = get_valid_filename(PurePath(filename).name) or "file"
    return f"documents/{version.document_id}/{uuid.uuid4().hex}/{name}"


class DocumentVersion(models.Model):
    """One file of a document: it becomes the document's current version at once (D-020)."""

    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="versions",
                                 verbose_name=_("document"))
    number = models.PositiveIntegerField(_("number"))
    file = models.FileField(_("file"), upload_to=version_path, max_length=300)
    file_name = models.CharField(_("file name"), max_length=255)
    size = models.PositiveBigIntegerField(_("size"), help_text=_("In bytes."))
    content_type = models.CharField(_("content type"), max_length=100, blank=True)
    note = models.TextField(_("what changes"), blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="document_versions",
        verbose_name=_("uploaded by"),
    )
    uploaded_at = models.DateTimeField(_("uploaded at"), auto_now_add=True)
    status = models.CharField(_("status"), max_length=20, choices=DocumentStatus.choices,
                              default=DocumentStatus.DRAFT)
    submitted_at = models.DateTimeField(_("submitted at"), null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("reviewed by"),
    )
    reviewed_at = models.DateTimeField(_("reviewed at"), null=True, blank=True)
    review_note = models.TextField(_("review note"), blank=True)

    class Meta:
        ordering = ["document", "-number"]
        verbose_name = _("document version")
        verbose_name_plural = _("document versions")
        constraints = [
            models.UniqueConstraint(fields=["document", "number"], name="uq_document_version_number"),
        ]

    def __str__(self):
        return f"{self.document} v{self.number}"


class LessonLearned(models.Model):
    """What a problem taught the team (Team Manager – ERP Requirements §10)."""

    title = models.CharField(_("title"), max_length=255)
    problem = models.TextField(_("problem"))
    context = models.TextField(_("context"), blank=True)
    root_cause = models.TextField(_("root cause"), blank=True)
    solution = models.TextField(_("solution"), blank=True)
    result = models.TextField(_("result"), blank=True)
    next_time = models.TextField(_("what to do differently next time"), blank=True)
    org_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True, on_delete=models.PROTECT, related_name="lessons",
        verbose_name=_("responsible unit"),
    )
    project = models.ForeignKey(
        "projects.Project", null=True, blank=True, on_delete=models.SET_NULL, related_name="lessons",
        verbose_name=_("project"),
    )
    category = models.CharField(_("category"), max_length=30, choices=KnowledgeCategory.choices, blank=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="lessons", verbose_name=_("author")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = _("lesson learned")
        verbose_name_plural = _("lessons learned")

    def __str__(self):
        return self.title
