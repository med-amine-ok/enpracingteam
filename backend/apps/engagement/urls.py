from rest_framework.routers import SimpleRouter

from .views import EngagementViewSet, GoalViewSet, TrainingViewSet, VolunteeringViewSet

router = SimpleRouter()
router.register("engagement", EngagementViewSet, basename="engagement")
router.register("objectives", GoalViewSet, basename="objective")
router.register("trainings", TrainingViewSet, basename="training")
router.register("volunteering", VolunteeringViewSet, basename="volunteering")

urlpatterns = router.urls
