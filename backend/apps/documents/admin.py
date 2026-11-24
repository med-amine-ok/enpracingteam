# apps/documents/admin.py
from django.contrib import admin

from .models import Document, DocumentVersion, LessonLearned


class VersionInline(admin.TabularInline):
    model = DocumentVersion
    extra = 0
    fields = ("number", "file", "status", "uploaded_by", "reviewed_by", "review_note")
    readonly_fields = ("number", "uploaded_by", "reviewed_by")


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "type", "category", "status", "org_unit", "subsystem", "uploaded_by")
    list_filter = ("type", "category", "status", "org_unit")
    search_fields = ("title", "description")
    inlines = [VersionInline]


@admin.register(LessonLearned)
class LessonLearnedAdmin(admin.ModelAdmin):
    list_display = ("title", "category", "org_unit", "author", "created_at")
    list_filter = ("category", "org_unit")
    search_fields = ("title", "problem", "solution")
