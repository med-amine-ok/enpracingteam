from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.serializers import MemberSummarySerializer
from apps.subsystems.models import step_display_name

from .models import Notification


class NotificationTargetSerializer(serializers.Serializer):
    """What the notification is about: a task or a subsystem, by its id."""

    type = serializers.CharField()
    id = serializers.IntegerField()


class NotificationSerializer(serializers.ModelSerializer):
    """A notification as the screens show it: they write the sentence from `kind` and `data`, in
    the reader's language (`message`: text written by hand, for the kind "message")."""

    actor = MemberSummarySerializer(read_only=True, allow_null=True)
    data = serializers.DictField(read_only=True)
    target = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ["id", "kind", "actor", "message", "data", "target", "is_read", "created_at"]
        read_only_fields = fields  # output only: every field is always present

    @extend_schema_field(NotificationTargetSerializer(allow_null=True))
    def get_target(self, notification):
        if notification.related_entity_type and notification.related_entity_id is not None:
            return {"type": notification.related_entity_type, "id": notification.related_entity_id}
        return None

    def to_representation(self, notification):
        representation = super().to_representation(notification)
        data = representation["data"]
        if "step" in data:  # saved as typed: a standard step is named in the reader's language
            representation["data"] = {**data, "step": step_display_name(data["step"])}
        return representation


class CountSerializer(serializers.Serializer):
    count = serializers.IntegerField()
