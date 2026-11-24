"""
The documents and the lessons learned API (decisions D-015 and D-020, knowledge base:
PROJECTS/ERP/documents_design.md). Who may do what: access.py; the versions: workflow.py.
"""

from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.db.models.functions import Coalesce
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from . import workflow
from .access import document_access_for
from apps.members.models import OrgUnit
from apps.projects.models import Project

from .models import Document, DocumentVersion, LessonLearned
from .serializers import (
    DocumentCreateSerializer, DocumentDetailSerializer, DocumentSerializer, DocumentVersionSerializer,
    DocumentWriteSerializer, FolderSerializer, LessonSerializer, VersionCreateSerializer,
)

DOCUMENT = OpenApiParameter("id", int, OpenApiParameter.PATH)
VERSION = OpenApiParameter("version_id", int, OpenApiParameter.PATH)
LESSON = OpenApiParameter("id", int, OpenApiParameter.PATH)
VERSIONS = Prefetch("versions", queryset=DocumentVersion.objects.select_related("uploaded_by"))


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def reference(params, name):
    """An id, "none", or None, from the query."""
    value = params.get(name) or None
    if value is None or value == "none" or value.isdigit():
        return value
    raise ValidationError({name: _("A number is expected.")})


def in_folder(documents, params):
    """The documents of a folder: its department (?unit=, "none" for the whole team's), project, season."""
    unit, project = reference(params, "unit"), reference(params, "project")
    if unit == "none":
        documents = documents.filter(org_unit__isnull=True, project__isnull=True)
    elif unit:
        documents = documents.filter(
            Q(org_unit_id=int(unit)) | Q(org_unit__isnull=True, project__org_unit_id=int(unit))
        )
    if project == "none":
        documents = documents.filter(project__isnull=True)
    elif project:
        documents = documents.filter(project_id=int(project))
    season = params.get("season")
    if season:
        if not season.isdigit():
            raise ValidationError({"season": _("A number is expected.")})
        documents = documents.filter(season=int(season))
    return documents


