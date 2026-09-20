from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import AlumniProfile, Member, Membership, OrgUnit, Role


@admin.register(Member)
class MemberAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "status", "is_staff")
    list_filter = ("status", "is_staff", "is_active")
    search_fields = ("email", "first_name", "last_name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name", "phone", "skill")}),
        ("Club", {"fields": ("status", "join_date")}),
        (
            "Permissions",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Important dates", {"fields": ("last_login",)}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "first_name", "last_name", "password1", "password2"),
            },
        ),
    )


@admin.register(OrgUnit)
class OrgUnitAdmin(admin.ModelAdmin):
    list_display = ("name", "type", "parent", "is_temporary", "is_active")
    list_filter = ("type", "is_active", "is_temporary")
    search_fields = ("name",)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "scope", "role_type", "is_leadership", "can_be_project_manager")
    list_filter = ("scope", "role_type", "is_leadership")


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("member", "org_unit", "role", "member_level", "is_primary", "start_date", "end_date")
    list_filter = ("org_unit", "role", "member_level", "is_primary")
    search_fields = ("member__email", "member__first_name", "member__last_name")


@admin.register(AlumniProfile)
class AlumniProfileAdmin(admin.ModelAdmin):
    list_display = ("member", "graduation_year", "current_company", "willing_to_mentor")