from rest_framework.routers import SimpleRouter

from .views import DocumentViewSet, LessonViewSet

router = SimpleRouter()
router.register("documents", DocumentViewSet, basename="document")
router.register("lessons", LessonViewSet, basename="lesson")

urlpatterns = router.urls
