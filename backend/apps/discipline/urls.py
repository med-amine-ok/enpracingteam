from rest_framework.routers import SimpleRouter

from .views import DisciplineViewSet, ExclusionViewSet, ReportViewSet, WarningViewSet

router = SimpleRouter()
router.register("discipline", DisciplineViewSet, basename="discipline")
router.register("discipline/reports", ReportViewSet, basename="discipline-report")
router.register("discipline/warnings", WarningViewSet, basename="discipline-warning")
router.register("discipline/exclusions", ExclusionViewSet, basename="discipline-exclusion")

urlpatterns = router.urls
