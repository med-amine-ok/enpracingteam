from rest_framework.routers import SimpleRouter

from .views import StockItemViewSet, StockMovementViewSet

router = SimpleRouter()
router.register("inventory/items", StockItemViewSet, basename="stock-item")
router.register("inventory/movements", StockMovementViewSet, basename="stock-movement")

urlpatterns = router.urls
