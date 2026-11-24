"""What the API documentation (drf-spectacular, /api/docs/) cannot guess on its own."""

from django.conf import settings
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from drf_spectacular.utils import OpenApiResponse, inline_serializer
from rest_framework import serializers


class CookieJWTScheme(OpenApiAuthenticationExtension):
    """CookieJWTAuthentication accepts the access-token cookie (web) or a Bearer header."""

    target_class = "apps.members.authentication.CookieJWTAuthentication"
    name = ["cookieAuth", "bearerAuth"]

    def get_security_definition(self, auto_schema):
        return [
            {"type": "apiKey", "in": "cookie", "name": settings.AUTH_COOKIE_ACCESS},
            {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"},
        ]


# The login endpoints answer {"detail": "<message>"}.
DetailSerializer = inline_serializer(name="Detail", fields={"detail": serializers.CharField()})


def detail(description):
    """A {"detail": ...} response with its meaning."""
    return OpenApiResponse(response=DetailSerializer, description=description)
