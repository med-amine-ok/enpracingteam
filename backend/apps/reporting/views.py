"""
The Team Manager's dashboard and the reports (decision D-014, knowledge base:
PROJECTS/ERP/team_dashboard_design.md). The figures: health.py and reports.py; the files: exports.py.
"""

import re

from django.http import HttpResponse
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from . import exports, health, reports
from .access import reporting_access_for
from .serializers import (
    DashboardSerializer, MonthlyReportSerializer, ReportingRightsSerializer, WeeklyReportSerializer,
)

EXPORTS = {
    "pdf": ("application/pdf", "pdf", exports.to_pdf),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", exports.to_xlsx),
}
LANG = OpenApiParameter("lang", str, enum=list(reports.LANGUAGES),
                        description="The report's language: French or English (default: the reader's, else French).")
EXPORT = OpenApiParameter("export", str, enum=["pdf", "xlsx"], description="A file instead of the data.")
WITH_EXPORT = "The report's data; with export, the PDF or the Excel workbook instead (an attachment)."


class ReportingRightsView(APIView):
    @extend_schema(summary="What the viewer may see: the dashboard, the reports", responses=ReportingRightsSerializer)
    def get(self, request):
        access = reporting_access_for(request)
        return Response(ReportingRightsSerializer(
            {"dashboard": access.sees_dashboard(), "reports": access.sees_team()}
        ).data)


class DashboardView(APIView):
    @extend_schema(
        summary="The Team Manager's dashboard: the whole team for the admins (Board, Team Manager) and the Bureau's positions; "
                "their departments for the leaders",
        responses=DashboardSerializer,
    )
    def get(self, request):
        access = reporting_access_for(request)
        if not access.sees_dashboard():
            raise PermissionDenied(_("The dashboard is for the Board, the Team Manager, the Bureau's positions and the leaders."))
        return Response(DashboardSerializer(health.dashboard(timezone.now(), access.scope())).data)


class ReportView(APIView):
    serializer_class = None

    def prepare(self, request):
        if not reporting_access_for(request).sees_team():
            raise PermissionDenied(_("The team's reports are for the Board, the Team Manager and the Bureau's positions."))
        language = request.query_params.get("lang") or getattr(request.user, "language", "") or "fr"
        if language not in reports.LANGUAGES:
            language = "fr"
        export = request.query_params.get("export")
        if export and export not in EXPORTS:
            raise ValidationError({"export": [_("Choose pdf or xlsx.")]})
        return language, export

    def answer(self, report, export):
        if not export:
            return Response(self.serializer_class(report).data)
        content_type, extension, make = EXPORTS[export]
        response = HttpResponse(make(report), content_type=content_type)
        response["Content-Disposition"] = f'attachment; filename="{exports.file_name(report)}.{extension}"'
        return response


class WeeklyReportView(ReportView):
    serializer_class = WeeklyReportSerializer

    @extend_schema(summary="The weekly team report (the last 7 days, the priorities of the next 7)",
                   parameters=[LANG, EXPORT],
                   responses=OpenApiResponse(WeeklyReportSerializer, description=WITH_EXPORT))
    def get(self, request):
        language, export = self.prepare(request)
        return self.answer(reports.weekly(timezone.now(), language), export)


class MonthlyReportView(ReportView):
    serializer_class = MonthlyReportSerializer

    @extend_schema(
        summary="The monthly performance report of a calendar month",
        parameters=[OpenApiParameter("month", str, description="YYYY-MM (default: the current month)."), LANG, EXPORT],
        responses=OpenApiResponse(MonthlyReportSerializer, description=WITH_EXPORT),
    )
    def get(self, request):
        language, export = self.prepare(request)
        value = request.query_params.get("month") or timezone.localdate().strftime("%Y-%m")
        match = re.fullmatch(r"(\d{4})-(\d{2})", value)
        # Years bounded: 0000-01 or 9999-12 would overflow the dates computed from them (a 500, not a 400).
        if not match or not 1 <= int(match.group(2)) <= 12 or not 2000 <= int(match.group(1)) <= 2100:
            raise ValidationError({"month": [_("A month is written YYYY-MM, such as 2026-10.")]})
        year, month = int(match.group(1)), int(match.group(2))
        return self.answer(reports.monthly(year, month, timezone.now(), language), export)
