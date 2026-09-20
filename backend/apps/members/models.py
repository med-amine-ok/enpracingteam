from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models import F, Q


# ---------- Enums (PostgreSQL ENUM types become TextChoices) ----------

class RoleScope(models.TextChoices):
    CLUB = "club", "Club"
    FS_TEAM = "fs_team", "Formula Student team"


class MemberRoleType(models.TextChoices):
    ADMIN = "admin", "Admin"
    HEAD_OF_DEPARTMENT = "head_of_department", "Head of department"
    MEMBER = "member", "Member"


class MemberStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    ALUMNI = "alumni", "Alumni"
    ON_LEAVE = "on_leave", "On leave"


class MemberLevel(models.TextChoices):
    MAIN = "main", "Main"
    JUNIOR = "junior", "Junior"


class OrgUnitType(models.TextChoices):
    ROOT = "root", "ENP Racing Team"
    GOVERNING_BODY = "governing_body", "Governing body"
    CLUB_DEPARTMENT = "club_department", "Club department"
    CLUB_POLE = "club_pole", "Club pole"
    FS_TEAM = "fs_team", "Formula Student team"
    FS_DEPARTMENT = "fs_department", "Formula Student department"


# ---------- Member (the login user) ----------

class MemberManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("The email must be set")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if not extra_fields["is_staff"] or not extra_fields["is_superuser"]:
            raise ValueError("Superuser must have is_staff=True and is_superuser=True.")
        return self._create_user(email, password, **extra_fields)


class Member(AbstractBaseUser, PermissionsMixin):
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=50, blank=True)
    skill = models.CharField(max_length=255, blank=True)
    status = models.CharField(
        max_length=20, choices=MemberStatus.choices, default=MemberStatus.ACTIVE
    )
    join_date = models.DateField(null=True, blank=True)

    # Django login/admin flags. Not the same thing as `status`:
    # is_active = allowed to log in, status = club situation (active/alumni/on_leave).
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = MemberManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    class Meta:
        indexes = [models.Index(fields=["status"], name="idx_member_status")]

    def __str__(self):
        full_name = f"{self.first_name} {self.last_name}".strip()
        return full_name or self.email


class AlumniProfile(models.Model):
    member = models.OneToOneField(
        Member, on_delete=models.CASCADE, related_name="alumni_profile"
    )
    graduation_year = models.IntegerField(null=True, blank=True)
    current_position = models.CharField(max_length=255, blank=True)
    current_company = models.CharField(max_length=255, blank=True)
    linkedin_url = models.URLField(blank=True)
    willing_to_mentor = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Alumni profile: {self.member}"


# ---------- Organization ----------

class Role(models.Model):
    name = models.CharField(max_length=150)
    role_type = models.CharField(max_length=30, choices=MemberRoleType.choices)
    scope = models.CharField(max_length=20, choices=RoleScope.choices)
    is_leadership = models.BooleanField(default=False)
    can_be_project_manager = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["name", "scope"], name="uq_role_name_scope"),
        ]

    def __str__(self):
        return f"{self.name} ({self.scope})"


class OrgUnit(models.Model):
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=30, choices=OrgUnitType.choices)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )
    is_temporary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["type"], name="idx_org_unit_type")]
        constraints = [
            models.CheckConstraint(
                condition=~Q(parent=F("id")), name="ck_org_unit_not_own_parent"
            ),
        ]

    def __str__(self):
        return self.name


class Membership(models.Model):
    member = models.ForeignKey(
        Member, on_delete=models.PROTECT, related_name="memberships"
    )
    org_unit = models.ForeignKey(
        OrgUnit, on_delete=models.PROTECT, related_name="memberships"
    )
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="memberships")
    # 'main' / 'junior' for regular members, NULL for leadership roles (checked in Django later).
    member_level = models.CharField(
        max_length=10, choices=MemberLevel.choices, null=True, blank=True
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)  # NULL = currently active
    is_primary = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # subsystem_id comes later, when the Subsystem model exists (projects app).

    class Meta:
        indexes = [
            models.Index(
                fields=["org_unit", "member_level"],
                condition=Q(end_date__isnull=True),
                name="idx_mship_unit_level_active",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["member", "org_unit", "role", "start_date"],
                name="uq_membership_member_org_role_start",
            ),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True)
                | Q(start_date__isnull=True)
                | Q(end_date__gte=F("start_date")),
                name="ck_membership_dates",
            ),
            # At most one active primary membership per member.
            models.UniqueConstraint(
                fields=["member"],
                condition=Q(is_primary=True, end_date__isnull=True),
                name="uq_membership_one_active_primary",
            ),
        ]

    def __str__(self):
        return f"{self.member} - {self.role.name} @ {self.org_unit.name}"
