import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy

class LoginOTP(models.Model):
    """One row per OTP sent. The plaintext code is never stored, only an HMAC digest."""
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="login_otps", verbose_name=_("member")
    )
    code_hash = models.CharField(_("code hash"), max_length=64)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    expires_at = models.DateTimeField(_("expires at"))
    attempts = models.PositiveSmallIntegerField(_("attempts"), default=0)
    used_at = models.DateTimeField(_("used at"), null=True, blank=True)
    requested_ip = models.GenericIPAddressField(_("requested from IP"), null=True, blank=True)

    class Meta:
        verbose_name = _("login code")
        verbose_name_plural = _("login codes")
        indexes = [
            models.Index(fields=["member", "-created_at"], name="idx_login_otp_member_created"),
        ]

    def __str__(self):
        return f"OTP for member_id={self.member_id} ({'used' if self.used_at else 'pending'})"

    @staticmethod
    def _hash(code: str) -> str:
        # HMAC keyed with SECRET_KEY: a DB leak alone doesn't let an attacker
        # brute-force codes offline without also having the app secret.
        return hmac.new(settings.SECRET_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()

    @classmethod
    def generate_code(cls) -> str:
        # secrets.randbelow is CSPRNG-backed (not random.randint).
        n = secrets.randbelow(10 ** settings.OTP_LENGTH)
        return str(n).zfill(settings.OTP_LENGTH)

    @classmethod
    def issue(cls, member, ip=None):
        code = cls.generate_code()
        otp = cls.objects.create(
            member=member,
            code_hash=cls._hash(code),
            expires_at=timezone.now() + timedelta(seconds=settings.OTP_TTL_SECONDS),
            requested_ip=ip,
        )
        return otp, code

    def is_valid(self) -> bool:
        return (
            self.used_at is None
            and timezone.now() < self.expires_at
            and self.attempts < settings.OTP_MAX_ATTEMPTS
        )

    def check_code(self, code: str) -> bool:
        # Constant-time comparison: prevents timing attacks revealing partial matches.
        return hmac.compare_digest(self.code_hash, self._hash(code))

# ---------- Enums (PostgreSQL ENUM types become TextChoices) ----------

class RoleScope(models.TextChoices):
    CLUB = "club", _("Club")
    FS_TEAM = "fs_team", _("Formula Student team")


class MemberRoleType(models.TextChoices):
    ADMIN = "admin", _("Admin")
    HEAD_OF_DEPARTMENT = "head_of_department", _("Head of department")
    MEMBER = "member", _("Member")


class MemberStatus(models.TextChoices):
    ACTIVE = "active", _("Active")
    ALUMNI = "alumni", _("Alumni")
    ON_LEAVE = "on_leave", _("On leave")


class EmailTopic(models.TextChoices):
    """The e-mails of the ERP, by subject: each member turns off those they do not want (decision D-023),
    except the warnings and exclusions, which the charter has notified in writing
    (apps/communication/emails.py TOPICS)."""

    TASKS = "tasks", _("Tasks: assignments, deadlines, validations, blockers")
    PURCHASES = "purchases", _("Purchases, stock and budgets")
    SESSIONS = "sessions", _("Sessions and their actions")
    WORKSHOP = "workshop", _("Workshop: loans and bookings")
    RANKING = "ranking", _("Monthly ranking")
    VOLUNTEERING = "volunteering", _("Volunteering reminders")
    DISCIPLINE = "discipline", _("Warnings and exclusions")


# Always e-mailed, whatever the member chose.
ALWAYS_EMAILED = {EmailTopic.DISCIPLINE}


class StudyLevel(models.TextChoices):
    """The member's year at the school (charter art. 13)."""

    PREP_1 = "prep_1", _("1st year of preparatory classes")
    PREP_2 = "prep_2", _("2nd year of preparatory classes")
    YEAR_3 = "year_3", _("3rd year")
    YEAR_4 = "year_4", _("4th year")
    YEAR_5 = "year_5", _("5th year")
    POSTGRADUATE = "postgraduate", _("Postgraduate")
    OTHER = "other", pgettext_lazy("study level", "Other")


# The preparatory classes: such students belong only to the Media department (charter art. 13).
PREPARATORY_LEVELS = (StudyLevel.PREP_1, StudyLevel.PREP_2)


class MemberLevel(models.TextChoices):
    MAIN = "main", _("Main")
    JUNIOR = "junior", _("Junior")


class OrgUnitType(models.TextChoices):
    ROOT = "root", _("ENP Racing Team")
    GOVERNING_BODY = "governing_body", _("Governing body")
    CLUB_DEPARTMENT = "club_department", _("Club department")
    CLUB_POLE = "club_pole", _("Club pole")
    FS_TEAM = "fs_team", _("Formula Student team")
    FS_DEPARTMENT = "fs_department", _("Formula Student department")


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
    code = models.SlugField(_("code"), max_length=100, unique=True, null=True, blank=True)
    first_name = models.CharField(_("first name"), max_length=150)
    last_name = models.CharField(_("last name"), max_length=150)
    email = models.EmailField(_("email address"), unique=True)
    phone = models.CharField(_("phone"), max_length=50, blank=True)
    facebook_url = models.URLField(_("Facebook profile"), max_length=500, blank=True)
    skill = models.CharField(_("skills"), max_length=255, blank=True)
    status = models.CharField(
        _("status"), max_length=20, choices=MemberStatus.choices, default=MemberStatus.ACTIVE
    )
    join_date = models.DateField(_("join date"), null=True, blank=True)
    study_level = models.CharField(_("year of study"), max_length=20, choices=StudyLevel.choices, blank=True)
    study_field = models.CharField(_("field of study"), max_length=150, blank=True)
    # The member's number on the team's cards, chosen by them (1 to 99); an alumni's number is free again.
    race_number = models.PositiveSmallIntegerField(
        _("race number"), null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(99)]
    )
    # Language of the interface and e-mails for this member. Empty = follow the browser.
    # The choices (language names) are shown in their own language on purpose.
    language = models.CharField(_("language"), max_length=10, choices=settings.LANGUAGES, blank=True, default="")
    # The subjects of the e-mails this member turned off (EmailTopic values); the ERP still shows them.
    muted_email_topics = models.JSONField(_("e-mails turned off"), default=list, blank=True)

    # Django login/admin flags. Not the same thing as `status`:
    # is_active = allowed to log in, status = club situation (active/alumni/on_leave).
    is_active = models.BooleanField(_("active"), default=True)
    is_staff = models.BooleanField(_("staff status"), default=False)

    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    objects = MemberManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    class Meta:
        verbose_name = _("member")
        verbose_name_plural = _("members")
        indexes = [models.Index(fields=["status"], name="idx_member_status")]
        constraints = [
            models.CheckConstraint(
                condition=Q(race_number__gte=1, race_number__lte=99), name="chk_member_race_number_range"
            ),
            models.UniqueConstraint(
                fields=["race_number"], condition=~Q(status=MemberStatus.ALUMNI),
                name="uniq_member_race_number_in_team",
                violation_error_message=_("Another member of the team already has this number."),
            ),
        ]

    def __str__(self):
        full_name = f"{self.first_name} {self.last_name}".strip()
        return full_name or self.email


