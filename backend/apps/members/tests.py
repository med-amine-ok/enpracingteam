import json
import logging
import re
from contextlib import redirect_stderr
from datetime import UTC, date, datetime, timedelta
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError
from django.db.models import Count
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone, translation
from rest_framework import status
from rest_framework.exceptions import NotAuthenticated
from rest_framework.test import APITestCase

from apps.members.models import (
    LoginOTP,
    Member,
    MemberRoleType,
    Membership,
    OrgUnit,
    OrgUnitType,
    Role,
    RoleScope,
)
from apps.members.serializers import MemberCreateSerializer
from apps.members.services_otp import OTPError, request_otp, verify_otp

TEST_CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}


@override_settings(CACHES=TEST_CACHES)
class LoginOTPModelTests(TestCase):
    def setUp(self):
        cache.clear()
        self.member = Member.objects.create_user(
            email="test.member@g.enp.edu.dz",
            first_name="Test",
            last_name="Member",
            password=None,
        )

    def tearDown(self):
        cache.clear()

    def test_generate_code_format(self):
        """OTP code should be exactly settings.OTP_LENGTH digits."""
        code = LoginOTP.generate_code()
        self.assertEqual(len(code), settings.OTP_LENGTH)
        self.assertTrue(code.isdigit())

    def test_hash_and_check_code(self):
        """HMAC check_code correctly matches matching code and rejects mismatch."""
        otp, code = LoginOTP.issue(self.member)
        self.assertTrue(otp.check_code(code))
        self.assertFalse(otp.check_code("000000" if code != "000000" else "111111"))

    def test_otp_is_valid_lifecycle(self):
        """Verify is_valid handles pending, used, expired, and attempt-exhausted states."""
        otp, code = LoginOTP.issue(self.member)
        self.assertTrue(otp.is_valid())

        # Used OTP is invalid
        otp.used_at = timezone.now()
        otp.save()
        self.assertFalse(otp.is_valid())

        # Expired OTP is invalid
        otp.used_at = None
        otp.expires_at = timezone.now() - timedelta(seconds=10)
        otp.save()
        self.assertFalse(otp.is_valid())

        # Max attempts reached is invalid
        otp.expires_at = timezone.now() + timedelta(minutes=5)
        otp.attempts = settings.OTP_MAX_ATTEMPTS
        otp.save()
        self.assertFalse(otp.is_valid())


@override_settings(CACHES=TEST_CACHES)
class OTPServiceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.member = Member.objects.create_user(
            email="active.member@g.enp.edu.dz",
            first_name="Active",
            last_name="Member",
            is_active=True,
            password=None,
        )
        self.inactive_member = Member.objects.create_user(
            email="inactive.member@g.enp.edu.dz",
            first_name="Inactive",
            last_name="Member",
            is_active=False,
            password=None,
        )

    def tearDown(self):
        cache.clear()

    def test_request_otp_unknown_email_anti_enumeration(self):
        """Unknown email does not raise and does not send an email or issue an OTP."""
        request_otp("nonexistent@g.enp.edu.dz", ip="127.0.0.1")
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(LoginOTP.objects.count(), 0)

    def test_request_otp_inactive_member_anti_enumeration(self):
        """Inactive member behaves identically to unknown email (anti-enumeration)."""
        request_otp(self.inactive_member.email, ip="127.0.0.1")
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(LoginOTP.objects.count(), 0)

    def test_request_otp_active_member_success(self):
        """Active member receives an email containing a 6-digit OTP code."""
        with translation.override("en"):
            request_otp(self.member.email, ip="127.0.0.1")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Your ENP Racing Team login code", mail.outbox[0].subject)
        self.assertEqual(LoginOTP.objects.filter(member=self.member).count(), 1)

    def test_request_otp_cooldown(self):
        """Requesting another OTP within cooldown window raises OTPError('cooldown')."""
        request_otp(self.member.email, ip="127.0.0.1")
        with self.assertRaises(OTPError) as ctx:
            request_otp(self.member.email, ip="127.0.0.1")
        self.assertEqual(str(ctx.exception), "cooldown")

    def test_request_otp_email_rate_limit(self):
        """Exceeding hourly rate limit for an email raises OTPError('rate_limited')."""
        with patch("apps.members.services_otp.is_in_cooldown", return_value=False):
            for _ in range(settings.OTP_MAX_REQUESTS_PER_HOUR):
                request_otp(self.member.email, ip="127.0.0.1")

            with self.assertRaises(OTPError) as ctx:
                request_otp(self.member.email, ip="127.0.0.1")
            self.assertEqual(str(ctx.exception), "rate_limited")

    def test_request_otp_ip_rate_limit(self):
        """Exceeding hourly IP rate limit raises OTPError('rate_limited')."""
        ip = "192.168.1.100"
        for i in range(settings.OTP_IP_MAX_REQUESTS_PER_HOUR):
            email = f"user{i}@g.enp.edu.dz"
            request_otp(email, ip=ip)

        with self.assertRaises(OTPError) as ctx:
            request_otp("another@g.enp.edu.dz", ip=ip)
        self.assertEqual(str(ctx.exception), "rate_limited")

    def test_verify_otp_success(self):
        """Correct code verifies, sets used_at, and returns the member."""
        otp, code = LoginOTP.issue(self.member)
        verified = verify_otp(self.member.email, code, ip="127.0.0.1")
        self.assertEqual(verified.id, self.member.id)
        otp.refresh_from_db()
        self.assertIsNotNone(otp.used_at)

    def test_verify_otp_wrong_code_increments_attempts(self):
        """Wrong code increments attempt count on OTP and raises OTPError('invalid')."""
        otp, code = LoginOTP.issue(self.member)
        wrong_code = "000000" if code != "000000" else "111111"

        with self.assertRaises(OTPError) as ctx:
            verify_otp(self.member.email, wrong_code, ip="127.0.0.1")
        self.assertEqual(str(ctx.exception), "invalid")

        otp.refresh_from_db()
        self.assertEqual(otp.attempts, 1)
        self.assertIsNone(otp.used_at)

    def test_verify_otp_kills_older_pending_otps(self):
        """Verifying one OTP marks any other pending OTPs for that member as used."""
        otp1, code1 = LoginOTP.issue(self.member)
        otp2, code2 = LoginOTP.issue(self.member)

        verify_otp(self.member.email, code2, ip="127.0.0.1")

        otp1.refresh_from_db()
        otp2.refresh_from_db()
        self.assertIsNotNone(otp2.used_at)
        self.assertIsNotNone(otp1.used_at)


