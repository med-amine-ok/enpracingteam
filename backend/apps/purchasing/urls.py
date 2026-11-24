from rest_framework.routers import SimpleRouter

from .views import OrderBatchViewSet, PartViewSet, PurchaseRequestViewSet, ShippingAddressViewSet, SupplierViewSet

router = SimpleRouter()
router.register("purchasing/requests", PurchaseRequestViewSet, basename="purchase-request")
router.register("purchasing/order-batches", OrderBatchViewSet, basename="order-batch")
router.register("purchasing/suppliers", SupplierViewSet, basename="supplier")
router.register("purchasing/parts", PartViewSet, basename="part")
router.register("purchasing/shipping-addresses", ShippingAddressViewSet, basename="shipping-address")

urlpatterns = router.urls
