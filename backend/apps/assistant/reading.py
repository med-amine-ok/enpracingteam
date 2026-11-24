"""
Reading a source (decision D-021): its text page by page (a scanned page is read by the vision model), cut into
passages of about 1,000 characters, each with its vector. In a background thread, as a PDF of 200 pages takes
minutes; inline in the tests (ASSISTANT_READ_IN_BACKGROUND off).
"""

import io
import logging
import re
import threading
import zipfile
from pathlib import PurePath
from xml.etree import ElementTree

from django.conf import settings
from django.db import close_old_connections, transaction
from django.utils import timezone
from django.utils.translation import gettext as _
from PIL import Image
from pypdf import PdfReader, apply_configuration
from rest_framework.exceptions import ValidationError

from . import llm
from .models import AssistantSource, SourcePassage, SourceStatus

logger = logging.getLogger(__name__)

TEXT_FILES = {"txt", "md"}
IMAGE_FILES = {"png", "jpg", "jpeg"}
ALLOWED_EXTENSIONS = {"pdf", "docx"} | TEXT_FILES | IMAGE_FILES
SCANNED = 40  # characters: a PDF page with fewer is a picture, read by the vision model
PASSAGE_SIZE = 1000
OVERLAP = 150
LARGEST_SIDE = 1600  # pixels: enough to read a page, small enough to be quick
# A scanned page is one big picture: the charter's are 108 MB once uncompressed, beyond the 75 MB that pypdf allows
# against the PDFs made to fill the memory, so they were left out without a word (problem #28 of the knowledge
# base). The sources come from the Bureau, at most DOCUMENT_MAX_UPLOAD_MB each, and are read one page at a time:
# a page's picture may take up to this, about an A3 page scanned at 600 dpi in colour.
PAGE_PICTURE_LIMIT = 500 * 1024 * 1024
WORD = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class SourceUnreadable(Exception):
    """The file cannot be read (damaged, protected, empty)."""


def extension(name):
    return PurePath(name).suffix.lower().lstrip(".")


def check_file(upload):
    limit = settings.DOCUMENT_MAX_UPLOAD_MB
    if upload.size > limit * 1024 * 1024:
        raise ValidationError({"file": [_("The file is larger than %(limit)s MB.") % {"limit": limit}]})
    if extension(upload.name) not in ALLOWED_EXTENSIONS:
        raise ValidationError({"file": [_("The assistant reads PDF, Word (DOCX), text and pictures (PNG, JPEG).")]})


