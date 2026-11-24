
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.core.exceptions import PermissionDenied
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from .access import DEPARTMENT_HEADS_GROUP, headed_unit_ids, is_club_admin
from .models import (AlumniProfile, LoginOTP, Member, Membership,
                     OrgUnit, OrgUnitType, Role, RoleScope)


def limit_membership_choices(request, db_field, kwargs):
    """A department head (not a club admin) gives memberships only in the units they head, with a role that is
    not a leadership one: otherwise they could put themselves in the Board of Directors, whose signal makes them
    a club admin (the Admins group, every right)."""
    if is_club_admin(request.user):
        return
    if db_field.name == "org_unit":
        kwargs["queryset"] = OrgUnit.objects.filter(pk__in=headed_unit_ids(request.user))
    elif db_field.name == "role":
        kwargs["queryset"] = Role.objects.filter(is_leadership=False)


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    fields = ("org_unit", "role", "_role_type", "_scope", "member_level",
              "is_primary", "start_date", "end_date", "charter_exception")
    readonly_fields = ("_role_type", "_scope")
    autocomplete_fields = ("org_unit", "role")

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        limit_membership_choices(request, db_field, kwargs)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    @admin.display(description=_("Role type"))
    def _role_type(self, obj):
        return obj.role.get_role_type_display() if obj.pk else "-"

    @admin.display(description=_("Scope"))
    def _scope(self, obj):
        return obj.role.get_scope_display() if obj.pk else "-"


class AlumniProfileInline(admin.StackedInline):
    """The profile an alumni fills in themselves; shown on their sheet only while their status is "alumni"."""
    model = AlumniProfile
    extra = 0
    max_num = 1


@admin.register(Member)
class MemberAdmin(BaseUserAdmin):
    ordering = ("id",)
    list_display = ("id","email", "first_name", "last_name", "phone", "facebook_url", "status", "is_staff")
    list_filter = ("status", "is_staff", "is_active")
    search_fields = ("email", "first_name", "last_name")
    inlines = [MembershipInline, AlumniProfileInline]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (_("Personal info"), {"fields": ("first_name", "last_name", "phone", "facebook_url", "skill")}),
        (_("Club"), {"fields": ("status", "join_date", "study_level", "study_field", "race_number")}),
        (_("Preferences"), {"fields": ("language",)}),
        (
            _("Permissions"),
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        (_("Important dates"), {"fields": ("last_login",)}),
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
    # Fields that grant rights: only superusers may change them, otherwise anyone with
    # "change member" (e.g. a department head) could make themselves superuser.
    permission_fields = ("is_staff", "is_superuser", "groups", "user_permissions")

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if is_club_admin(request.user):
            return qs
        # Department heads (and any other staff): the members of the units they head, plus themselves.
        return qs.filter(
            Q(pk=request.user.pk)
            | Q(memberships__end_date__isnull=True, memberships__org_unit_id__in=headed_unit_ids(request.user))
        ).distinct()

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if not request.user.is_superuser:
            readonly += [f for f in self.permission_fields if f not in readonly]
        if obj is not None and not is_club_admin(request.user) and "email" not in readonly:
            # The e-mail is where the login code goes: a head changing it would take over the account.
            readonly.append("email")
        return readonly

    def has_change_permission(self, request, obj=None):
        # Only a superuser edits a superuser (else an Admins member could set their password and log in as them).
        if obj is not None and obj.is_superuser and not request.user.is_superuser:
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.is_superuser and not request.user.is_superuser:
            return False
        return super().has_delete_permission(request, obj)

    def user_change_password(self, request, id, form_url=""):
        # A department head may change only their own password; the club admins anyone's they may edit.
        if not is_club_admin(request.user) and str(id) != str(request.user.pk):
            raise PermissionDenied
        return super().user_change_password(request, id, form_url)


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
    title = _("organisational unit")
    parameter_name = "org_unit"

    def lookups(self, request, model_admin):
        return [
            (str(u.pk), str(u))
            for u in OrgUnit.objects.filter(is_active=True).order_by("id")
        ]

    def queryset(self, request, queryset):
        # No filter, an empty value (?org_unit=) or a non-numeric one (hand-edited URL):
        # show the unfiltered list instead of crashing on the integer primary key lookup.
        value = self.value()
        if not value or not value.isdigit():
            return queryset

        unit = OrgUnit.objects.filter(pk=int(value)).first()
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
    list_filter = (OrgUnitFilter, "role__role_type", "role__scope", "role", "member_level", "is_primary")
    search_fields = ("member__email", "member__first_name", "member__last_name")
    autocomplete_fields = ("member", "org_unit", "role")
    list_select_related = ("member", "org_unit", "role")

    @admin.display(description=_("Role type"))
    def role_type(self, obj):
        return obj.role.get_role_type_display()

    @admin.display(description=_("Scope"))
    def scope(self, obj):
        return obj.role.get_scope_display()

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        limit_membership_choices(request, db_field, kwargs)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if is_club_admin(request.user):
            return qs
        if request.user.groups.filter(name=DEPARTMENT_HEADS_GROUP).exists():
            return qs.filter(org_unit_id__in=headed_unit_ids(request.user))
        return qs.none()


@admin.register(AlumniProfile)
class AlumniProfileAdmin(admin.ModelAdmin):
    list_display = ("member", "graduation_year", "current_company", "willing_to_mentor")


@admin.register(LoginOTP)
class LoginOTPAdmin(admin.ModelAdmin):
    """Read-only view of OTP history for ops/debugging."""
    list_display = ("member", "created_at", "expires_at", "attempts", "_status", "requested_ip")
    list_filter = ("created_at",)
    search_fields = ("member__email", "member__first_name", "member__last_name")
    readonly_fields = ("member", "code_hash", "created_at", "expires_at", "attempts",
                       "used_at", "requested_ip")
    list_select_related = ("member",)
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(description=_("Status"))
    def _status(self, obj):
        if obj.used_at:
            return _("Used")
        from django.utils import timezone
        if timezone.now() > obj.expires_at:
            return _("Expired")
        return _("Pending")