@override_settings(CACHES=TEST_CACHES)
class OTPViewsAPITests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client.defaults["HTTP_ACCEPT_LANGUAGE"] = "en"  # these tests check the English messages
        self.member = Member.objects.create_user(
            email="api.member@g.enp.edu.dz",
            first_name="API",
            last_name="Member",
            is_active=True,
            password=None,
        )

    def tearDown(self):
        cache.clear()

    def test_request_otp_api_success(self):
        """POST /api/auth/otp/request/ returns 200 with generic message."""
        response = self.client.post("/api/auth/otp/request/", {"email": self.member.email})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)
        self.assertEqual(len(mail.outbox), 1)

    def test_request_otp_api_cooldown_returns_429(self):
        """Immediate second request returns 429 Too Many Requests."""
        self.client.post("/api/auth/otp/request/", {"email": self.member.email})
        response = self.client.post("/api/auth/otp/request/", {"email": self.member.email})
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn("wait", response.data["detail"].lower())

    def test_verify_otp_api_success_and_cookies(self):
        """POST /api/auth/otp/verify/ returns 200, member data, and sets auth cookies."""
        otp, code = LoginOTP.issue(self.member)

        response = self.client.post("/api/auth/otp/verify/", {
            "email": self.member.email,
            "code": code,
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["detail"], "Logged in.")

        # Check cookies
        self.assertIn(settings.AUTH_COOKIE_ACCESS, response.cookies)
        self.assertIn(settings.AUTH_COOKIE_REFRESH, response.cookies)
        self.assertIn(settings.AUTH_COOKIE_CSRF, response.cookies)
        self.assertTrue(response.cookies[settings.AUTH_COOKIE_ACCESS]["httponly"])

    def test_verify_otp_api_invalid_code_returns_400(self):
        """POST /api/auth/otp/verify/ with wrong code returns 400."""
        LoginOTP.issue(self.member)
        response = self.client.post("/api/auth/otp/verify/", {
            "email": self.member.email,
            "code": "000000",
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Invalid or expired", response.data["detail"])

    def test_refresh_token_api_flow(self):
        """POST /api/auth/refresh/ uses refresh cookie and sets a new access cookie."""
        # 1. Login to get cookies
        otp, code = LoginOTP.issue(self.member)
        login_resp = self.client.post("/api/auth/otp/verify/", {
            "email": self.member.email,
            "code": code,
        })
        refresh_token = login_resp.cookies[settings.AUTH_COOKIE_REFRESH].value

        # 2. Call refresh endpoint with refresh cookie
        self.client.cookies.clear()
        self.client.cookies[settings.AUTH_COOKIE_REFRESH] = refresh_token
        refresh_resp = self.client.post("/api/auth/refresh/")

        self.assertEqual(refresh_resp.status_code, status.HTTP_200_OK)
        self.assertIn(settings.AUTH_COOKIE_ACCESS, refresh_resp.cookies)

    def test_refresh_for_an_account_now_gone_logs_out_instead_of_failing(self):
        """The refresh cookie can outlive its account (deleted — e.g. the demo data recreated — or
        made inactive): 401 with the cookies cleared, never a server error (it was a 500)."""
        for case in ("deleted", "inactive"):
            with self.subTest(case):
                member = Member.objects.create_user(
                    email=f"{case}.test@g.enp.edu.dz", first_name="Gone", last_name="Test", password=None
                )
                _otp, code = LoginOTP.issue(member)
                login = self.client.post("/api/auth/otp/verify/", {"email": member.email, "code": code})
                self.client.cookies.clear()
                self.client.cookies[settings.AUTH_COOKIE_REFRESH] = login.cookies[settings.AUTH_COOKIE_REFRESH].value
                if case == "deleted":
                    member.delete()
                else:
                    Member.objects.filter(pk=member.pk).update(is_active=False)

                response = self.client.post("/api/auth/refresh/")
                self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
                self.assertEqual(response.cookies[settings.AUTH_COOKIE_REFRESH].value, "")  # cleared

    def test_logout_api_clears_cookies(self):
        """POST /api/auth/logout/ deletes all authentication cookies."""
        otp, code = LoginOTP.issue(self.member)
        login_resp = self.client.post("/api/auth/otp/verify/", {
            "email": self.member.email,
            "code": code,
        })
        refresh_token = login_resp.cookies[settings.AUTH_COOKIE_REFRESH].value

        self.client.cookies.clear()
        self.client.cookies[settings.AUTH_COOKIE_REFRESH] = refresh_token

        logout_resp = self.client.post("/api/auth/logout/")
        self.assertEqual(logout_resp.status_code, status.HTTP_200_OK)
        # Check access cookie deleted (max-age 0 or empty)
        self.assertEqual(logout_resp.cookies[settings.AUTH_COOKIE_ACCESS].value, "")

    def test_csrf_protection_on_cookie_authenticated_unsafe_request(self):
        """Cookie-authenticated unsafe requests must include matching X-CSRF-Token."""
        # Creating members here is for the club admins (review 24/11/2026: is_staff alone no longer suffices).
        self.member.is_staff = True
        self.member.is_superuser = True
        self.member.save()

        otp, code = LoginOTP.issue(self.member)
        login_resp = self.client.post("/api/auth/otp/verify/", {
            "email": self.member.email,
            "code": code,
        })
        access_token = login_resp.cookies[settings.AUTH_COOKIE_ACCESS].value
        csrf_token = login_resp.cookies[settings.AUTH_COOKIE_CSRF].value

        # Attempt POST without CSRF header -> 403 Forbidden
        self.client.cookies[settings.AUTH_COOKIE_ACCESS] = access_token
        self.client.cookies[settings.AUTH_COOKIE_CSRF] = csrf_token
        blocked_resp = self.client.post("/api/members/", {
            "first_name": "New",
            "last_name": "Member",
            "email": "new.member@g.enp.edu.dz",
        })
        self.assertEqual(blocked_resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("CSRF", str(blocked_resp.data))

        # Attempt POST with valid CSRF header -> 201 Created
        allowed_resp = self.client.post(
            "/api/members/",
            {
                "first_name": "New",
                "last_name": "Member",
                "email": "new.member@g.enp.edu.dz",
            },
            HTTP_X_CSRF_TOKEN=csrf_token,
        )
        self.assertEqual(allowed_resp.status_code, status.HTTP_201_CREATED)

    def test_me_endpoint_with_auth_cookie(self):
        """GET /api/auth/me/ returns authenticated user when access cookie is present."""
        otp, code = LoginOTP.issue(self.member)
        login_resp = self.client.post("/api/auth/otp/verify/", {
            "email": self.member.email,
            "code": code,
        })
        self.client.cookies[settings.AUTH_COOKIE_ACCESS] = login_resp.cookies[settings.AUTH_COOKIE_ACCESS].value

        me_resp = self.client.get("/api/auth/me/")
        self.assertEqual(me_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(me_resp.data["email"], self.member.email)

    def test_me_endpoint_unauthenticated_returns_401(self):
        """GET /api/auth/me/ without cookies/token returns 401 Unauthorized."""
        me_resp = self.client.get("/api/auth/me/")
        self.assertEqual(me_resp.status_code, status.HTTP_401_UNAUTHORIZED)


class PasswordlessInviteOnlyPolicyTests(TestCase):
    def test_member_create_serializer_sets_unusable_password(self):
        """MemberCreateSerializer must create members with unusable passwords."""
        data = {
            "first_name": "Invite",
            "last_name": "Only",
            "email": "invite.only@g.enp.edu.dz",
        }
        serializer = MemberCreateSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        member = serializer.save()

        self.assertFalse(member.has_usable_password())
        self.assertEqual(member.email, "invite.only@g.enp.edu.dz")

    def test_no_password_login_endpoint_exists(self):
        """Old password login endpoint /api/auth/login/ must not exist (404)."""
        response = self.client.post("/api/auth/login/", {
            "email": "any@g.enp.edu.dz",
            "password": "anypassword",
        })
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


# 17/10/2026 at 23:30 UTC is already 18/10/2026 at 00:30 in Algiers (UTC+1, no DST):
# code that takes "today" from UTC (or from the PC clock) gets the wrong day.
LATE_EVENING_UTC = datetime(2026, 10, 17, 23, 30, tzinfo=UTC)
ALGIERS_DATE = date(2026, 10, 18)


class ExecutiveBureauSyncTests(TestCase):
    def setUp(self):
        # Create minimal required org structure
        self.bureau = OrgUnit.objects.create(
            name="Executive Bureau",
            code="executive-bureau",
            type=OrgUnitType.GOVERNING_BODY,
        )
        self.bureau_role = Role.objects.create(
            name="Executive Bureau Member",
            code="executive-bureau-member",
            role_type=MemberRoleType.MEMBER,
            scope=RoleScope.CLUB,
            is_leadership=False,
        )
        self.lead_role = Role.objects.create(
            name="Head of Aerodynamics",
            code="head-aero",
            role_type=MemberRoleType.HEAD_OF_DEPARTMENT,
            scope=RoleScope.FS_TEAM,
            is_leadership=True,
        )
        self.dept = OrgUnit.objects.create(
            name="Aerodynamics Department",
            code="aero-dept",
            type=OrgUnitType.FS_DEPARTMENT,
        )
        self.member = Member.objects.create_user(
            email="leader@g.enp.edu.dz",
            first_name="Team",
            last_name="Leader",
            password=None,
        )

    def test_leadership_membership_syncs_to_executive_bureau(self):
        """Assigning a leadership role triggers signal to auto-create Executive Bureau membership."""
        Membership.objects.create(
            member=self.member,
            org_unit=self.dept,
            role=self.lead_role,
            is_primary=True,
        )

        bureau_membership = Membership.objects.filter(
            member=self.member,
            org_unit=self.bureau,
            role=self.bureau_role,
            end_date__isnull=True,
        ).first()

        self.assertIsNotNone(bureau_membership)

    def test_bureau_membership_ends_on_the_algiers_date(self):
        """Just before midnight UTC it is already tomorrow in Algiers: the end date is the local one."""
        lead = Membership.objects.create(
            member=self.member, org_unit=self.dept, role=self.lead_role, is_primary=True,
        )
        with patch("django.utils.timezone.now", return_value=LATE_EVENING_UTC):
            lead.end_date = ALGIERS_DATE
            lead.save()  # no leadership role left -> the sync ends the bureau membership

        bureau_row = Membership.objects.get(member=self.member, org_unit=self.bureau)
        self.assertEqual(bureau_row.end_date, ALGIERS_DATE)


class SeedDataConsistencyTests(SimpleTestCase):
    """The seed lists must reference only roles and org units that the seeds define."""

    def test_every_membership_uses_a_defined_role_and_unit(self):
        from apps.members.management.commands.seed_members import MEMBERSHIPS
        from apps.members.management.commands.seed_org_units import UNITS
        from apps.members.management.commands.seed_roles import ROLES

        role_codes = {r["code"] for r in ROLES}
        unit_codes = {u["code"] for u in UNITS}
        missing_roles = sorted({role for _, _, role, _ in MEMBERSHIPS} - role_codes)
        missing_units = sorted({unit for _, unit, _, _ in MEMBERSHIPS} - unit_codes)

        self.assertEqual(missing_roles, [], f"Roles used in seed_members but not defined in seed_roles: {missing_roles}")
        self.assertEqual(missing_units, [], f"Units used in seed_members but not defined in seed_org_units: {missing_units}")


class SeedAllCommandTests(TestCase):
    """seed_all must succeed on an empty database (fresh install)."""

    def test_seed_all_runs_on_empty_database(self):
        call_command("seed_all", stdout=StringIO())

        self.assertTrue(Role.objects.filter(code="club-member").exists())
        self.assertTrue(Role.objects.filter(code="fs-member").exists())
        self.assertGreater(Member.objects.filter(code__isnull=False).count(), 0)
        self.assertTrue(OrgUnit.objects.filter(code="executive-bureau").exists())

    def test_seed_all_creates_no_duplicate_active_memberships(self):
        """seed_members and the bureau sync signal must not both create the same membership."""
        call_command("seed_all", stdout=StringIO())
        count_after_first_run = Membership.objects.count()

        duplicates = list(
            Membership.objects.filter(end_date__isnull=True)
            .values("member_id", "org_unit_id", "role_id")
            .annotate(n=Count("id"))
            .filter(n__gt=1)
        )
        self.assertEqual(duplicates, [], f"Duplicate active memberships: {duplicates}")

        # Re-running the seed is idempotent: nothing new is created.
        call_command("seed_all", stdout=StringIO())
        self.assertEqual(Membership.objects.count(), count_after_first_run)

    def test_seed_all_sends_each_seed_output_to_its_own_output(self):
        """Each seed's messages go where seed_all's output goes (file, log, test buffer), not to the console."""
        out = StringIO()
        with patch("sys.stdout", new_callable=StringIO) as console:
            call_command("seed_all", stdout=out)
        self.assertIn("active org units", out.getvalue())  # written by seed_org_units
        self.assertEqual(console.getvalue(), "")

    def test_seed_members_ends_extra_memberships_on_the_algiers_date(self):
        """A membership that is no longer in the seed list ends on today's date in Algiers."""
        call_command("seed_all", stdout=StringIO())
        member = Member.objects.filter(code__isnull=False).order_by("id").first()
        extra_role = Role.objects.create(
            name="Temporary test role", code="test-temporary",
            role_type=MemberRoleType.MEMBER, scope=RoleScope.CLUB,
        )
        root = OrgUnit.objects.filter(type=OrgUnitType.ROOT).first()
        extra = Membership.objects.create(member=member, org_unit=root, role=extra_role, is_primary=False)

        with patch("django.utils.timezone.now", return_value=LATE_EVENING_UTC):
            call_command("seed_members", stdout=StringIO())

        extra.refresh_from_db()
        self.assertEqual(extra.end_date, ALGIERS_DATE)


class MembershipUniquenessTests(TestCase):
    """The database refuses a second active membership with the same member, unit and role."""

    def test_duplicate_active_membership_is_rejected(self):
        unit = OrgUnit.objects.create(name="Electronics", code="fs-electronics", type=OrgUnitType.FS_DEPARTMENT)
        role = Role.objects.create(name="Member", code="fs-member", role_type=MemberRoleType.MEMBER, scope=RoleScope.FS_TEAM)
        member = Member.objects.create_user(email="dup.test@g.enp.edu.dz", first_name="Dup", last_name="Test", password=None)
        Membership.objects.create(member=member, org_unit=unit, role=role, is_primary=True)

        with self.assertRaises(IntegrityError):
            Membership.objects.create(member=member, org_unit=unit, role=role, is_primary=False)

    def test_same_membership_allowed_again_after_the_first_one_ended(self):
        unit = OrgUnit.objects.create(name="Electronics", code="fs-electronics", type=OrgUnitType.FS_DEPARTMENT)
        role = Role.objects.create(name="Member", code="fs-member", role_type=MemberRoleType.MEMBER, scope=RoleScope.FS_TEAM)
        member = Member.objects.create_user(email="dup.test2@g.enp.edu.dz", first_name="Dup", last_name="Test", password=None)
        old = Membership.objects.create(member=member, org_unit=unit, role=role, is_primary=True)
        old.end_date = timezone.now().date()
        old.is_primary = False
        old.save()

        Membership.objects.create(member=member, org_unit=unit, role=role, is_primary=True)
        self.assertEqual(Membership.objects.filter(member=member).count(), 2)


class MembershipAdminOrgUnitFilterTests(TestCase):
    """The admin org-unit filter must not crash on empty or invalid values (bug #21)."""

    def setUp(self):
        self.admin = Member.objects.create_superuser(
            email="admin.filter@g.enp.edu.dz", first_name="Admin", last_name="Filter", password=None,
        )
        self.client.force_login(self.admin)
        self.unit = OrgUnit.objects.create(name="Electronics", code="fs-electronics", type=OrgUnitType.FS_DEPARTMENT)
        self.url = "/admin/members/membership/"

    def test_empty_filter_value_shows_the_list(self):
        response = self.client.get(self.url, {"org_unit": ""})
        self.assertEqual(response.status_code, 200)

    def test_non_numeric_filter_value_shows_the_list(self):
        response = self.client.get(self.url, {"org_unit": "abc"})
        self.assertEqual(response.status_code, 200)

    def test_valid_filter_value_still_filters(self):
        response = self.client.get(self.url, {"org_unit": str(self.unit.pk)})
        self.assertEqual(response.status_code, 200)


class SecretKeyCheckTests(SimpleTestCase):
    """Django must refuse to run with a short or guessable SECRET_KEY (bug #20)."""

    def test_short_secret_key_is_an_error(self):
        from apps.members.checks import check_secret_key_strength

        with override_settings(SECRET_KEY="changeme"):
            errors = check_secret_key_strength(None)
        self.assertEqual([e.id for e in errors], ["members.E001"])

    def test_long_but_repetitive_secret_key_is_an_error(self):
        from apps.members.checks import check_secret_key_strength

        with override_settings(SECRET_KEY="a" * 60):
            errors = check_secret_key_strength(None)
        self.assertEqual([e.id for e in errors], ["members.E001"])

    def test_generated_secret_key_passes(self):
        from django.core.management.utils import get_random_secret_key

        from apps.members.checks import check_secret_key_strength

        with override_settings(SECRET_KEY=get_random_secret_key()):
            self.assertEqual(check_secret_key_strength(None), [])


class ProductionSettingsTests(SimpleTestCase):
    """On the server (DEBUG off, behind Caddy in HTTPS: PROJECTS/ERP/hosting_design.md), Django's own
    deployment checklist passes; on this PC (DEBUG on), nothing of it applies."""

    FLAGS = [
        "SECURE_PROXY_SSL_HEADER", "SECURE_SSL_REDIRECT", "SECURE_REDIRECT_EXEMPT", "SESSION_COOKIE_SECURE",
        "CSRF_COOKIE_SECURE", "SECURE_HSTS_SECONDS", "AUTH_COOKIE_SECURE",
    ]

    def environment(self, debug):
        import os
        import secrets

        return {
            **os.environ, "PYTHONUTF8": "1", "DEBUG": debug, "SECRET_KEY": secrets.token_urlsafe(64),
            "ALLOWED_HOSTS": "erp.example.org,127.0.0.1", "CSRF_TRUSTED_ORIGINS": "https://erp.example.org",
        }

    def run_backend(self, debug, *arguments):
        import subprocess
        import sys

        return subprocess.run(
            [sys.executable, *arguments], cwd=settings.BASE_DIR, env=self.environment(debug),
            capture_output=True, text=True, encoding="utf-8", timeout=120,
        )

    def flags(self, debug):
        script = (
            "import json, os, django; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
            "django.setup(); from django.conf import settings as s; "
            f"print(json.dumps({{name: getattr(s, name) for name in {self.FLAGS!r}}}))"
        )
        result = self.run_backend(debug, "-c", script)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])

    def test_the_deployment_checklist_passes_on_the_server(self):
        result = self.run_backend("False", "manage.py", "check", "--deploy", "--fail-level", "WARNING")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_https_only_on_the_server(self):
        server = self.flags("False")
        self.assertEqual(server["SECURE_PROXY_SSL_HEADER"], ["HTTP_X_FORWARDED_PROTO", "https"])
        self.assertTrue(server["SECURE_SSL_REDIRECT"])
        self.assertEqual(server["SECURE_REDIRECT_EXEMPT"], [r"^api/health/$"])  # the containers' own check
        self.assertTrue(server["SESSION_COOKIE_SECURE"] and server["CSRF_COOKIE_SECURE"] and server["AUTH_COOKIE_SECURE"])
        self.assertEqual(server["SECURE_HSTS_SECONDS"], 3600)  # an hour first, a year once all works

    def test_nothing_changes_on_this_pc(self):
        here = self.flags("True")
        self.assertIsNone(here["SECURE_PROXY_SSL_HEADER"])
        self.assertFalse(here["SECURE_SSL_REDIRECT"] or here["SESSION_COOKIE_SECURE"] or here["AUTH_COOKIE_SECURE"])
        self.assertEqual(here["SECURE_HSTS_SECONDS"], 0)


class ApiRateLimitTests(SimpleTestCase):
    """The general API limits stay those of production unless the environment says otherwise: only the
    end-to-end test server raises them (frontend/playwright.config.ts), a test browser being much faster
    than a person."""

    def test_the_limits_per_address_and_per_member(self):
        self.assertEqual(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], {"anon": "60/minute", "user": "120/minute"})

    def test_the_environment_may_change_them(self):
        from config.settings import api_throttle_rates

        self.assertEqual(api_throttle_rates({}), {"anon": "60/minute", "user": "120/minute"})
        self.assertEqual(
            api_throttle_rates({"API_THROTTLE_USER": "1000/minute"}), {"anon": "60/minute", "user": "1000/minute"}
        )


@override_settings(CACHES=TEST_CACHES)
class ClientIpSpoofingTests(APITestCase):
    """A client must not escape the per-IP limits by forging X-Forwarded-For (bug #3)."""

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_forged_forwarded_for_does_not_bypass_otp_ip_limit(self):
        url = "/api/auth/otp/request/"
        limit = settings.OTP_IP_MAX_REQUESTS_PER_HOUR
        for i in range(limit):
            response = self.client.post(
                url, {"email": f"nobody{i}@g.enp.edu.dz"}, format="json",
                HTTP_X_FORWARDED_FOR=f"203.0.113.{i}",  # a new fake address every time
            )
            self.assertEqual(response.status_code, 200)

        response = self.client.post(
            url, {"email": "one.more@g.enp.edu.dz"}, format="json",
            HTTP_X_FORWARDED_FOR="198.51.100.99",
        )
        self.assertEqual(response.status_code, 429)

    def test_forwarded_for_is_ignored_without_trusted_proxy(self):
        from rest_framework.test import APIRequestFactory

        from apps.members.views import _client_ip

        request = APIRequestFactory().get("/", HTTP_X_FORWARDED_FOR="203.0.113.5", REMOTE_ADDR="10.0.0.2")
        self.assertEqual(_client_ip(request), "10.0.0.2")

    def test_behind_one_trusted_proxy_the_last_forwarded_address_is_used(self):
        from rest_framework.test import APIRequestFactory

        from apps.members.views import _client_ip

        # The client forged the first entry; our proxy appended the real address last.
        request = APIRequestFactory().get(
            "/", HTTP_X_FORWARDED_FOR="203.0.113.5, 198.51.100.7", REMOTE_ADDR="10.0.0.2",
        )
        with override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1}):
            self.assertEqual(_client_ip(request), "198.51.100.7")


