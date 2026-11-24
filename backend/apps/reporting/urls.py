from django.urls import path

from .views import DashboardView, MonthlyReportView, ReportingRightsView, WeeklyReportView

urlpatterns = [
    path("reporting/rights/", ReportingRightsView.as_view(), name="reporting-rights"),
    path("reporting/dashboard/", DashboardView.as_view(), name="reporting-dashboard"),
    path("reporting/reports/weekly/", WeeklyReportView.as_view(), name="reporting-weekly"),
    path("reporting/reports/monthly/", MonthlyReportView.as_view(), name="reporting-monthly"),
]
