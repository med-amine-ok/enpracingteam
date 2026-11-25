from django.db import models
from django.utils.translation import gettext_lazy as _


class Announcement(models.Model):
    title = models.CharField(_("title"), max_length=255)
    body = models.TextField(_("text"))
    posted_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="announcements", verbose_name=_("posted by")
    )
    # NULL = club-wide announcement.
    org_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True,
        on_delete=models.PROTECT, related_name="announcements", verbose_name=_("organisational unit"),
    )
    posted_at = models.DateTimeField(_("posted at"), auto_now_add=True)

    class Meta:
        verbose_name = _("announcement")
        verbose_name_plural = _("announcements")
        ordering = ["-posted_at"]
        indexes = [models.Index(fields=["-posted_at"], name="idx_announcement_posted_at")]

    def __str__(self):
        return self.title


class NotificationKind(models.TextChoices):
    """What happened. The screens write the sentence in the reader's language from `kind` and
    `data`; e-mails are written by apps/communication/emails.py."""

    MESSAGE = "message", _("Message")
    TASK_ASSIGNED = "task_assigned", _("Task assigned")
    TASK_COMMENTED = "task_commented", _("New comment")
    TASK_BLOCKED = "task_blocked", _("Task blocked")
    TASK_DONE = "task_done", _("Task done")
    VALIDATION_REQUESTED = "validation_requested", _("Validation awaited")
    VALIDATION_SIGNED = "validation_signed", _("Validation signed")
    TASK_DUE_SOON = "task_due_soon", _("Due soon")
    TASK_OVERDUE = "task_overdue", _("Overdue")
    PURCHASE_APPROVAL_REQUESTED = "purchase_approval_requested", _("Purchase to approve")
    PURCHASE_TO_ORDER = "purchase_to_order", _("Purchase to order")
    PURCHASE_UPDATED = "purchase_updated", _("Purchase request update")
    STOCK_LOW = "stock_low", _("Low stock")
    BUDGET_EXCEEDED = "budget_exceeded", _("Budget exceeded")
    # The steps of a task and its blockers (decision D-012).
    TASK_SUBMITTED = "task_submitted", _("Task submitted")
    TASK_VALIDATED = "task_validated", _("Task validated")
    TASK_REVISION = "task_revision", _("Task to rework")
    BLOCKER_DECLARED = "blocker_declared", _("Blocker declared")
    BLOCKER_UPDATED = "blocker_updated", _("Blocker update")
    # The sessions and their attendance (decision D-013).
    MEETING_SCHEDULED = "meeting_scheduled", _("Session scheduled")
    MEETING_UPDATED = "meeting_updated", _("Session changed")
    MEETING_REMINDER = "meeting_reminder", _("Session reminder")
    EXCUSE_REQUESTED = "excuse_requested", _("Excuse to decide")
    EXCUSE_DECIDED = "excuse_decided", _("Excuse decided")
    ACTION_ASSIGNED = "action_assigned", _("Action assigned to you")
    MINUTES_PUBLISHED = "minutes_published", _("Minutes published")
    # The documents and their versions (decision D-015).
    # No longer created since D-020 (nothing is reviewed): kept for the notifications saved before.
    DOCUMENT_REVIEW_REQUESTED = "document_review_requested", _("Document to review")
    DOCUMENT_REVIEWED = "document_reviewed", _("Document reviewed")
    # The workshop (decision D-016).
    LOAN_REQUESTED = "loan_requested", _("Loan to decide")
    LOAN_DECIDED = "loan_decided", _("Loan decided")
    LOAN_OVERDUE = "loan_overdue", _("Loan overdue")
    RESERVATION_CANCELLED = "reservation_cancelled", _("Reservation cancelled")
    CERTIFICATION_GRANTED = "certification_granted", _("Machine certification")
    # The monthly ranking (decision D-017).
    CONTRIBUTION_PROPOSED = "contribution_proposed", _("Contribution points to decide")
    CONTRIBUTION_DECIDED = "contribution_decided", _("Contribution points decided")
    RANKING_PUBLISHED = "ranking_published", _("Ranking published")
    RANKING_TO_PUBLISH = "ranking_to_publish", _("Ranking to publish")
    # Warnings and exclusions (decision D-018).
    WARNING_REPORTED = "warning_reported", _("Breach reported")
    WARNING_ISSUED = "warning_issued", _("Warning given")  # not "Warning": the dashboard's alerts
    EXCLUSION_PENDING = "exclusion_pending", _("Exclusion to confirm")
    # Goals, trainings and volunteering (decision D-019).
    OBJECTIVE_SET = "objective_set", _("New goal")
    TRAINING_PLANNED = "training_planned", _("Training planned")
    VOLUNTEERING_TO_VALIDATE = "volunteering_to_validate", _("Volunteering to validate")
    VOLUNTEERING_DECIDED = "volunteering_decided", _("Volunteering decided")
    VOLUNTEERING_REMINDER = "volunteering_reminder", _("Volunteering of the month")
    # Work Orders, Deliverables, dependencies and blockers (documentation/documentation_Tasks): `data.event`
    # says which (apps/task_management/services/notify.py); never anything about scoring.
    WORK_EVENT = "work_event", _("Work update")


class Notification(models.Model):
    member = models.ForeignKey(
        "members.Member", on_delete=models.CASCADE, related_name="notifications", verbose_name=_("member")
    )
    kind = models.CharField(_("kind"), max_length=30, choices=NotificationKind.choices, default=NotificationKind.MESSAGE)
    # Who acted (empty for the daily deadline reminders).
    actor = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name=_("by")
    )
    # Written by hand (kind "message"); the other kinds are written from `data`.
    message = models.CharField(_("message"), max_length=500, blank=True)
    # What the sentence needs: task title, project name, due date…
    data = models.JSONField(_("details"), default=dict, blank=True)
    is_read = models.BooleanField(_("read"), default=False)
    # Loose pointer to the related record (e.g. 'task', 42). Not a real FK.
    related_entity_type = models.CharField(_("related record type"), max_length=50, blank=True)
    related_entity_id = models.BigIntegerField(_("related record ID"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("notification")
        verbose_name_plural = _("notifications")
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["member", "-created_at"], name="idx_notif_member_created"),
            models.Index(
                fields=["member"], condition=models.Q(is_read=False), name="idx_notif_member_unread"
            ),
        ]

    def __str__(self):
        return self.message[:50] or str(self.get_kind_display())


class MediaContact(models.Model):
    journalist_name = models.CharField(_("journalist name"), max_length=255)
    channel_name = models.CharField(_("media outlet"), max_length=255, blank=True)
    contact_info = models.CharField(_("contact details"), max_length=255, blank=True)
    handled_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="media_contacts", verbose_name=_("handled by"),
    )
    posted_video_link = models.URLField(_("published video link"), max_length=500, blank=True)
    remarks = models.TextField(_("remarks"), blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("media contact")
        verbose_name_plural = _("media contacts")

    def __str__(self):
        return self.journalist_name
