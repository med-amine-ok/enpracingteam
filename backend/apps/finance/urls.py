from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import BudgetViewSet, ExpenseViewSet, FinanceSummaryView, SponsorshipViewSet

router = SimpleRouter()
router.register("finance/budgets", BudgetViewSet, basename="budget")
router.register("finance/expenses", ExpenseViewSet, basename="expense")
router.register("finance/sponsorships", SponsorshipViewSet, basename="sponsorship")

urlpatterns = [path("finance/summary/", FinanceSummaryView.as_view(), name="finance-summary"), *router.urls]
