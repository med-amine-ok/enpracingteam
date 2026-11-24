from django.contrib import admin

from .models import AssistantSource

# The conversations are not shown here: only their member reads them (decision D-021).


@admin.register(AssistantSource)
class AssistantSourceAdmin(admin.ModelAdmin):
    list_display = ["title", "season", "status", "pages", "uploaded_by", "created_at"]
    list_filter = ["status", "season"]
    search_fields = ["title", "file_name"]
    readonly_fields = ["file_name", "size", "status", "error", "pages", "uploaded_by", "created_at", "read_at"]
