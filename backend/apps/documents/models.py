from django.db import models


class DocumentType(models.TextChoices):
    CAD = "cad", "CAD"
    REPORT = "report", "Report"
    TECHNICAL_DOC = "technical_doc", "Technical doc"
    DRAWING = "drawing", "Drawing"
    ADMIN = "admin", "Admin"
    FAQ = "faq", "FAQ"


class DocumentStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    IN_REVIEW = "in_review", "In review"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"


class Document(models.Model):
    title = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=DocumentType.choices)
    org_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True,
        on_delete=models.PROTECT, related_name="documents",
    )
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="documents",
    )
    uploaded_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="documents"
    )
    status = models.CharField(max_length=20, choices=DocumentStatus.choices, default=DocumentStatus.DRAFT)
    # Files live on Google Drive: we only store the link + metadata.
    drive_url = models.URLField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["status"], name="idx_document_status"),
            models.Index(fields=["type"], name="idx_document_type"),
        ]

    def __str__(self):
        return self.title