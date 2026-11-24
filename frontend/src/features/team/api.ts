import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";
import { saveBlob } from "@/lib/csv";

type Schemas = components["schemas"];

export type ReportingRights = Schemas["ReportingRights"];
export type Dashboard = Schemas["Dashboard"];
export type Indicators = Schemas["Indicators"];
export type IndicatorKey = keyof Indicators;
export type Colour = Schemas["HealthColourEnum"];
export type MemberHealth = Schemas["MemberHealthEnum"];
export type Warning = Schemas["Warning"];
export type WarningKind = Schemas["WarningKindEnum"];
export type DepartmentRow = Schemas["DepartmentRow"];
export type MemberRow = Schemas["MemberRow"];
export type WeeklyReport = Schemas["WeeklyReport"];
export type MonthlyReport = Schemas["MonthlyReport"];
export type ReportLanguage = "fr" | "en";
export type ReportFile = "pdf" | "xlsx";

/** The indicators, in the order of "Team Manager – ERP Requirements" §1.1. */
export const INDICATORS: IndicatorKey[] = [
  "active_members",
  "inactive_members",
  "attendance_rate",
  "completion_rate",
  "overdue_tasks",
  "blocked_tasks",
  "critical_tasks",
  "members_without_objectives",
  "unresolved_blockers",
];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

export async function fetchReportingRights() {
  return dataOf(await call(() => api.GET("/api/reporting/rights/")));
}

export async function fetchDashboard() {
  return dataOf(await call(() => api.GET("/api/reporting/dashboard/")));
}

export async function fetchWeeklyReport(lang: ReportLanguage) {
  return dataOf(await call(() => api.GET("/api/reporting/reports/weekly/", { params: { query: { lang } } })));
}

export async function fetchMonthlyReport(month: string, lang: ReportLanguage) {
  return dataOf(await call(() => api.GET("/api/reporting/reports/monthly/", { params: { query: { month, lang } } })));
}

/** A report as a file (PDF or Excel), fetched with the session, then saved by the browser. */
export async function downloadReport(
  kind: "weekly" | "monthly",
  options: { lang: ReportLanguage; file: ReportFile; month?: string },
  name: string,
) {
  const query = { lang: options.lang, export: options.file, ...(options.month ? { month: options.month } : {}) };
  const blob = dataOf(
    await call(() =>
      kind === "weekly"
        ? api.GET("/api/reporting/reports/weekly/", { params: { query }, parseAs: "blob" })
        : api.GET("/api/reporting/reports/monthly/", { params: { query }, parseAs: "blob" }),
    ),
  ) as unknown as Blob;
  saveBlob(blob, `${name}.${options.file}`);
}
