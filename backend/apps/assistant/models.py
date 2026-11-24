"""
The team's assistant (decision D-021, knowledge base: PROJECTS/ERP/assistant_design.md): the sources the
Executive Bureau drops in (the charter, the competition's rules book and documents, season by season), read into
passages and their vectors; and each member's conversations, which only they read.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models
from django.utils.text import get_valid_filename
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy
from pgvector.django import VectorField

from apps.documents.models import current_season

# bge-m3 gives 1024 numbers per passage; the fake stand-in (llm.py) as many.
DIMENSIONS = 1024


class SourceStatus(models.TextChoices):
    # Context: state of a source (French la source: feminine; Arabic المصدر: masculine).
    READING = "reading", pgettext_lazy("source status", "Being read")
    READY = "ready", pgettext_lazy("source status", "Ready")
    FAILED = "failed", pgettext_lazy("source status", "Failed")


def source_path(source, filename):
    """assistant/<random>/<file name>: the name kept readable, never guessable."""
    name = get_valid_filename(PurePath(filename).name) or "file"
    return f"assistant/{uuid.uuid4().hex}/{name}"


class AssistantSource(models.Model):
    """A file the assistant answers from: the charter, a rules book, a document of the competition."""

    title = models.CharField(_("title"), max_length=255)
    season = models.PositiveSmallIntegerField(
        _("season"), default=current_season, help_text=_("The year it starts: 2026 for 2026/2027."),
    )
    file = models.FileField(_("file"), upload_to=source_path, max_length=300)
    file_name = models.CharField(_("file name"), max_length=255)
    size = models.PositiveBigIntegerField(_("size"), help_text=_("In bytes."))
    status = models.CharField(_("status"), max_length=20, choices=SourceStatus.choices, default=SourceStatus.READING)
    error = models.TextField(_("error"), blank=True)
    pages = models.PositiveIntegerField(_("pages"), default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="assistant_sources",
        verbose_name=_("uploaded by"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    read_at = models.DateTimeField(_("read at"), null=True, blank=True)

    class Meta:
        ordering = ["-season", "title", "id"]
        verbose_name = _("assistant source")
        verbose_name_plural = _("assistant sources")

    def __str__(self):
        return f"{self.title} ({self.season})"


class SourcePassage(models.Model):
    """A piece of a source's text (about 1,000 characters) with its vector, found by the questions near it."""

    source = models.ForeignKey(AssistantSource, on_delete=models.CASCADE, related_name="passages",
                               verbose_name=_("source"))
    page = models.PositiveIntegerField(_("page"), null=True, blank=True)
    position = models.PositiveIntegerField(_("position"))
    text = models.TextField(_("text"))
    embedding = VectorField(_("vector"), dimensions=DIMENSIONS)

    class Meta:
        ordering = ["source", "position"]
        verbose_name = _("source passage")
        verbose_name_plural = _("source passages")

    def __str__(self):
        return f"{self.source} #{self.position}"


class Conversation(models.Model):
    """A member's questions and the assistant's answers: only that member reads it."""

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                               related_name="assistant_conversations", verbose_name=_("member"))
    title = models.CharField(_("title"), max_length=255)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        verbose_name = _("conversation")
        verbose_name_plural = _("conversations")

    def __str__(self):
        return self.title


class MessageRole(models.TextChoices):
    USER = "user", _("Question")
    ASSISTANT = "assistant", _("Answer")


class AssistantMessage(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages",
                                     verbose_name=_("conversation"))
    role = models.CharField(_("role"), max_length=20, choices=MessageRole.choices)
    content = models.TextField(_("content"))
    # The sources of an answer: [{"number", "source", "title", "season", "page"}].
    citations = models.JSONField(_("sources"), default=list, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = _("assistant message")
        verbose_name_plural = _("assistant messages")

    def __str__(self):
        return f"{self.get_role_display()}: {self.content[:40]}"
