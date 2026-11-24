from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import OrgUnit
from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer
from apps.projects.models import Project
from apps.subsystems.models import Subsystem

from .access import document_access_for
from .models import Document, DocumentStatus, DocumentType, DocumentVersion, KnowledgeCategory, LessonLearned


class NameRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class DocumentVersionSerializer(serializers.ModelSerializer):
    uploaded_by = MemberSummarySerializer(read_only=True)

    class Meta:
        model = DocumentVersion
        fields = ["id", "number", "file_name", "size", "content_type", "note", "uploaded_by", "uploaded_at"]
        read_only_fields = fields


class DocumentPermissionsSerializer(serializers.Serializer):
    edit = serializers.BooleanField(
        help_text="May change it and upload versions (its author, its unit's leaders, its project manager)."
    )
    delete = serializers.BooleanField(help_text="Its author or an admin.")


class DocumentSerializer(serializers.ModelSerializer):
    """A document as listed."""

    org_unit = OrgUnitSummarySerializer(read_only=True, allow_null=True)
    project = NameRefSerializer(read_only=True, allow_null=True)
    subsystem = NameRefSerializer(read_only=True, allow_null=True)
    uploaded_by = MemberSummarySerializer(read_only=True)
    current_version = DocumentVersionSerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id", "title", "description", "type", "category", "season", "org_unit", "project", "subsystem",
            "uploaded_by", "current_version", "created_at", "updated_at", "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(DocumentPermissionsSerializer)
    def get_permissions(self, document):
        access = document_access_for(self.context["request"])
        return {"edit": access.can_edit(document), "delete": access.can_delete(document)}


class DocumentDetailSerializer(DocumentSerializer):
    versions = serializers.SerializerMethodField()

    class Meta(DocumentSerializer.Meta):
        fields = DocumentSerializer.Meta.fields + ["versions"]
        read_only_fields = fields

    @extend_schema_field(DocumentVersionSerializer(many=True))
    def get_versions(self, document):
        """Its history, newest first (a version rejected before D-020 is left out)."""
        rows = [version for version in document.versions.all() if version.status != DocumentStatus.REJECTED]
        return DocumentVersionSerializer(rows, many=True, context=self.context).data


class DocumentWriteSerializer(serializers.ModelSerializer):
    """A document's information. Created with its first file (DocumentCreateSerializer)."""

    org_unit_id = serializers.PrimaryKeyRelatedField(
        source="org_unit", queryset=OrgUnit.objects.filter(is_active=True), allow_null=True, required=False,
    )
    project_id = serializers.PrimaryKeyRelatedField(
        source="project", queryset=Project.objects.all(), allow_null=True, required=False,
    )
    subsystem_id = serializers.PrimaryKeyRelatedField(
        source="subsystem", queryset=Subsystem.objects.all(), allow_null=True, required=False,
        help_text="Its project and unit follow when they are not given.",
    )
    type = serializers.ChoiceField(choices=DocumentType.choices)
    category = serializers.ChoiceField(choices=KnowledgeCategory.choices, allow_blank=True, required=False)
    season = serializers.IntegerField(min_value=2000, max_value=2100, required=False,
                                      help_text="The year it starts (2026 for 2026/2027); the current one by default.")

    class Meta:
        model = Document
        fields = ["title", "description", "type", "category", "season", "org_unit_id", "project_id", "subsystem_id"]

    def validate(self, attrs):
        document = self.instance
        subsystem = attrs.get("subsystem", getattr(document, "subsystem", None))
        if subsystem is not None:
            project = attrs.get("project") or getattr(document, "project", None)
            if project is not None and project.pk != subsystem.project_id:
                raise serializers.ValidationError(
                    {"subsystem_id": [_("The subsystem must belong to the document's project.")]}
                )
            attrs.setdefault("project", subsystem.project)
            if not attrs.get("org_unit") and not getattr(document, "org_unit_id", None):
                attrs["org_unit"] = subsystem.org_unit
        return attrs


class DocumentCreateSerializer(DocumentWriteSerializer):
    file = serializers.FileField(write_only=True, help_text="Its first version.")
    note = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta(DocumentWriteSerializer.Meta):
        fields = DocumentWriteSerializer.Meta.fields + ["file", "note"]


class VersionCreateSerializer(serializers.Serializer):
    file = serializers.FileField()
    note = serializers.CharField(required=False, allow_blank=True, help_text="What changes.")


class FolderSerializer(serializers.Serializer):
    """A folder of files: a department (the project's unit for a project file without one), a project, a season."""

    unit = OrgUnitSummarySerializer(allow_null=True, help_text="None: the whole team's files.")
    project = NameRefSerializer(allow_null=True)
    season = serializers.IntegerField()
    count = serializers.IntegerField()


class LessonPermissionsSerializer(serializers.Serializer):
    edit = serializers.BooleanField()
    delete = serializers.BooleanField()


class LessonSerializer(serializers.ModelSerializer):
    org_unit = OrgUnitSummarySerializer(read_only=True, allow_null=True)
    project = NameRefSerializer(read_only=True, allow_null=True)
    author = MemberSummarySerializer(read_only=True)
    org_unit_id = serializers.PrimaryKeyRelatedField(
        source="org_unit", queryset=OrgUnit.objects.filter(is_active=True), allow_null=True, required=False,
        write_only=True,
    )
    project_id = serializers.PrimaryKeyRelatedField(
        source="project", queryset=Project.objects.all(), allow_null=True, required=False, write_only=True,
    )
    category = serializers.ChoiceField(choices=KnowledgeCategory.choices, allow_blank=True, required=False)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = LessonLearned
        fields = [
            "id", "title", "problem", "context", "root_cause", "solution", "result", "next_time", "org_unit",
            "org_unit_id", "project", "project_id", "category", "author", "created_at", "updated_at", "permissions",
        ]
        read_only_fields = ["id", "author", "created_at", "updated_at"]

    @extend_schema_field(LessonPermissionsSerializer)
    def get_permissions(self, lesson):
        access = document_access_for(self.context["request"])
        return {"edit": access.can_edit_lesson(lesson), "delete": access.can_delete_lesson(lesson)}
