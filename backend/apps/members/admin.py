from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import AlumniProfile, Member, MemberRoleType, Membership, OrgUnit, Role


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
    ordering = ("id",)
    list_select_related = ("parent",)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "scope", "role_type", "is_leadership",
                    "can_be_project_manager", "bureau")
    list_filter = ("scope", "role_type", "is_leadership")

    @admin.display(boolean=True, description="Bureau")
    def bureau(self, obj):
        return obj.in_executive_bureau


class OrgUnitFilter(admin.SimpleListFilter):
    """Org-unit filter that treats Executive Bureau as a virtual entry.

    Clicking 'Executive Bureau' shows all active memberships whose role_type
    is admin or head_of_department — regardless of their actual org_unit.
    All other org units filter normally by the FK.
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
        bureau = OrgUnit.objects.filter(code="executive-bureau").first()
        if bureau and self.value() == str(bureau.pk):
            # Virtual: show all bureau-qualifying memberships
            return queryset.filter(
                end_date__isnull=True,
                role__role_type__in=[MemberRoleType.ADMIN, MemberRoleType.HEAD_OF_DEPARTMENT],
            )
        return queryset.filter(org_unit_id=self.value())


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("member", "org_unit", "role", "member_level",
                    "in_bureau", "is_primary", "start_date", "end_date")
    list_filter = (OrgUnitFilter, "role", "member_level", "is_primary")
    search_fields = ("member__email", "member__first_name", "member__last_name")
    list_select_related = ("member", "org_unit", "role")

    @admin.display(boolean=True, description="Bureau")
    def in_bureau(self, obj):
        if obj.end_date is not None:
            return False
        return obj.role.in_executive_bureau
        


@admin.register(AlumniProfile)
class AlumniProfileAdmin(admin.ModelAdmin):
    list_display = ("member", "graduation_year", "current_company", "willing_to_mentor")