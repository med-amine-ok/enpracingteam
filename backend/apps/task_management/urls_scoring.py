"""/api/scoring/ — the confidential scoring (404 for whoever may not see it)."""

from rest_framework.routers import SimpleRouter

from . import scoring_views as views

router = SimpleRouter()
router.register("quality-inputs", views.QualityInputViewSet, basename="scoring-quality")
router.register("formula-versions", views.FormulaVersionViewSet, basename="scoring-formula")
router.register("runs", views.RunViewSet, basename="scoring-run")
router.register("scores", views.ScoreViewSet, basename="scoring-score")
router.register("dashboard", views.ScoringDashboardView, basename="scoring-dashboard")
router.register("audit", views.AuditViewSet, basename="scoring-audit")

urlpatterns = router.urls
