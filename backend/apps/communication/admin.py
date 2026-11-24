# apps/communication/admin.py
from django.contrib import admin
from .models import Announcement, MediaContact, Notification

@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ("title", "org_unit", "posted_by", "posted_at")
    list_filter = ("org_unit",)

@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("member", "kind", "__str__", "actor", "is_read", "created_at")
    list_filter = ("kind", "is_read")

@admin.register(MediaContact)
class MediaContactAdmin(admin.ModelAdmin):
    list_display = ("journalist_name", "channel_name", "handled_by")