def _make_privacy_fixture():
    """Two departments, a head of the first one, a plain member of each, a club admin."""
    from django.contrib.auth.models import Group, Permission

    ops = OrgUnit.objects.create(name="Operations", code="dept-ops-test", type=OrgUnitType.CLUB_DEPARTMENT)
    media = OrgUnit.objects.create(name="Media", code="dept-media-test", type=OrgUnitType.CLUB_DEPARTMENT)
    head_role = Role.objects.create(name="Lead", code="lead-test", role_type=MemberRoleType.HEAD_OF_DEPARTMENT,
                                    scope=RoleScope.CLUB, is_leadership=True)
    member_role = Role.objects.create(name="Member", code="member-test", role_type=MemberRoleType.MEMBER,
                                      scope=RoleScope.CLUB)

    def person(email, unit, role, phone):
        m = Member.objects.create_user(email=email, first_name=email.split("@")[0], last_name="Test",
                                       password=None, phone=phone, facebook_url="https://facebook.com/" + phone)
        Membership.objects.create(member=m, org_unit=unit, role=role, is_primary=True)
        return m

    head = person("head@g.enp.edu.dz", ops, head_role, "0600000001")
    ops_member = person("ops.member@g.enp.edu.dz", ops, member_role, "0600000002")
    media_member = person("media.member@g.enp.edu.dz", media, member_role, "0600000003")
    admin = Member.objects.create_user(email="club.admin@g.enp.edu.dz", first_name="Club", last_name="Admin",
                                       password=None, phone="0600000004")

    heads_group = Group.objects.create(name="Department Heads")
    heads_group.permissions.set(Permission.objects.filter(
        content_type__app_label="members", codename__in=["view_member", "change_member"]))
    head.groups.add(heads_group)
    head.is_staff = True
    head.save()
    Group.objects.create(name="Admins").user_set.add(admin)
    return {"head": head, "ops_member": ops_member, "media_member": media_member, "admin": admin}