class AlumniProfile(models.Model):
    member = models.OneToOneField(
        Member, on_delete=models.CASCADE, related_name="alumni_profile", verbose_name=_("member")
    )
    graduation_year = models.IntegerField(_("graduation year"), null=True, blank=True)
    current_position = models.CharField(_("current position"), max_length=255, blank=True)
    current_company = models.CharField(_("current company"), max_length=255, blank=True)
    linkedin_url = models.URLField(_("LinkedIn profile"), blank=True)
    willing_to_mentor = models.BooleanField(_("willing to mentor"), default=False)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("alumni profile")
        verbose_name_plural = _("alumni profiles")

    def __str__(self):
        return f"Alumni profile: {self.member}"


# ---------- Organization ----------

class Role(models.Model):
    code = models.SlugField(_("code"), max_length=100, unique=True, null=True, blank=True)
    name = models.CharField(_("name"), max_length=150)
    role_type = models.CharField(_("role type"), max_length=30, choices=MemberRoleType.choices)
    scope = models.CharField(_("scope"), max_length=20, choices=RoleScope.choices)
    is_leadership = models.BooleanField(_("leadership role"), default=False)
    can_be_project_manager = models.BooleanField(_("can be project manager"), default=False)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("role")
        verbose_name_plural = _("roles")
        constraints = [
            models.UniqueConstraint(fields=["name", "scope"], name="uq_role_name_scope"),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_scope_display()})"


