from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
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
        self.member.is_staff = True
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
