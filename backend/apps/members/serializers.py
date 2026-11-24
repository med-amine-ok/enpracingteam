from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .access import CONTACT_FIELDS, contact_access_for, scope_of
from .models import (
    ALWAYS_EMAILED, AlumniProfile, EmailTopic, Member, MemberLevel, MemberStatus, Membership, OrgUnit, Role,
    StudyLevel,
)
from .rules import charter_problems


class OrgUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrgUnit
        fields = ["id", "code", "name", "type", "parent", "description", "is_temporary", "is_active"]
        read_only_fields = ["code"]


class OrgUnitSummarySerializer(serializers.ModelSerializer):
    """A unit as shown inside other objects (owner of a project, department of a subsystem)."""

    class Meta:
        model = OrgUnit
        fields = ["id", "code", "name", "type"]
        read_only_fields = ["code"]


class MemberSummarySerializer(serializers.ModelSerializer):
    """A person inside other objects (manager, assignee, author): the name only, never contact details."""

    class Meta:
        model = Member
        fields = ["id", "first_name", "last_name"]


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "name", "role_type", "scope", "is_leadership", "can_be_project_manager"]


class MembershipSerializer(serializers.ModelSerializer):
    role = RoleSerializer(read_only=True)
    org_unit = OrgUnitSerializer(read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "org_unit", "role", "member_level", "start_date", "end_date", "is_primary"]


class AlumniProfileSerializer(serializers.ModelSerializer):
    """What an alumni tells the team about their life after it (decision D-022)."""

    class Meta:
        model = AlumniProfile
        fields = ["graduation_year", "current_position", "current_company", "linkedin_url", "willing_to_mentor"]
        # null when the viewer may not see it, like the other contact details.
        extra_kwargs = {"linkedin_url": {"allow_null": True}}

    def validate_graduation_year(self, year):
        if year is not None and not 1950 <= year <= timezone.now().year + 5:
            raise serializers.ValidationError(_("Give the year the member left the school, e.g. 2024."))
        return year


class MemberSerializer(serializers.ModelSerializer):
    # Only for an alumni (status "alumni"); null for the members still in the team.
    alumni_profile = serializers.SerializerMethodField()

    class Meta:
        model = Member
        fields = [
            "id", "first_name", "last_name", "email", "phone", "facebook_url", "skill", "status", "join_date",
            "study_level", "study_field", "race_number", "alumni_profile",
        ]
        read_only_fields = ["id"]
        # null when the viewer may not see them (to_representation): documented in the API schema.
        extra_kwargs = {field: {"allow_null": True} for field in CONTACT_FIELDS}

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        # Contact details are personal data (club charter, art. 18): blank them unless the
        # viewer may see them. The keys stay in the payload so the API shape is stable.
        if request is None or not contact_access_for(request).can_view(instance):
            for field in CONTACT_FIELDS:
                if field in data:
                    data[field] = None
            if data.get("alumni_profile"):
                data["alumni_profile"]["linkedin_url"] = None
        return data

    @extend_schema_field(AlumniProfileSerializer(allow_null=True))
    def get_alumni_profile(self, member):
        if member.status != MemberStatus.ALUMNI:
            return None
        try:
            profile = member.alumni_profile
        except AlumniProfile.DoesNotExist:
            return None
        return AlumniProfileSerializer(profile).data


