"""/api/work/ — the operational work module."""

from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("seasons", views.SeasonViewSet, basename="work-season")
router.register("projects", views.ProjectProgressViewSet, basename="work-project")
router.register("work-orders", views.WorkOrderViewSet, basename="work-order")
router.register("deliverables", views.DeliverableViewSet, basename="work-deliverable")
router.register("milestones", views.MilestoneViewSet, basename="work-milestone")
router.register("assignments", views.AssignmentViewSet, basename="work-assignment")
router.register("submissions", views.SubmissionViewSet, basename="work-submission")
router.register("dependencies", views.DependencyViewSet, basename="work-dependency")
router.register("dependency-proposals", views.DependencyProposalViewSet, basename="work-dependency-proposal")
router.register("relief", views.ReliefViewSet, basename="work-relief")
router.register("blockers", views.BlockerViewSet, basename="work-blocker")

urlpatterns = [
    path("me/", views.MeView.as_view(), name="work-me"),
    path("proposals/", views.ProposalsView.as_view(), name="work-proposals"),
    path("dashboard/", views.DashboardView.as_view(), name="work-dashboard"),
    path("reports/", views.ReportView.as_view(), name="work-report"),
    path("search/", views.SearchView.as_view(), name="work-search"),
    *router.urls,
]