class MemberContactPrivacyTests(APITestCase):
    """Phone and Facebook are only shown to the member, club admins and their department head (bug #5)."""

    def setUp(self):
        self.p = _make_privacy_fixture()

    def _get(self, viewer, member):
        self.client.force_authenticate(viewer)
        return self.client.get(f"/api/members/{member.pk}/").json()

    def test_plain_member_cannot_see_another_members_contact_details(self):
        data = self._get(self.p["media_member"], self.p["ops_member"])
        self.assertIsNone(data["phone"])
        self.assertIsNone(data["facebook_url"])
        self.assertEqual(data["email"], self.p["ops_member"].email)  # the rest of the profile stays visible

    def test_member_sees_own_contact_details(self):
        self.client.force_authenticate(self.p["ops_member"])
        data = self.client.get("/api/auth/me/").json()
        self.assertEqual(data["phone"], "0600000002")

    def test_department_head_sees_contact_details_of_own_department_only(self):
        self.assertEqual(self._get(self.p["head"], self.p["ops_member"])["phone"], "0600000002")
        self.assertIsNone(self._get(self.p["head"], self.p["media_member"])["phone"])

    def test_club_admin_sees_everyones_contact_details(self):
        self.assertEqual(self._get(self.p["admin"], self.p["media_member"])["phone"], "0600000003")

    def test_member_list_hides_other_members_contact_details(self):
        self.client.force_authenticate(self.p["media_member"])
        rows = {r["email"]: r for r in self.client.get("/api/members/").json()["results"]}
        self.assertIsNone(rows[self.p["ops_member"].email]["phone"])
        self.assertEqual(rows[self.p["media_member"].email]["phone"], "0600000003")


