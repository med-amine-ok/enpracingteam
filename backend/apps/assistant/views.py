"""
The team's assistant API (decision D-021, knowledge base: PROJECTS/ERP/assistant_design.md): the sources, managed
by the Executive Bureau only; the conversations, each read by its member only. Reading: reading.py; answering:
answering.py; the models: llm.py.
"""

from pathlib import PurePath

from django.db import transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.meetings.access import meeting_access_for

from . import answering, llm, reading
from .models import AssistantSource, Conversation, SourceStatus
from .serializers import (
    AnswerSerializer, AskSerializer, AssistantRightsSerializer, ConversationDetailSerializer, ConversationSerializer,
    SourceCreateSerializer, SourceSerializer,
)

ID = OpenApiParameter("id", int, OpenApiParameter.PATH)


def manages_sources(request):
    """The Executive Bureau ("the board of directors"), the Team Manager, the admins."""
    access = meeting_access_for(request)
    return access.is_admin or access.is_bureau


class AssistantViewSet(viewsets.ViewSet):
    @extend_schema(summary="What the viewer may do with the assistant", responses=AssistantRightsSerializer)
    @action(detail=False, methods=["get"])
    def rights(self, request):
        ready = AssistantSource.objects.filter(status=SourceStatus.READY).exists()
        return Response(AssistantRightsSerializer({"manage_sources": manages_sources(request), "ready": ready}).data)


@extend_schema_view(
    list=extend_schema(summary="The assistant's sources (the Executive Bureau)"),
    create=extend_schema(summary="Add a source: it is read in the background (the Executive Bureau)",
                         request=SourceCreateSerializer, responses={201: SourceSerializer}),
    destroy=extend_schema(summary="Remove a source and its passages (the Executive Bureau)", parameters=[ID]),
)
class SourceViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin,
                    viewsets.GenericViewSet):
    serializer_class = SourceSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    lookup_value_regex = r"\d+"
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not manages_sources(request):
            raise PermissionDenied(_("Only the Executive Bureau manages the assistant's sources."))

    def get_queryset(self):
        return AssistantSource.objects.select_related("uploaded_by").annotate(passage_count=Count("passages"))

    def create(self, request, *args, **kwargs):
        serializer = SourceCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        upload = data.pop("file")
        reading.check_file(upload)
        with transaction.atomic():
            source = AssistantSource.objects.create(
                **data, file=upload, file_name=PurePath(upload.name).name[:255], size=upload.size,
                uploaded_by=request.user,
            )
            reading.start_reading(source)
        return Response(SourceSerializer(self.get_queryset().get(pk=source.pk)).data, status=201)

    def perform_destroy(self, instance):
        file = instance.file
        instance.delete()
        transaction.on_commit(lambda: file.delete(save=False))

    @extend_schema(summary="Read a source again (after a failure, or with new models)", parameters=[ID],
                   request=None, responses=SourceSerializer)
    @action(detail=True, methods=["post"])
    def reread(self, request, pk=None):
        with transaction.atomic():
            source = get_object_or_404(AssistantSource.objects.select_for_update(), pk=pk)
            reading.start_reading(source)
        return Response(SourceSerializer(self.get_queryset().get(pk=source.pk)).data)


@extend_schema_view(
    list=extend_schema(summary="The viewer's conversations (no one else reads them)"),
    retrieve=extend_schema(summary="One of the viewer's conversations, with its messages", parameters=[ID]),
    destroy=extend_schema(summary="Delete one of one's conversations", parameters=[ID]),
)
class ConversationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin,
                          viewsets.GenericViewSet):
    lookup_value_regex = r"\d+"

    def get_serializer_class(self):
        return ConversationDetailSerializer if self.action == "retrieve" else ConversationSerializer

    def get_queryset(self):
        conversations = Conversation.objects.filter(member=self.request.user)
        if self.action == "retrieve":
            conversations = conversations.prefetch_related("messages")
        return conversations

    @extend_schema(summary="Ask the assistant: the answer, from the sources, with them", request=AskSerializer,
                   responses={200: AnswerSerializer})
    @action(detail=False, methods=["post"])
    def ask(self, request):
        serializer = AskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        conversation = None
        if data.get("conversation_id"):
            conversation = get_object_or_404(Conversation, pk=data["conversation_id"], member=request.user)
        try:
            conversation, answer = answering.ask(request.user, data["question"].strip(), conversation)
        except llm.AssistantUnavailable as error:
            return Response({"detail": str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        question = answer.conversation.messages.filter(role="user").order_by("-created_at", "-id").first()
        return Response(AnswerSerializer({"conversation": conversation, "question": question, "answer": answer}).data)
