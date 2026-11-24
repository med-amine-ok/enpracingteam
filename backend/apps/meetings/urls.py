from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import ExcuseViewSet, MeetingRightsView, MeetingViewSet, PresenceView

router = SimpleRouter()
# Before "meetings": "meetings/excuses/" is not a session.
router.register("meetings/excuses", ExcuseViewSet, basename="meeting-excuse")
router.register("meetings", MeetingViewSet, basename="meeting")

urlpatterns = [
    path("meetings/presence/", PresenceView.as_view(), name="meeting-presence"),
    path("meetings/rights/", MeetingRightsView.as_view(), name="meeting-rights"),
    *router.urls,
]