class MemberAdminScopeTests(TestCase):
    """In the admin, a department head only manages their department and cannot grant permissions (bug #6)."""

    def setUp(self):
        self.p = _make_privacy_fixture()
        self.client.force_login(self.p["head"])

    def test_department_head_member_list_is_limited_to_their_department(self):
        response = self.client.get("/admin/members/member/")
        self.assertEqual(response.status_code, 200)
        shown = {m.email for m in response.context["cl"].result_list}
        self.assertIn(self.p["ops_member"].email, shown)
        self.assertNotIn(self.p["media_member"].email, shown)

    def test_department_head_cannot_open_a_member_of_another_department(self):
        response = self.client.get(f"/admin/members/member/{self.p['media_member'].pk}/change/")
        self.assertNotEqual(response.status_code, 200)

    def test_department_head_cannot_edit_permission_fields(self):
        from django.contrib.admin.sites import site
        from django.test import RequestFactory

        request = RequestFactory().get("/admin/")
        request.user = self.p["head"]
        readonly = site._registry[Member].get_readonly_fields(request, self.p["head"])
        for field in ("is_superuser", "is_staff", "groups", "user_permissions"):
            self.assertIn(field, readonly)


class ReadmeEndpointsTests(SimpleTestCase):
    """Every API endpoint documented in the root README must exist (bug #7)."""

    def test_documented_endpoints_resolve(self):
        from django.urls import Resolver404, resolve

        readme = Path(settings.BASE_DIR).parent / "README.md"
        documented = re.findall(r"`(?:GET|POST|PUT|PATCH|DELETE) (/api/[^`\s]+)`", readme.read_text(encoding="utf-8"))
        self.assertTrue(documented, "No endpoint found in README.md")

        missing = []
        for path in documented:
            try:
                # Placeholders such as <id> stand for a real primary key.
                resolve(re.sub(r"<[^>]+>", "1", path))
            except Resolver404:
                missing.append(path)
        self.assertEqual(missing, [], f"Endpoints documented in README.md but not served: {missing}")


class MemberDetailUrlTests(APITestCase):
    """A non-numeric member id (e.g. /api/members/me/) must give 404, not a server error."""

    def test_non_numeric_member_id_returns_404(self):
        viewer = Member.objects.create_user(email="viewer@g.enp.edu.dz", first_name="V", last_name="T", password=None)
        self.client.force_authenticate(viewer)
        self.client.raise_request_exception = False
        response = self.client.get("/api/members/me/")
        self.assertEqual(response.status_code, 404)