class OrgUnit(models.Model):
    code = models.SlugField(_("code"), max_length=100, unique=True, null=True, blank=True)
    name = models.CharField(_("name"), max_length=255)
    type = models.CharField(_("type"), max_length=30, choices=OrgUnitType.choices)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children",
        verbose_name=_("parent unit"),
    )
    # What the unit does, shown on its department page (the team's Figma, decision D-022).
    description = models.TextField(_("description"), blank=True)
    is_temporary = models.BooleanField(_("temporary"), default=False)
    is_active = models.BooleanField(_("active"), default=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("organisational unit")
        verbose_name_plural = _("organisational units")
        indexes = [models.Index(fields=["type"], name="idx_org_unit_type")]
        constraints = [
            models.CheckConstraint(
                condition=~Q(parent=F("id")), name="ck_org_unit_not_own_parent"
            ),
        ]

    def __str__(self):
        return self.name
    def descendant_ids(self):
        """This unit's id plus the ids of every unit below it in the tree."""
        ids = [self.pk]
        frontier = [self.pk]
        while frontier:
            frontier = list(
                OrgUnit.objects.filter(parent_id__in=frontier).values_list("pk", flat=True)
            )
            ids.extend(frontier)
        return ids


class Membership(models.Model):
    member = models.ForeignKey(
        Member, on_delete=models.PROTECT, related_name="memberships", verbose_name=_("member")
    )
    org_unit = models.ForeignKey(
        OrgUnit, on_delete=models.PROTECT, related_name="memberships", verbose_name=_("organisational unit")
    )
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="memberships", verbose_name=_("role"))
    # Optional "home" subsystem. Detailed assignments live in subsystems.MemberSubsystem.
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="memberships", verbose_name=_("home subsystem"),
    )
    # 'main' / 'junior' for regular members, NULL for leadership roles (checked in Django later).
    member_level = models.CharField(
        _("member level"), max_length=10, choices=MemberLevel.choices, null=True, blank=True
    )
    start_date = models.DateField(_("start date"), null=True, blank=True)
    end_date = models.DateField(_("end date"), null=True, blank=True)  # NULL = currently active
    is_primary = models.BooleanField(_("primary membership"), default=True)
    charter_exception = models.TextField(
        _("exception of the Executive Bureau (art. 13)"), blank=True,
        help_text=_("Its reason, for a student of the preparatory classes outside the Media department."),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    # subsystem_id comes later, when the Subsystem model exists (projects app).

    class Meta:
        verbose_name = _("membership")
        verbose_name_plural = _("memberships")
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
            # No duplicate active membership (same member, unit and role). The constraint
            # above includes start_date, which is often NULL, and NULLs never collide.
            models.UniqueConstraint(
                fields=["member", "org_unit", "role"],
                condition=Q(end_date__isnull=True),
                name="uq_membership_active_member_org_role",
            ),
        ]

    def __str__(self):
        return f"{self.member} - {self.role.name} @ {self.org_unit.name}"

    def clean(self):
        """The charter's rules on memberships (art. 13 and 14, decision D-019): refused, with the rule quoted."""
        from .rules import charter_problems

        problems = charter_problems(self)
        if problems:
            raise ValidationError(problems)
