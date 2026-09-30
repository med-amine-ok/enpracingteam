# apps/documents/admin.py
from django.contrib import admin
from .models import Document

@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "type", "status", "org_unit", "subsystem", "uploaded_by")
    list_filter = ("type", "status", "org_unit")
    search_fields = ("title",)