class LocalisationDefaultsTests(APITestCase):
    """The club works in Algiers and in French by default (bug #11)."""

    def test_project_time_zone_is_algiers(self):
        self.assertEqual(timezone.get_default_timezone_name(), "Africa/Algiers")

    def test_no_code_takes_today_from_utc_or_the_pc_clock(self):
        """'Today' must come from timezone.localdate() (Algiers), never from UTC or the server clock."""
        forbidden = re.compile(r"date\.today\(\)|now\(\)\.date\(\)|datetime\.now\(\)")
        offenders = []
        for path in (Path(settings.BASE_DIR) / "apps").rglob("*.py"):
            if "migrations" in path.parts or "tests" in path.parts or path.name.startswith("test"):
                continue
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if forbidden.search(line):
                    offenders.append(f"{path.relative_to(settings.BASE_DIR)}:{number}")
        self.assertEqual(offenders, [], f"Use timezone.localdate() / timezone.now() instead: {offenders}")

    def test_api_messages_are_in_french_by_default(self):
        with translation.override("fr"):
            expected = str(NotAuthenticated.default_detail)
        self.assertNotEqual(expected, "Authentication credentials were not provided.")

        response = self.client.get("/api/members/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data["detail"], expected)


class ApiDocsTests(APITestCase):
    """Swagger documentation of the API (/api/docs/): staff only, complete, no schema warnings."""

    def setUp(self):
        self.staff = Member.objects.create_user(
            email="staff@g.enp.edu.dz", first_name="Staff", last_name="User", password=None, is_staff=True,
        )
        self.member = Member.objects.create_user(
            email="member@g.enp.edu.dz", first_name="Plain", last_name="Member", password=None,
        )

    def test_docs_page_is_served_to_staff_logged_into_the_admin(self):
        self.client.force_login(self.staff)  # Django admin session
        response = self.client.get("/api/docs/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "swagger-ui")

    def test_docs_and_schema_are_hidden_from_anonymous_users_and_plain_members(self):
        for path in ("/api/docs/", "/api/schema/"):
            self.assertIn(self.client.get(path).status_code, (401, 403), path)
        self.client.force_authenticate(self.member)
        for path in ("/api/docs/", "/api/schema/"):
            self.assertEqual(self.client.get(path).status_code, 403, path)

    def test_schema_documents_every_api_route(self):
        self.client.force_login(self.staff)
        response = self.client.get("/api/schema/", {"format": "json"})
        self.assertEqual(response.status_code, 200)
        paths = set(json.loads(response.content)["paths"])
        expected = {
            "/api/health/",
            "/api/auth/otp/request/", "/api/auth/otp/verify/", "/api/auth/refresh/",
            "/api/auth/logout/", "/api/auth/me/",
            "/api/org-units/", "/api/members/", "/api/members/{id}/", "/api/executive-bureau/",
        }
        self.assertEqual(expected - paths, set(), "Routes missing from the API documentation")

    def test_schema_is_valid_and_generates_without_warnings(self):
        """Every view must describe its input and output, so the docs (and generated frontend types) are exact."""
        out, err = StringIO(), StringIO()
        try:
            # drf-spectacular prints its warnings on sys.stderr: keep them for the failure message.
            with redirect_stderr(err):
                call_command("spectacular", "--validate", "--fail-on-warn", stdout=out, stderr=err)
        except Exception as exc:
            self.fail(f"{exc!r}\n{err.getvalue()}")

    def test_hidden_contact_details_are_documented_as_nullable(self):
        """The API sends null for a phone or Facebook the viewer may not see (MemberContactPrivacyTests):
        the schema, and so the frontend types, must say so."""
        self.client.force_login(self.staff)
        schemas = json.loads(self.client.get("/api/schema/", {"format": "json"}).content)["components"]["schemas"]
        for schema in ("MemberDetail", "Me"):
            for field in ("phone", "facebook_url"):
                self.assertIs(schemas[schema]["properties"][field].get("nullable"), True, f"{schema}.{field}")


class QuietTestLogsTests(SimpleTestCase):
    """Test runs hide routine logs (INFO, expected WARNING such as rate limits) but still show errors."""

    def test_routine_logs_are_hidden_but_errors_are_shown(self):
        logger = logging.getLogger("members.auth")
        self.assertFalse(logger.isEnabledFor(logging.WARNING))
        self.assertTrue(logger.isEnabledFor(logging.ERROR))


class ApiLanguageTests(APITestCase):
    """The API answers in the browser's language (Accept-Language): French, English or Arabic; else French."""

    @staticmethod
    def not_logged_in_message(language):
        with translation.override(language):
            return str(NotAuthenticated.default_detail)

    def test_api_answers_in_french_english_or_arabic(self):
        messages = {lang: self.not_logged_in_message(lang) for lang in ("fr", "en", "ar")}
        self.assertEqual(len(set(messages.values())), 3, "the three translations must exist")
        for header, language in [("ar", "ar"), ("en-US,en;q=0.9", "en"), ("fr-FR,fr;q=0.9", "fr")]:
            response = self.client.get("/api/members/", HTTP_ACCEPT_LANGUAGE=header)
            self.assertEqual(response.data["detail"], messages[language], header)
            self.assertEqual(response["Content-Language"], language, header)

    def test_other_languages_fall_back_to_french(self):
        response = self.client.get("/api/members/", HTTP_ACCEPT_LANGUAGE="de-DE,de;q=0.9")
        self.assertEqual(response.data["detail"], self.not_logged_in_message("fr"))
        self.assertEqual(response["Content-Language"], "fr")


class MemberLanguagePreferenceTests(APITestCase):
    """Each member may choose French, English or Arabic; empty = follow the browser."""

    def setUp(self):
        self.member = Member.objects.create_user(
            email="lang@g.enp.edu.dz", first_name="Lang", last_name="Pref", password=None,
        )

    def log_in(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(self.member).access_token
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def refused_message(self, accept_language):
        """A plain member may not create members: the 403 message, in the language the API picked."""
        return self.client.post("/api/members/", {}, HTTP_ACCEPT_LANGUAGE=accept_language)

    @staticmethod
    def permission_message(language):
        from rest_framework.exceptions import PermissionDenied
        with translation.override(language):
            return str(PermissionDenied.default_detail)

    def test_no_choice_follows_the_browser(self):
        self.log_in()
        response = self.refused_message("en")
        self.assertEqual(response.data["detail"], self.permission_message("en"))

    def test_member_choice_wins_over_the_browser(self):
        self.member.language = "ar"
        self.member.save()
        self.log_in()
        response = self.refused_message("en")
        self.assertEqual(response.data["detail"], self.permission_message("ar"))
        self.assertEqual(response["Content-Language"], "ar")

    def test_member_changes_their_language(self):
        self.log_in()
        self.assertEqual(self.client.get("/api/auth/me/").data["language"], "")
        response = self.client.patch("/api/auth/me/", {"language": "en"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["language"], "en")
        self.member.refresh_from_db()
        self.assertEqual(self.member.language, "en")

    def test_only_the_language_can_be_changed_there(self):
        self.log_in()
        response = self.client.patch("/api/auth/me/", {"language": "de"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.client.patch("/api/auth/me/", {"language": "fr", "email": "x@g.enp.edu.dz", "is_staff": True},
                          format="json")
        self.member.refresh_from_db()
        self.assertEqual((self.member.email, self.member.is_staff), ("lang@g.enp.edu.dz", False))

    def test_admin_follows_the_member_choice(self):
        self.member.language = "en"
        self.member.is_staff = True
        self.member.save()
        self.client.force_login(self.member)  # admin session
        response = self.client.get("/admin/", HTTP_ACCEPT_LANGUAGE="fr")
        self.assertEqual(response["Content-Language"], "en")


LOCALE_DIR = Path(settings.BASE_DIR) / "locale"


def read_po(path):
    """Minimal .po reader (enough for our catalogs): [{context, msgid, plural, msgstr: {index: text}, flags}]."""
    import ast

    entries, current, field, flags, context = [], None, None, set(), None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#,"):
            flags = {flag.strip() for flag in line[2:].split(",")}
        elif line.startswith("msgctxt "):
            context = ast.literal_eval(line[8:])
        elif line.startswith("msgid "):
            current = {"context": context, "msgid": "", "plural": None, "msgstr": {}, "flags": flags}
            entries.append(current)
            flags, field, context = set(), ("msgid", None), None
            current["msgid"] = ast.literal_eval(line[6:])
        elif line.startswith("msgid_plural "):
            field = ("plural", None)
            current["plural"] = ast.literal_eval(line[13:])
        elif line.startswith("msgstr"):
            index = int(line[7:line.index("]")]) if line.startswith("msgstr[") else 0
            field = ("msgstr", index)
            current["msgstr"][index] = ast.literal_eval(line[line.index(" ") + 1:])
        elif line.startswith('"') and current is not None:
            name, index = field
            if name == "msgstr":
                current["msgstr"][index] += ast.literal_eval(line)
            else:
                current[name] += ast.literal_eval(line)
    return entries


# Arabic translations that Django and DRF are missing: hand-written, never touched by makemessages.
LOCALE_OVERRIDES_DIR = Path(settings.BASE_DIR) / "locale_overrides"


class TranslationCatalogTests(SimpleTestCase):
    """Our catalogs (backend/locale and backend/locale_overrides): all translated, none fuzzy, compiled."""

    def test_every_message_is_translated_and_compiled(self):
        from django.utils.translation.trans_real import DjangoTranslation

        catalogs = [LOCALE_DIR / language / "LC_MESSAGES" / "django.po" for language in ("fr", "ar")]
        catalogs += sorted(LOCALE_OVERRIDES_DIR.glob("*/LC_MESSAGES/*.po"))
        for po in catalogs:
            self.assertTrue(po.exists(), f"{po} is missing: run scripts/translations.ps1")
            language, domain = po.parts[-3], po.stem
            compiled = DjangoTranslation(language, domain=domain)
            entries = read_po(po)
            self.assertGreater(len(entries), 1, po)
            for entry in entries:
                self.assertNotIn("fuzzy", entry["flags"], f"[{po}] to review: {entry['msgid'] or 'header'}")
                if not entry["msgid"]:
                    continue  # header
                self.assertTrue(all(entry["msgstr"].values()), f"[{po}] not translated: {entry['msgid']}")
                if entry["plural"] is None:
                    if entry["context"]:
                        result = compiled.pgettext(entry["context"], entry["msgid"])
                    else:
                        result = compiled.gettext(entry["msgid"])
                    self.assertEqual(
                        result, entry["msgstr"][0],
                        f"[{po}] .mo out of date: run scripts/translations.ps1 -CompileOnly",
                    )


class ArabicFallbackTests(SimpleTestCase):
    """An Arabic page never shows French. When Django has no Arabic for a message it falls back to
    LANGUAGE_CODE (French), so every message that Django, DRF and simplejwt translate into French
    must also exist in Arabic (theirs, or ours in locale_overrides/ar)."""

    def test_no_message_falls_back_to_french(self):
        import django
        import rest_framework
        import rest_framework_simplejwt
        from django.utils.translation.trans_real import DjangoTranslation

        compiled = {}
        falls_back = []
        for package in (django, rest_framework, rest_framework_simplejwt):
            for po in sorted(Path(package.__file__).parent.glob("**/locale/fr/LC_MESSAGES/*.po")):
                domain = po.stem  # "django" or "djangojs" (admin widgets)
                for language in ("ar", "fr"):
                    compiled.setdefault((language, domain), DjangoTranslation(language, domain=domain))
                arabic, french = compiled["ar", domain], compiled["fr", domain]
                for entry in read_po(po):
                    msgid, plural = entry["msgid"], entry["plural"]
                    if not msgid or not all(entry["msgstr"].values()):
                        continue
                    if plural:
                        pairs = [(arabic.ngettext(msgid, plural, n), french.ngettext(msgid, plural, n)) for n in (1, 5)]
                    elif entry["context"]:
                        pairs = [(arabic.pgettext(entry["context"], msgid), french.pgettext(entry["context"], msgid))]
                    else:
                        pairs = [(arabic.gettext(msgid), french.gettext(msgid))]
                    # Same text in Arabic and French, and not the English original: French was used.
                    if any(ar == fr and fr not in (msgid, plural) for ar, fr in pairs):
                        falls_back.append(f"[{domain}] {msgid}")
        self.assertEqual(sorted(set(falls_back)), [], "translate these in locale_overrides/ar")


class RoleDisplayTests(SimpleTestCase):
    """A role shows its scope with the translated label, not the raw code (fs_team)."""

    def test_role_shows_its_translated_scope(self):
        role = Role(name="Electronics Engineer", scope=RoleScope.FS_TEAM, role_type=MemberRoleType.MEMBER)
        for language in ("fr", "ar", "en"):
            with translation.override(language):
                self.assertEqual(str(role), f"Electronics Engineer ({RoleScope.FS_TEAM.label})")
                self.assertNotIn("fs_team", str(role))


@override_settings(CACHES=TEST_CACHES, OTP_TTL_SECONDS=5 * 60)
class LoginMessagesLanguageTests(APITestCase):
    """Login messages and the e-mail with the code are in French, English or Arabic."""

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_login_messages_follow_the_language(self):
        from django.utils.translation import gettext

        english = "If this email is registered, a code has been sent."
        for language in ("fr", "ar", "en"):
            # One address per language: the resend cooldown applies to unknown addresses too (review 24/11/2026).
            response = self.client.post(
                "/api/auth/otp/request/", {"email": f"nobody.{language}@g.enp.edu.dz"}, HTTP_ACCEPT_LANGUAGE=language,
            )
            with translation.override(language):
                expected = gettext(english)
            self.assertEqual(response.data["detail"], expected, language)
            if language != "en":
                self.assertNotEqual(expected, english, f"no {language} translation")

    def test_code_email_is_in_the_member_language(self):
        member = Member.objects.create_user(
            email="arabic@g.enp.edu.dz", first_name="A", last_name="R", password=None, language="ar",
        )
        self.client.post("/api/auth/otp/request/", {"email": member.email}, HTTP_ACCEPT_LANGUAGE="fr")
        email = mail.outbox[0]
        self.assertNotEqual(email.subject, "Your ENP Racing Team login code")
        self.assertIn("5 دقائق", email.body)  # Arabic plural for 3 to 10 minutes

    def test_code_email_follows_the_browser_without_a_choice(self):
        member = Member.objects.create_user(
            email="nochoice@g.enp.edu.dz", first_name="N", last_name="C", password=None,
        )
        self.client.post("/api/auth/otp/request/", {"email": member.email}, HTTP_ACCEPT_LANGUAGE="en")
        self.assertEqual(mail.outbox[0].subject, "Your ENP Racing Team login code")
        self.assertIn("It expires in 5 minutes", mail.outbox[0].body)


# Apps whose labels (models, fields, choices, admin) are translated. Add each app once it is done.
TRANSLATED_APPS = [
    "members", "tasks", "projects", "subsystems", "purchasing", "inventory", "finance", "equipment", "documents",
    "communication", "reporting", "telemetry", "meetings", "ranking", "discipline", "engagement",
    "assistant",
]
# Choices shown on purpose in their own language: language names in a language picker.
UNTRANSLATED_CHOICES = {("members", "Member", "language")}


class TranslatableLabelsTests(TestCase):
    """In translated apps, every label shown to users is marked for translation and the admin
    renders in Arabic and French."""

    def test_labels_are_marked_for_translation(self):
        from django.apps import apps
        from django.utils.functional import Promise

        unmarked = []
        for app_label in TRANSLATED_APPS:
            if not isinstance(apps.get_app_config(app_label).verbose_name, Promise):
                unmarked.append(f"{app_label} app name (AppConfig.verbose_name)")
            for model in apps.get_app_config(app_label).get_models():
                for option in ("verbose_name", "verbose_name_plural"):
                    value = model._meta.original_attrs.get(option)
                    if not isinstance(value, Promise):
                        unmarked.append(f"{model.__name__}.Meta.{option}")
                for field in model._meta.get_fields():
                    if field.auto_created or not hasattr(field, "verbose_name"):
                        continue
                    if not isinstance(field.verbose_name, Promise):
                        unmarked.append(f"{model.__name__}.{field.name}")
                    if field.choices and (app_label, model.__name__, field.name) not in UNTRANSLATED_CHOICES:
                        unmarked += [
                            f"{model.__name__}.{field.name} = {label}"
                            for _value, label in field.flatchoices if not isinstance(label, Promise)
                        ]
        self.assertEqual(unmarked, [], "wrap these labels in gettext_lazy (_)")

    def test_admin_pages_render_in_arabic_and_french(self):
        from django.apps import apps
        from django.contrib import admin
        from django.utils.html import escape
        from django.utils.text import capfirst
        from django.utils.translation import gettext

        superuser = Member.objects.create_superuser(
            email="i18n.admin@g.enp.edu.dz", first_name="I18n", last_name="Admin", password=None,
        )
        self.client.force_login(superuser)
        for app_label in TRANSLATED_APPS:
            for model in apps.get_app_config(app_label).get_models():
                if model not in admin.site._registry:
                    continue
                url = f"/admin/{app_label}/{model._meta.model_name}/"
                for language in ("ar", "fr"):
                    with self.subTest(url=url, language=language):
                        response = self.client.get(url, HTTP_ACCEPT_LANGUAGE=language)
                        self.assertEqual(response.status_code, 200)
                        with translation.override(language):
                            # escape(): the page writes ' as &#x27; ("profils d'anciens membres")
                            self.assertContains(response, escape(capfirst(str(model._meta.verbose_name_plural))))

        # Admin section titles are translated too.
        response = self.client.get(f"/admin/members/member/{superuser.pk}/change/", HTTP_ACCEPT_LANGUAGE="ar")
        with translation.override("ar"):
            preferences = gettext("Preferences")
        self.assertNotEqual(preferences, "Preferences")
        self.assertContains(response, preferences)


class GrammaticalGenderTests(SimpleTestCase):
    """The same English word can need two translations: "Planned" is feminine for a task (une tâche
    prévue) and masculine for a subsystem (un sous-système planifié). The task status uses a translation
    context for that. (Until 20/10/2026 it was "Blocked": a task is now blocked by a blocker, D-012.)"""

    def test_planned_agrees_with_task_and_subsystem(self):
        from apps.subsystems.models import SubsystemStatus
        from apps.tasks.models import TaskStatus

        for language in ("fr", "ar"):
            with translation.override(language):
                task, subsystem = str(TaskStatus.PLANNED.label), str(SubsystemStatus.PLANNED.label)
                self.assertNotEqual(task, subsystem, language)
                self.assertNotEqual(task, "Planned", language)


class ArabicModelNameTests(SimpleTestCase):
    """Django puts model names inside its own Arabic sentences ("أضف %s", "اختر %s لتغييره"),
    so a model's Arabic name must be indefinite: مشروع, not المشروع ("add the project")."""

    def test_arabic_model_names_have_no_definite_article(self):
        from django.apps import apps

        with translation.override("ar"):
            definite = [
                f"{model.__name__}: {model._meta.verbose_name}"
                for app_label in TRANSLATED_APPS
                for model in apps.get_app_config(app_label).get_models()
                if str(model._meta.verbose_name).startswith("ال")
            ]
        self.assertEqual(definite, [])


class ArabicNeutralWordingTests(SimpleTestCase):
    """Django's Arabic admin refers to any object with a masculine pronoun ("اختر %s لتغييره",
    "احذفه؟"), which is wrong for feminine names (قطعة، مهمة، حركة). locale_overrides/ar uses
    neutral wording instead."""

    MESSAGES = [
        "Select %s to change",
        "You may edit it again below.",
        "The {name} “{obj}” was changed successfully. You may edit it again below.",
        "Delete?",
        "%(name)s with ID “%(key)s” doesn’t exist. Perhaps it was deleted?",
    ]

    def test_no_masculine_pronoun_for_objects(self):
        from django.utils.translation import gettext

        with translation.override("ar"):
            for msgid in self.MESSAGES:
                text = gettext(msgid)
                self.assertNotEqual(text, msgid, "no Arabic at all")
                for masculine in ("لتغييره", "تعديله", "احذفه", "له المعرّف"):
                    self.assertNotIn(masculine, text, msgid)

    def test_django_typo_is_fixed(self):
        from django.utils.translation import gettext

        with translation.override("ar"):
            text = gettext("You don’t have permission to view or edit anything.")
        self.assertNotIn("تغديل", text)
        self.assertIn("تعديل", text)


class SimpleJWTTranslationTests(SimpleTestCase):
    """simplejwt (login tokens) ships translations, loaded only if rest_framework_simplejwt itself is an
    installed app: its admin section and models must not stay in English."""

    def test_token_admin_names_are_translated(self):
        from django.apps import apps
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

        english = {"Token Blacklist", "Blacklisted Tokens", "Outstanding Tokens", "Blacklisted Token",
                   "Outstanding Token"}
        for language in ("fr", "ar"):
            with translation.override(language):
                names = {str(apps.get_app_config("token_blacklist").verbose_name)}
                for model in (BlacklistedToken, OutstandingToken):
                    names |= {str(model._meta.verbose_name), str(model._meta.verbose_name_plural)}
            self.assertEqual(names & english, set(), language)


class CorsPreflightTests(SimpleTestCase):
    """The frontend runs on another origin (localhost:3000) and sends X-CSRF-Token on POST, PUT, PATCH and
    DELETE. The browser first asks the API (CORS preflight) and blocks the request unless the API allows
    that header: without it, logout and every change made from the frontend would fail."""

    def test_preflight_allows_the_csrf_header(self):
        origin = settings.CORS_ALLOWED_ORIGINS[0]
        response = self.client.options(
            "/api/auth/logout/",
            HTTP_ORIGIN=origin,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type,x-csrf-token",
        )
        self.assertEqual(response["Access-Control-Allow-Origin"], origin)
        self.assertEqual(response["Access-Control-Allow-Credentials"], "true")
        allowed = {header.strip() for header in response["Access-Control-Allow-Headers"].split(",")}
        self.assertIn("content-type", allowed)
        self.assertIn("x-csrf-token", allowed)


class E2EResetSafetyTests(SimpleTestCase):
    """e2e_reset drops a whole database and empties the cache: it must refuse anything but the
    end-to-end test ones. Only the check is called here: no database is touched."""

    def problems(self, debug=True, name="enp_racing_team_erp_e2e", location="redis://localhost:6379/1"):
        from apps.members.management.commands.e2e_reset import e2e_settings_problems

        cache = {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": location}
        return e2e_settings_problems(debug, {"default": {"NAME": name}}, {"default": cache})

    def test_accepts_the_e2e_database_and_cache(self):
        self.assertEqual(self.problems(), [])

    def test_refuses_the_development_database(self):
        for name in ("enp_racing_team_erp", "enp_e2e_racing", "test_enp_racing_team_erp"):
            self.assertTrue(self.problems(name=name), name)

    def test_refuses_the_development_cache(self):
        for location in ("redis://localhost:6379/0", "redis://localhost:6379", "redis://localhost:6379/"):
            self.assertTrue(self.problems(location=location), location)

    def test_refuses_without_debug(self):
        self.assertTrue(self.problems(debug=False))

    def test_command_stops_before_touching_anything(self):
        from django.core.management.base import CommandError

        # The test settings (DEBUG off, database test_…) are not E2E ones: refused at once.
        with self.assertRaisesMessage(CommandError, "_e2e"):
            call_command("e2e_reset", stdout=StringIO())


class GrantAdminTests(TestCase):
    """manage.py grant_admin <email>, on the server (DEBUG off too): a member gets the admin rights
    and a password typed twice, never written on the command line (unlike dev_login)."""

    def setUp(self):
        self.member = Member.objects.create_user(
            email="ops.head@example.invalid", password=None, code="ops-head", first_name="Ops", last_name="Head",
        )

    def grant(self, *typed, email="OPS.HEAD@example.invalid"):
        out = StringIO()
        with patch("apps.members.management.commands.grant_admin.getpass", side_effect=list(typed)):
            call_command("grant_admin", email, stdout=out)
        return out.getvalue()

    @override_settings(DEBUG=False)
    def test_admin_rights_and_a_password_typed_twice(self):
        output = self.grant("Rotule-M10-Cockpit", "Rotule-M10-Cockpit")
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_staff and self.member.is_superuser)
        self.assertTrue(self.member.check_password("Rotule-M10-Cockpit"))
        self.assertIn("ops.head@example.invalid", output)

    def test_the_two_passwords_must_match_and_be_strong(self):
        with self.assertRaisesMessage(CommandError, "not the same"):
            self.grant("Rotule-M10-Cockpit", "Rotule-M10-Cockpi")
        with self.assertRaises(CommandError):
            self.grant("12345678", "12345678")  # too common, only digits
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_staff or self.member.has_usable_password())

    def test_an_unknown_address_is_refused(self):
        with self.assertRaisesMessage(CommandError, "seed_all"):
            self.grant("x", "x", email="nobody@example.invalid")