class MemberProjectSerializer(serializers.Serializer):
    """A project under way or planned a member works on or manages (decision D-025)."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    category = serializers.CharField()
    manages = serializers.BooleanField(help_text="Whether they are its project manager.")


def member_projects(member):
    """The projects under way or planned the member works on (in its team) or manages, by name. Read from what
    MemberListCreateView prefetched when it did (open_project_memberships, open_managed_projects)."""
    from apps.projects.models import Project, ProjectMember, ProjectStatus  # the projects app builds on this one

    open_statuses = (ProjectStatus.PLANNED, ProjectStatus.ACTIVE)
    team = getattr(member, "open_project_memberships", None)
    if team is None:
        team = ProjectMember.objects.filter(
            member=member, is_active=True, end_date__isnull=True, project__status__in=open_statuses
        ).select_related("project")
    managed = getattr(member, "open_managed_projects", None)
    if managed is None:
        managed = Project.objects.filter(project_manager=member, status__in=open_statuses)
    rows = {project.pk: (project, True) for project in managed}
    for row in team:
        rows.setdefault(row.project_id, (row.project, False))
    return [
        {"id": project.pk, "name": project.name, "category": project.category, "manages": manages}
        for project, manages in sorted(rows.values(), key=lambda pair: pair[0].name)
    ]


class MemberDetailSerializer(MemberSerializer):
    memberships = MembershipSerializer(many=True, read_only=True)
    projects = serializers.SerializerMethodField(help_text="The projects under way or planned they work on or manage.")

    class Meta(MemberSerializer.Meta):
        fields = MemberSerializer.Meta.fields + ["memberships", "projects"]

    @extend_schema_field(MemberProjectSerializer(many=True))
    def get_projects(self, member):
        return member_projects(member)


class MeSerializer(MemberDetailSerializer):
    """The logged-in member: profile, memberships, their language choice and the e-mails they turned off."""

    muted_email_topics = serializers.ListField(
        child=serializers.ChoiceField(choices=EmailTopic.choices), read_only=True,
        help_text="The subjects of the e-mails the member turned off (the warnings are always e-mailed).",
    )

    class Meta(MemberDetailSerializer.Meta):
        fields = MemberDetailSerializer.Meta.fields + ["language", "muted_email_topics"]


class MemberPreferencesSerializer(serializers.ModelSerializer):
    """What members may change about themselves at /api/auth/me/: their language, their year and field of study,
    their race number, the e-mails they receive."""

    muted_email_topics = serializers.ListField(
        child=serializers.ChoiceField(choices=EmailTopic.choices), required=False, max_length=len(EmailTopic),
        help_text="The subjects of the e-mails to turn off; the warnings and exclusions cannot be.",
    )

    class Meta:
        model = Member
        fields = ["language", "study_level", "study_field", "race_number", "muted_email_topics"]

    def validate_muted_email_topics(self, topics):
        if any(topic in ALWAYS_EMAILED for topic in topics):
            raise serializers.ValidationError(_("The warnings and exclusions are always e-mailed (charter)."))
        return sorted(set(topics))

    def validate_race_number(self, number):
        # Unique among the members still in the team (alumni free their number): see Member.Meta.
        taken = (
            Member.objects.filter(race_number=number).exclude(status=MemberStatus.ALUMNI)
            .exclude(pk=self.instance.pk if self.instance else None)
        )
        if number is not None and taken.exists():
            raise serializers.ValidationError(_("Another member of the team already has this number."))
        return number


class PositionSerializer(serializers.Serializer):
    """A position in the club (decision D-025): a role of the Board or of the Executive Bureau."""

    id = serializers.IntegerField(help_text="The role's id.")
    name = serializers.CharField(help_text="The role's name.")
    unit = OrgUnitSummarySerializer()

    def to_representation(self, position):
        unit, role = position
        return {"id": role.pk, "name": role.name, "unit": OrgUnitSummarySerializer(unit).data}


class ProjectChoiceSerializer(serializers.Serializer):
    """A project a member may be put in."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    category = serializers.CharField()


class MemberAddingSerializer(serializers.Serializer):
    """What the viewer may do in the web app's "Add a member" form (decisions D-024, D-025)."""

    can_add = serializers.BooleanField()
    can_manage = serializers.BooleanField(help_text="Whether they edit the members (Board, Team Manager: D-025).")
    unit_ids = serializers.ListField(child=serializers.IntegerField(), help_text="The units they may add to.")
    roles = RoleSerializer(many=True, help_text="The roles they may give (each unit takes those of its scope).")
    positions = PositionSerializer(many=True, help_text="The positions in the club they may give (club admins).")
    projects = ProjectChoiceSerializer(many=True, help_text="The projects they may put the member in.")


def check_position(position, adding):
    """The (unit, role) of a position in the club the viewer may give, or a validation error."""
    for unit, role in adding.positions():
        if role.pk == position.pk:
            return unit, role
    raise serializers.ValidationError({"position_id": _("Only the Board and the Team Manager give this position.")})


def check_projects(projects, adding):
    allowed = set(adding.projects().values_list("pk", flat=True))
    if any(project.pk not in allowed for project in projects):
        raise serializers.ValidationError({"project_ids": _("You cannot put members in this project.")})
    return projects


def join_projects(member, projects):
    """Put the member in these projects (from today), once each."""
    from apps.projects.models import ProjectMember  # the projects app builds on this one

    today = timezone.localdate()
    current = set(
        ProjectMember.objects.filter(member=member, is_active=True, end_date__isnull=True).values_list(
            "project_id", flat=True
        )
    )
    ProjectMember.objects.bulk_create(
        ProjectMember(project=project, member=member, start_date=today) for project in projects
        if project.pk not in current
    )


