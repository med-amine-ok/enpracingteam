from rest_framework.routers import SimpleRouter

from .views import ContributionViewSet, RankingViewSet

router = SimpleRouter()
router.register("ranking", RankingViewSet, basename="ranking")
router.register("contributions", ContributionViewSet, basename="contribution")

urlpatterns = router.urls
