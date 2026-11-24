"""
The versions of a document (decisions D-015 and D-020): each file uploaded becomes the document's current
version at once; nothing is reviewed. The older versions stay in its history.
"""

import mimetypes
from pathlib import PurePath

from django.conf import settings
from django.db.models import Max
from django.utils.translation import gettext as _
from rest_framework.exceptions import ValidationError

from .models import DocumentStatus, DocumentVersion

# What may be uploaded: documents, pictures and videos, CAD and archives; never programs or web pages.
ALLOWED_EXTENSIONS = {
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "txt", "csv", "md",
    "png", "jpg", "jpeg", "gif", "webp", "heic", "mp4", "mov",
    "sldprt", "sldasm", "slddrw", "step", "stp", "iges", "igs", "stl", "dxf", "dwg", "f3d", "ipt", "iam",
    "zip", "7z", "rar",
}


def check_file(upload):
    """The size (DOCUMENT_MAX_UPLOAD_MB) and the kind of an uploaded file."""
    limit = settings.DOCUMENT_MAX_UPLOAD_MB
    if upload.size > limit * 1024 * 1024:
        raise ValidationError({"file": [_("The file is larger than %(limit)s MB.") % {"limit": limit}]})
    extension = PurePath(upload.name).suffix.lower().lstrip(".")
    if extension not in ALLOWED_EXTENSIONS:
        raise ValidationError({"file": [_("This kind of file is not accepted (%(extension)s).") % {
            "extension": extension or "?"}]})


def add_version(document, upload, actor, note=""):
    """A new version of `document` (number + 1), its current version from now on."""
    check_file(upload)
    number = (document.versions.aggregate(last=Max("number"))["last"] or 0) + 1
    content_type = upload.content_type or mimetypes.guess_type(upload.name)[0] or ""
    version = DocumentVersion.objects.create(
        document=document, number=number, file=upload, file_name=PurePath(upload.name).name[:255],
        size=upload.size, content_type=content_type[:100], note=note, uploaded_by=actor,
        status=DocumentStatus.APPROVED,
    )
    document.current_version = version
    document.status = DocumentStatus.APPROVED
    document.save(update_fields=["current_version", "status", "updated_at"])
    return version
