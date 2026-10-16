# apps/members/authentication.py

import hmac

from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


class CookieJWTAuthentication(JWTAuthentication):
    """
    Reads the access token from an Authorization header if present (mobile /
    explicit bearer clients — no CSRF risk, browsers don't auto-attach custom
    headers cross-site). Otherwise falls back to the httpOnly access-token
    cookie (web). When the cookie path is used, unsafe methods must also
    carry a matching X-CSRF-Token header (double-submit), since the cookie
    itself is sent automatically by the browser and cannot alone prove the
    request came from our own frontend.
    """

    def authenticate(self, request):
        header = self.get_header(request)
        if header is not None:
            raw_token = self.get_raw_token(header)
            if raw_token is None:
                return None
            validated = self.get_validated_token(raw_token)
            return self.get_user(validated), validated

        raw_token = request.COOKIES.get(settings.AUTH_COOKIE_ACCESS)
        if raw_token is None:
            return None

        validated = self.get_validated_token(raw_token)

        if request.method not in SAFE_METHODS:
            sent = request.headers.get("X-CSRF-Token")
            cookie_csrf = request.COOKIES.get(settings.AUTH_COOKIE_CSRF)
            if not sent or not cookie_csrf or not hmac.compare_digest(sent, cookie_csrf):
                raise PermissionDenied("CSRF check failed.")

        return self.get_user(validated), validated
        