from rest_framework.routers import SimpleRouter

from .views import EquipmentViewSet, LoanViewSet, ReservationViewSet

router = SimpleRouter()
router.register("equipment", EquipmentViewSet, basename="equipment")
router.register("equipment-reservations", ReservationViewSet, basename="equipment-reservation")
router.register("equipment-loans", LoanViewSet, basename="equipment-loan")

urlpatterns = router.urls