def _open_projects():
    from apps.projects.models import Project, ProjectStatus  # the projects app builds on this one

    return Project.objects.filter(status__in=(ProjectStatus.PLANNED, ProjectStatus.ACTIVE))


class MemberAddSerializer(serializers.Serializer):
    """Add a member from the web app (decision D-024): who they are and their first membership. They then
    sign in with a code e-mailed to this address: no password."""

    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=254)
    org_unit_id = serializers.PrimaryKeyRelatedField(source="org_unit", queryset=OrgUnit.objects.all())
    role_id = serializers.PrimaryKeyRelatedField(source="role", queryset=Role.objects.all())
    member_level = serializers.ChoiceField(
        choices=MemberLevel.choices, required=False, allow_null=True,
        help_text="Main or junior: required, but for a leadership role (which has none).",
    )
    study_level = serializers.ChoiceField(choices=StudyLevel.choices, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=50, required=False, allow_blank=True)
    position_id = serializers.PrimaryKeyRelatedField(
        source="position", queryset=Role.objects.all(), required=False, allow_null=True,
        help_text="A position in the club besides the membership (decision D-025): the Board and Team Manager only.",
    )
    project_ids = serializers.PrimaryKeyRelatedField(
        source="projects", many=True, required=False, queryset=_open_projects(),
        help_text="The projects under way or planned the member joins.",
    )

    def validate_first_name(self, name):
        return " ".join(name.split())

    def validate_last_name(self, name):
        return " ".join(name.split())

    def validate_email(self, email):
        email = Member.objects.normalize_email(email.strip())
        if Member.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError(_("A member of the ERP already has this address."))
        return email

    def validate(self, attrs):
        adding = self.context["adding"]
        if attrs.get("position") is not None:
            attrs["position"] = check_position(attrs["position"], adding)
        check_projects(attrs.get("projects", []), adding)
        return membership_attrs(attrs, adding)

    def create(self, validated_data):
        unit, role = validated_data.pop("org_unit"), validated_data.pop("role")
        level = validated_data.pop("member_level", None)
        position = validated_data.pop("position", None)
        projects = validated_data.pop("projects", [])
        member = Member.objects.create_user(password=None, join_date=timezone.localdate(), **validated_data)
        membership = Membership.objects.create(
            member=member, org_unit=unit, role=role, member_level=level, start_date=timezone.localdate(),
            is_primary=True,
        )
        problems = charter_problems(membership)
        if problems:  # the view's transaction undoes the member too
            raise serializers.ValidationError({"org_unit_id": problems})
        if position is not None:
            position_unit, position_role = position
            Membership.objects.create(
                member=member, org_unit=position_unit, role=position_role, start_date=timezone.localdate(),
                is_primary=False,
            )
        join_projects(member, projects)
        return member


def membership_attrs(attrs, adding):
    """Checks a membership given through the web app (unit, role, level), as in MemberAddSerializer."""
    unit, role = attrs["org_unit"], attrs["role"]
    if unit.pk not in adding.unit_ids:
        raise serializers.ValidationError({"org_unit_id": _("You cannot add members to this unit.")})
    if role.scope != scope_of(unit):
        raise serializers.ValidationError({"role_id": _("This role is not one of this unit's.")})
    if role.is_leadership and not adding.is_admin:
        raise serializers.ValidationError({"role_id": _("Only a club admin gives a leadership role.")})
    if role.is_leadership:
        attrs["member_level"] = None
    elif not attrs.get("member_level"):
        raise serializers.ValidationError({"member_level": _("Choose main or junior.")})
    return attrs


def set_projects(member, projects):
    """The projects under way or planned the member is in become exactly these: the others end today."""
    from apps.projects.models import ProjectMember  # the projects app builds on this one

    wanted = {project.pk for project in projects}
    ending = ProjectMember.objects.filter(
        member=member, is_active=True, end_date__isnull=True, project__in=_open_projects()
    ).exclude(project_id__in=wanted)
    ending.update(is_active=False, end_date=timezone.localdate())
    join_projects(member, projects)