@extend_schema_view(
    list=extend_schema(
        summary="The documents the viewer sees: the whole team's, and those of their units and projects",
        parameters=[
            OpenApiParameter("q", str, description="Words of the title or the description."),
            OpenApiParameter("category", str), OpenApiParameter("type", str),
            OpenApiParameter("org_unit", int, description="A unit and the units below it."),
            OpenApiParameter("unit", str, description="A folder's department: a unit's id, or 'none' for the "
                                                      "whole team's files."),
            OpenApiParameter("project", str, description="A project's id, or 'none'."),
            OpenApiParameter("season", int, description="The year it starts: 2026 for 2026/2027."),
        ],
    ),
    retrieve=extend_schema(summary="A document, with the versions the viewer sees", parameters=[DOCUMENT]),
    create=extend_schema(summary="Add a document with its first file (any member)", request=DocumentCreateSerializer,
                         responses={201: DocumentDetailSerializer}),
    partial_update=extend_schema(summary="Change a document's information (its author, its unit's leaders)",
                                 parameters=[DOCUMENT], request=DocumentWriteSerializer,
                                 responses=DocumentDetailSerializer),
    destroy=extend_schema(summary="Delete a document (its author, an admin)", parameters=[DOCUMENT]),
)
class DocumentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    lookup_value_regex = r"\d+"
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    queryset = Document.objects.none()

    def get_serializer_class(self):
        if self.action == "list":
            return DocumentSerializer
        if self.action == "create":
            return DocumentCreateSerializer
        if self.action == "partial_update":
            return DocumentWriteSerializer
        return DocumentDetailSerializer

    def get_queryset(self):
        access = document_access_for(self.request)
        documents = access.visible(
            Document.objects.select_related(
                "org_unit", "project", "subsystem", "uploaded_by", "current_version__uploaded_by",
            ).prefetch_related(VERSIONS)
        )
        params = self.request.query_params
        if self.action == "list":
            documents = in_folder(documents, params)
            if params.get("q"):
                for word in params["q"].split():
                    documents = documents.filter(Q(title__icontains=word) | Q(description__icontains=word))
            for name in ("category", "type"):
                if params.get(name):
                    documents = documents.filter(**{name: params[name]})
            unit = params.get("org_unit")
            if unit:
                if not unit.isdigit():
                    raise ValidationError({"org_unit": _("A number is expected.")})
                found = OrgUnit.objects.filter(pk=int(unit)).first()
                documents = documents.filter(org_unit_id__in=found.descendant_ids() if found else [])
        return documents.distinct()

    def detail_response(self, document, status=200):
        fresh = self.get_queryset().get(pk=document.pk)
        return Response(DocumentDetailSerializer(fresh, context=self.get_serializer_context()).data, status=status)

    def document(self, pk):
        """The document, if the viewer sees it (404 otherwise), locked for the change."""
        document = get_object_or_404(self.get_queryset(), pk=pk)
        return Document.objects.select_for_update(of=("self",)).select_related("project", "org_unit").get(
            pk=document.pk
        )

    def create(self, request, *args, **kwargs):
        serializer = DocumentCreateSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        upload, note = data.pop("file"), data.pop("note", "")
        workflow.check_file(upload)
        with transaction.atomic():
            document = Document.objects.create(**data, uploaded_by=request.user)
            workflow.add_version(document, upload, request.user, note=note)
        return self.detail_response(document, status=201)

    def partial_update(self, request, *args, **kwargs):
        access = document_access_for(request)
        with transaction.atomic():
            document = self.document(kwargs["pk"])
            require(access.can_edit(document), _("Only its author and its unit's leaders change a document."))
            serializer = DocumentWriteSerializer(document, data=request.data, partial=True,
                                                 context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            serializer.save()
            # Moved to a project or unit the viewer does not see: refuse (and undo) rather than answer a 500
            # after the change is saved.
            if not self.get_queryset().filter(pk=document.pk).exists():
                raise ValidationError({"detail": _("You could no longer see this document there.")})
        return self.detail_response(document)

    def destroy(self, request, *args, **kwargs):
        access = document_access_for(request)
        with transaction.atomic():
            document = self.document(kwargs["pk"])
            require(access.can_delete(document), _("Only its author or an admin deletes a document."))
            files = [version.file for version in document.versions.all()]
            document.current_version = None
            document.save(update_fields=["current_version"])
            document.delete()
            transaction.on_commit(lambda: [file.delete(save=False) for file in files])
        return Response(status=204)

    # --- Folders ---

    @extend_schema(summary="The folders of the files the viewer sees: department, project, season, with a count",
                   responses=FolderSerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def folders(self, request):
        rows = list(
            document_access_for(request).visible(Document.objects.all())
            .annotate(folder_unit=Coalesce("org_unit_id", "project__org_unit_id"))
            .values("folder_unit", "project_id", "season").annotate(count=Count("id", distinct=True))
        )
        units = OrgUnit.objects.in_bulk([row["folder_unit"] for row in rows if row["folder_unit"]])
        projects = Project.objects.in_bulk([row["project_id"] for row in rows if row["project_id"]])
        folders = [
            {"unit": units.get(row["folder_unit"]), "project": projects.get(row["project_id"]),
             "season": row["season"], "count": row["count"]}
            for row in rows
        ]
        folders.sort(key=lambda row: (
            row["unit"] is None, row["unit"].name if row["unit"] else "", row["project"] is not None,
            row["project"].name if row["project"] else "", -row["season"],
        ))
        return Response(FolderSerializer(folders, many=True).data)

    # --- Versions ---

    @extend_schema(summary="Upload a new version (its author, its unit's leaders): the current one at once",
                   parameters=[DOCUMENT], request=VersionCreateSerializer, responses={201: DocumentVersionSerializer})
    @action(detail=True, methods=["post"])
    def versions(self, request, pk=None):
        access = document_access_for(request)
        serializer = VersionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            document = self.document(pk)
            require(access.can_edit(document), _("Only its author and its unit's leaders upload its versions."))
            version = workflow.add_version(document, data["file"], request.user, data.get("note", ""))
        return Response(DocumentVersionSerializer(version, context=self.get_serializer_context()).data, status=201)

    @extend_schema(summary="Download a version's file (an attachment)", parameters=[DOCUMENT, VERSION],
                   responses={200: OpenApiResponse(OpenApiTypes.BINARY, description="The file.")})
    @action(detail=True, methods=["get"], url_path=r"versions/(?P<version_id>\d+)/download")
    def download(self, request, pk=None, version_id=None):
        document = get_object_or_404(self.get_queryset(), pk=pk)
        version = get_object_or_404(DocumentVersion, pk=version_id, document=document)
        try:
            handle = version.file.open("rb")
        except FileNotFoundError as missing:
            raise Http404 from missing
        response = FileResponse(handle, as_attachment=True, filename=version.file_name,
                                content_type=version.content_type or "application/octet-stream")
        response["X-Content-Type-Options"] = "nosniff"
        return response


@extend_schema_view(
    list=extend_schema(
        summary="The lessons learned (every member reads them)",
        parameters=[
            OpenApiParameter("q", str, description="Words of any of its texts."), OpenApiParameter("category", str),
            OpenApiParameter("org_unit", int),
        ],
    ),
    retrieve=extend_schema(summary="A lesson learned", parameters=[LESSON]),
    create=extend_schema(summary="Write a lesson learned (any member)"),
    partial_update=extend_schema(summary="Correct a lesson (its author, its unit's leaders, the bureau)",
                                 parameters=[LESSON]),
    destroy=extend_schema(summary="Delete a lesson (its author, an admin)", parameters=[LESSON]),
)
class LessonViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = LessonSerializer
    http_method_names = ["get", "post", "patch", "delete"]
    lookup_value_regex = r"\d+"
    TEXTS = ("title", "problem", "context", "root_cause", "solution", "result", "next_time")

    def get_queryset(self):
        lessons = LessonLearned.objects.select_related("org_unit", "project", "author")
        params = self.request.query_params
        if params.get("q"):
            for word in params["q"].split():
                match = Q()
                for field in self.TEXTS:
                    match |= Q(**{f"{field}__icontains": word})
                lessons = lessons.filter(match)
        if params.get("category"):
            lessons = lessons.filter(category=params["category"])
        if params.get("org_unit", "").isdigit():
            lessons = lessons.filter(org_unit_id=int(params["org_unit"]))
        return lessons

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    def perform_update(self, serializer):
        require(document_access_for(self.request).can_edit_lesson(serializer.instance),
                _("Only its author, its unit's leaders and the bureau correct a lesson."))
        serializer.save()

    def perform_destroy(self, instance):
        require(document_access_for(self.request).can_delete_lesson(instance),
                _("Only its author or an admin deletes a lesson."))
        instance.delete()
