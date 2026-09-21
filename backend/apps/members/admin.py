
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import (AlumniProfile, Member, MemberRoleType, Membership,
                     OrgUnit, OrgUnitType, Role, RoleScope)


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    fields = ("org_unit", "role", "_role_type", "_scope", "member_level",
              "is_primary", "start_date", "end_date")
    readonly_fields = ("_role_type", "_scope")
    autocomplete_fields = ("org_unit", "role")

    @admin.display(description="Role Type")
    def _role_type(self, obj):
        return obj.role.get_role_type_display() if obj.pk else "-"

    @admin.display(description="Scope")
    def _scope(self, obj):
        return obj.role.get_scope_display() if obj.pk else "-"


@admin.register(Member)
class MemberAdmin(BaseUserAdmin):
    ordering = ("id",)
    list_display = ("id","email", "first_name", "last_name", "phone", "facebook_url", "status", "is_staff")
    list_filter = ("status", "is_staff", "is_active")
    search_fields = ("email", "first_name", "last_name")
    inlines = [MembershipInline]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name", "phone", "facebook_url", "skill")}),
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
    search_fields = ("name", "code")
    ordering = ("id",)
    list_select_related = ("parent",)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "scope", "role_type", "is_leadership",
                    "can_be_project_manager")
    list_filter = ("scope", "role_type", "is_leadership")
    search_fields = ("name", "code")


class OrgUnitFilter(admin.SimpleListFilter):
    """Org-unit filter that follows the tree.

    - ENP Racing Team (root)  -> every membership.
    - Formula Student Team    -> the team, its departments, and every fs_team-scope role.
    - Any other unit          -> that unit and everything below it.
    """
    title = "org unit"
    parameter_name = "org_unit"

    def lookups(self, request, model_admin):
        return [
            (str(u.pk), str(u))
            for u in OrgUnit.objects.filter(is_active=True).order_by("id")
        ]

    def queryset(self, request, queryset):
        if self.value() is None:
            return queryset

        unit = OrgUnit.objects.filter(pk=self.value()).first()
        if unit is None:
            return queryset.none()

        if unit.type == OrgUnitType.ROOT:
            return queryset

        ids = unit.descendant_ids()
        if unit.type == OrgUnitType.FS_TEAM:
            return queryset.filter(
                org_unit_id__in=ids
            ) | queryset.filter(role__scope=RoleScope.FS_TEAM)
        return queryset.filter(org_unit_id__in=ids)


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("member", "org_unit", "role", "role_type", "scope", "member_level",
                    "is_primary", "start_date", "end_date")
    list_filter = (OrgUnitFilter, "role", "role__role_type", "role__scope", "member_level", "is_primary")
    search_fields = ("member__email", "member__first_name", "member__last_name")
    autocomplete_fields = ("member", "org_unit", "role")
    list_select_related = ("member", "org_unit", "role")

    @admin.display(description="Role Type")
    def role_type(self, obj):
        return obj.role.role_type

    @admin.display(description="Scope")
    def scope(self, obj):
        return obj.role.scope


@admin.register(AlumniProfile)
class AlumniProfileAdmin(admin.ModelAdmin):
    list_display = ("member", "graduation_year", "current_company", "willing_to_mentor")