class MemberManageSerializer(serializers.ModelSerializer):
    """A member as the club admins edit them in the web app (decision D-025): who they are, their status, the
    projects they are in. Their memberships are added and ended through their own endpoints."""

    project_ids = serializers.PrimaryKeyRelatedField(
        many=True, required=False, write_only=True, queryset=_open_projects(),
        help_text="The projects under way or planned they are in: the others end today.",
    )
    memberships = serializers.SerializerMethodField(help_text="Their current memberships.")
    projects = serializers.SerializerMethodField(help_text="The ids of the projects under way or planned they are in.")

    class Meta:
        model = Member
        fields = [
            "id", "first_name", "last_name", "email", "phone", "study_level", "status", "project_ids",
            "memberships", "projects",
        ]
        read_only_fields = ["id"]

    def validate_first_name(self, name):
        return " ".join(name.split())

    def validate_last_name(self, name):
        return " ".join(name.split())

    def validate_email(self, email):
        email = Member.objects.normalize_email(email.strip())
        if Member.objects.filter(email__iexact=email).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError(_("A member of the ERP already has this address."))
        return email

    def update(self, member, validated_data):
        projects = validated_data.pop("project_ids", None)
        member = super().update(member, validated_data)
        if projects is not None:
            set_projects(member, projects)
        return member

    @extend_schema_field(MembershipSerializer(many=True))
    def get_memberships(self, member):
        current = member.memberships.filter(end_date__isnull=True).select_related("org_unit", "role")
        return MembershipSerializer(current.order_by("-is_primary", "org_unit__name"), many=True).data

    @extend_schema_field(serializers.ListField(child=serializers.IntegerField()))
    def get_projects(self, member):
        from apps.projects.models import ProjectMember  # the projects app builds on this one

        rows = ProjectMember.objects.filter(
            member=member, is_active=True, end_date__isnull=True, project__in=_open_projects()
        )
        return sorted(set(rows.values_list("project_id", flat=True)))


class MembershipAddSerializer(serializers.Serializer):
    """A membership the club admins give a member in the web app (decision D-025): a unit, a role and a level,
    or a position in the club."""

    org_unit_id = serializers.PrimaryKeyRelatedField(
        source="org_unit", queryset=OrgUnit.objects.all(), required=False, allow_null=True
    )
    role_id = serializers.PrimaryKeyRelatedField(source="role", queryset=Role.objects.all(), required=False, allow_null=True)
    member_level = serializers.ChoiceField(choices=MemberLevel.choices, required=False, allow_null=True)
    position_id = serializers.PrimaryKeyRelatedField(
        source="position", queryset=Role.objects.all(), required=False, allow_null=True,
        help_text="A position in the club, instead of a unit and a role.",
    )

    def validate(self, attrs):
        adding, member = self.context["adding"], self.context["member"]
        if attrs.get("position") is not None:
            attrs["org_unit"], attrs["role"] = check_position(attrs["position"], adding)
            attrs["member_level"] = None
        elif attrs.get("org_unit") is None or attrs.get("role") is None:
            raise serializers.ValidationError({"org_unit_id": _("Choose a unit and a role, or a position.")})
        else:
            membership_attrs(attrs, adding)
        held = member.memberships.filter(end_date__isnull=True, org_unit=attrs["org_unit"], role=attrs["role"])
        if held.exists():
            raise serializers.ValidationError({"role_id": _("The member already holds this role in this unit.")})
        return attrs

    def create(self, validated_data):
        member = self.context["member"]
        has_primary = member.memberships.filter(end_date__isnull=True, is_primary=True).exists()
        today = timezone.localdate()
        is_primary = not has_primary and validated_data.get("position") is None
        # Ended and given again the same day: (member, unit, role, start date) is unique, so reopen that row
        # instead of failing on the constraint.
        membership = member.memberships.filter(
            org_unit=validated_data["org_unit"], role=validated_data["role"], start_date=today
        ).first()
        if membership is not None:
            membership.end_date = None
            membership.member_level = validated_data.get("member_level")
            membership.is_primary = is_primary
            membership.save()
        else:
            membership = Membership.objects.create(
                member=member, org_unit=validated_data["org_unit"], role=validated_data["role"],
                member_level=validated_data.get("member_level"), start_date=today, is_primary=is_primary,
            )
        problems = charter_problems(membership)
        if problems:  # the view's transaction undoes it
            raise serializers.ValidationError({"org_unit_id": problems})
        return membership


class MemberCreateSerializer(serializers.ModelSerializer):
    """
    Admin-only serializer for invite-only member creation.
    No password field — members authenticate exclusively via email OTP.
    """

    class Meta:
        model = Member
        fields = ["id", "first_name", "last_name", "email", "phone", "facebook_url", "skill",
                  "status", "join_date"]
        read_only_fields = ["id"]

    def validate_email(self, value):
        # The login code looks the address up case-insensitively: two accounts differing only by case would
        # leave one of them unable to log in.
        if Member.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(_("A member with this e-mail already exists."))
        return value

    def create(self, validated_data):
        # password=None gives an unusable password — login is OTP-only.
        return Member.objects.create_user(password=None, **validated_data)
