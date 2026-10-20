from rest_framework import serializers

from .models import Member, Membership, OrgUnit, Role


class OrgUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrgUnit
        fields = ["id", "name", "type", "parent", "is_temporary", "is_active"]


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


class MemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = Member
        fields = ["id", "first_name", "last_name", "email", "phone", "facebook_url", "skill", "status", "join_date"]
        read_only_fields = ["id"]


class MemberDetailSerializer(MemberSerializer):
    memberships = MembershipSerializer(many=True, read_only=True)

    class Meta(MemberSerializer.Meta):
        fields = MemberSerializer.Meta.fields + ["memberships"]


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

    def create(self, validated_data):
        # password=None gives an unusable password — login is OTP-only.
        return Member.objects.create_user(password=None, **validated_data)
