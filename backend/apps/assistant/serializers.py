from rest_framework import serializers

from apps.members.serializers import MemberSummarySerializer

from .models import AssistantMessage, AssistantSource, Conversation


class AssistantRightsSerializer(serializers.Serializer):
    manage_sources = serializers.BooleanField(help_text="May add and remove the sources (the Executive Bureau).")
    ready = serializers.BooleanField(help_text="At least one source is read: the assistant can answer.")


class SourceSerializer(serializers.ModelSerializer):
    uploaded_by = MemberSummarySerializer(read_only=True)
    passages = serializers.IntegerField(source="passage_count", read_only=True)

    class Meta:
        model = AssistantSource
        fields = ["id", "title", "season", "file_name", "size", "status", "error", "pages", "passages", "uploaded_by",
                  "created_at", "read_at"]
        read_only_fields = fields


class SourceCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    season = serializers.IntegerField(min_value=2000, max_value=2100, required=False,
                                      help_text="The year it starts (2026 for 2026/2027); the current one by default.")
    file = serializers.FileField()


class CitationSerializer(serializers.Serializer):
    number = serializers.IntegerField(help_text="As cited in the answer: [1], [2].")
    source = serializers.IntegerField()
    title = serializers.CharField()
    season = serializers.IntegerField()
    page = serializers.IntegerField(allow_null=True)


class MessageSerializer(serializers.ModelSerializer):
    citations = CitationSerializer(many=True, read_only=True)

    class Meta:
        model = AssistantMessage
        fields = ["id", "role", "content", "citations", "created_at"]
        read_only_fields = fields


class ConversationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Conversation
        fields = ["id", "title", "created_at", "updated_at"]
        read_only_fields = fields


class ConversationDetailSerializer(ConversationSerializer):
    messages = MessageSerializer(many=True, read_only=True)

    class Meta(ConversationSerializer.Meta):
        fields = ConversationSerializer.Meta.fields + ["messages"]
        read_only_fields = fields


class AskSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=2000)
    conversation_id = serializers.IntegerField(required=False, allow_null=True,
                                               help_text="To go on with one of one's conversations; a new one else.")


class AnswerSerializer(serializers.Serializer):
    conversation = ConversationSerializer()
    question = MessageSerializer()
    answer = MessageSerializer()
