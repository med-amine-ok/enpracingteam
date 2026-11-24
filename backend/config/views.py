from django.db import connection
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

HealthSerializer = inline_serializer(
    name="Health", fields={"status": serializers.CharField(), "database": serializers.CharField()},
)


@extend_schema(
    summary="Is the API up and the database reachable?",
    responses={200: HealthSerializer, 503: HealthSerializer},
)
@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return Response({"status": "ok", "database": "ok"})
    except Exception:
        return Response({"status": "error", "database": "unreachable"}, status=503)