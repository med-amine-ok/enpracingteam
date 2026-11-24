from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import LifecycleStepListView, SubsystemViewSet

router = SimpleRouter()
router.register("subsystems", SubsystemViewSet, basename="subsystem")

urlpatterns = [
    path("lifecycle-steps/", LifecycleStepListView.as_view(), name="lifecycle-steps"),
    *router.urls,
]
