from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Notification
from .serializers import CountSerializer, NotificationSerializer


@extend_schema_view(
    list=extend_schema(
        summary="My notifications, newest first",
        parameters=[OpenApiParameter("unread", bool, description="Only the unread ones.")],
    ),
)
class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Each member sees and marks only their own notifications (someone else's: 404)."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        notifications = Notification.objects.filter(member=self.request.user).select_related("actor")
        if self.action == "list" and self.request.query_params.get("unread") in ("1", "true"):
            notifications = notifications.filter(is_read=False)
        return notifications

    def unread(self):
        return Notification.objects.filter(member=self.request.user, is_read=False)

    @extend_schema(summary="How many of my notifications are unread (the bell's number)", responses=CountSerializer)
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"count": self.unread().count()})

    @extend_schema(
        summary="Mark one of my notifications as read",
        parameters=[OpenApiParameter("id", int, OpenApiParameter.PATH)],
        request=None,
        responses=NotificationSerializer,
    )
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(self.get_serializer(notification).data)

    @extend_schema(summary="Mark all my notifications as read", request=None, responses=CountSerializer)
    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        return Response({"count": self.unread().update(is_read=True)})
