# apps/members/cookies.py

import secrets

from django.conf import settings


def set_auth_cookies(response, access: str, refresh: str | None = None):
    response.set_cookie(
        settings.AUTH_COOKIE_ACCESS, access,
        max_age=int(settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds()),
        httponly=True, secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE, path="/",
    )
    if refresh is not None:
        response.set_cookie(
            settings.AUTH_COOKIE_REFRESH, refresh,
            max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
            httponly=True, secure=settings.AUTH_COOKIE_SECURE,
            samesite=settings.AUTH_COOKIE_SAMESITE, path=settings.AUTH_REFRESH_COOKIE_PATH,
        )
    csrf_value = secrets.token_urlsafe(32)
    response.set_cookie(
        settings.AUTH_COOKIE_CSRF, csrf_value,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=False, secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE, path="/",
    )


def clear_auth_cookies(response):
    response.delete_cookie(settings.AUTH_COOKIE_ACCESS, path="/")
    response.delete_cookie(settings.AUTH_COOKIE_REFRESH, path=settings.AUTH_REFRESH_COOKIE_PATH)
    response.delete_cookie(settings.AUTH_COOKIE_CSRF, path="/")