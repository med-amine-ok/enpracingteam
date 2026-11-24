from rest_framework.routers import SimpleRouter

from .views import AssistantViewSet, ConversationViewSet, SourceViewSet

router = SimpleRouter()
router.register("assistant", AssistantViewSet, basename="assistant")
router.register("assistant/sources", SourceViewSet, basename="assistant-source")
router.register("assistant/conversations", ConversationViewSet, basename="assistant-conversation")

urlpatterns = router.urls