def picture(data):
    """A page's picture as PNG bytes, at most LARGEST_SIDE pixels wide or high."""
    image = Image.open(io.BytesIO(data)) if isinstance(data, bytes) else data
    image = image.convert("RGB")
    image.thumbnail((LARGEST_SIDE, LARGEST_SIDE))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def pdf_pages(handle):
    """The text of each page (a scanned one read by the vision model), and the numbers of the pages whose picture
    could not be read."""
    with apply_configuration(image_maximum_buffer_size=PAGE_PICTURE_LIMIT, zlib_maximum_output_length=PAGE_PICTURE_LIMIT):
        try:
            reader = PdfReader(handle)
            pages = list(reader.pages)
        except Exception as error:  # pypdf raises many kinds on a damaged file
            raise SourceUnreadable(_("This PDF cannot be opened.")) from error
        texts, unread = [], []
        for number, page in enumerate(pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:  # an odd page: read as a picture below
                text = ""
            if len(text.strip()) < SCANNED:
                try:
                    images = sorted(page.images, key=lambda item: len(item.data), reverse=True)
                    scan = picture(images[0].image) if images else None
                except Exception:  # a picture pypdf cannot decode: the page is left out, and named to the Bureau
                    logger.warning("Page %s of an assistant source could not be read", number, exc_info=True)
                    scan = None
                    unread.append(number)
                if scan is not None:
                    text = llm.read_image(scan)
            texts.append(text)
    return texts, unread


def docx_text(handle):
    try:
        with zipfile.ZipFile(handle) as archive:
            root = ElementTree.fromstring(archive.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as error:
        raise SourceUnreadable(_("This Word file cannot be opened.")) from error
    paragraphs = ["".join(node.text or "" for node in paragraph.iter(f"{WORD}t")) for paragraph in root.iter(f"{WORD}p")]
    return "\n".join(paragraphs)


def page_texts(source):
    """[(page number or None, text)] of the source's file, and the numbers of the pages that could not be read."""
    kind = extension(source.file_name)
    with source.file.open("rb") as handle:
        if kind == "pdf":
            texts, unread = pdf_pages(handle)
            return list(enumerate(texts, start=1)), unread
        data = handle.read()
    if kind == "docx":
        return [(None, docx_text(io.BytesIO(data)))], []
    if kind in IMAGE_FILES:
        return [(1, llm.read_image(picture(data)))], []
    return [(None, data.decode("utf-8", errors="replace"))], []


def unread_warning(numbers):
    """What the Bureau is told of the pages left out (empty when every page was read)."""
    if not numbers:
        return ""
    return _("These pages could not be read: %(pages)s. Their text is not in the assistant.") % {
        "pages": ", ".join(str(number) for number in numbers)
    }


def passages(pages):
    """[(page, text)] of about PASSAGE_SIZE characters, each page cut on its own, OVERLAP characters shared."""
    found = []
    for page, text in pages:
        text = re.sub(r"[ \t]+", " ", text).strip()
        start = 0
        while start < len(text):
            end = min(len(text), start + PASSAGE_SIZE)
            if end < len(text):
                cut = max(text.rfind("\n", start, end), text.rfind(". ", start, end))
                if cut > start + PASSAGE_SIZE // 2:
                    end = cut + 1
            piece = text[start:end].strip()
            if piece:
                found.append((page, piece))
            if end >= len(text):
                break
            start = max(end - OVERLAP, start + 1)
    return found


def read(source_id):
    """Reads the source again from its file: its passages replaced, its state ready (with the pages left out, if any)
    or failed (with why)."""
    source = AssistantSource.objects.get(pk=source_id)
    try:
        pages, unread = page_texts(source)
        pieces = passages(pages)
        if not pieces:
            raise SourceUnreadable(_("No text was found in this file."))
        vectors = llm.embed([text for _page, text in pieces])
    except (SourceUnreadable, llm.AssistantUnavailable) as error:
        source.status, source.error = SourceStatus.FAILED, str(error)
        source.save(update_fields=["status", "error"])
        return source
    with transaction.atomic():
        # Lock the source: two reads at once (reread clicked twice) would otherwise each delete, then each insert,
        # leaving its passages twice. The second now waits and replaces the first's.
        if not AssistantSource.objects.select_for_update().filter(pk=source.pk).exists():
            return source  # deleted while it was being read
        source.passages.all().delete()
        SourcePassage.objects.bulk_create(
            SourcePassage(source=source, page=page, position=position, text=text, embedding=vector)
            for position, ((page, text), vector) in enumerate(zip(pieces, vectors, strict=True))
        )
        source.status, source.error = SourceStatus.READY, unread_warning(unread)
        source.pages = len(pages)
        source.read_at = timezone.now()
        source.save(update_fields=["status", "error", "pages", "read_at"])
    return source


def read_in_background(source_id):
    try:
        read(source_id)
    except Exception:  # never leave a source "being read" for ever
        logger.exception("Reading the assistant source %s failed", source_id)
        AssistantSource.objects.filter(pk=source_id).update(
            status=SourceStatus.FAILED, error=_("The reading stopped on an unexpected error.")
        )
    finally:
        close_old_connections()


def start_reading(source):
    """Once the source is saved: read now (tests) or in a background thread."""
    source.status, source.error = SourceStatus.READING, ""
    source.save(update_fields=["status", "error"])
    if settings.ASSISTANT_READ_IN_BACKGROUND:
        transaction.on_commit(lambda: threading.Thread(target=read_in_background, args=(source.pk,),
                                                       daemon=True).start())
    else:
        transaction.on_commit(lambda: read(source.pk))
