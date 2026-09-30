from django.db import models


class Announcement(models.Model):
    title = models.CharField(max_length=255)
    body = models.TextField()
    posted_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="announcements"
    )
    # NULL = club-wide announcement.
    org_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True,
        on_delete=models.PROTECT, related_name="announcements",
    )
    posted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-posted_at"]
        indexes = [models.Index(fields=["-posted_at"], name="idx_announcement_posted_at")]

    def __str__(self):
        return self.title


class Notification(models.Model):
    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="notifications"
    )
    message = models.CharField(max_length=500)
    is_read = models.BooleanField(default=False)
    # Loose pointer to the related record (e.g. 'task', 42). Not a real FK.
    related_entity_type = models.CharField(max_length=50, blank=True)
    related_entity_id = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["member", "-created_at"], name="idx_notif_member_created"),
            models.Index(
                fields=["member"], condition=models.Q(is_read=False), name="idx_notif_member_unread"
            ),
        ]

    def __str__(self):
        return self.message[:50]


class MediaContact(models.Model):
    journalist_name = models.CharField(max_length=255)
    channel_name = models.CharField(max_length=255, blank=True)
    contact_info = models.CharField(max_length=255, blank=True)
    handled_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="media_contacts",
    )
    posted_video_link = models.URLField(max_length=500, blank=True)
    remarks = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.journalist_name