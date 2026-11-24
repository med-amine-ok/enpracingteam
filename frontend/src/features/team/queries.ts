"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchDashboard,
  fetchMonthlyReport,
  fetchReportingRights,
  fetchWeeklyReport,
  type ReportLanguage,
} from "./api";

export const teamKeys = {
  rights: ["reporting-rights"] as const,
  dashboard: ["team-dashboard"] as const,
  weekly: (lang: ReportLanguage) => ["weekly-report", lang] as const,
  monthly: (month: string, lang: ReportLanguage) => ["monthly-report", month, lang] as const,
};

/** Who sees the dashboard and the reports: asked once, kept a few minutes (the menu uses it). */
export function useReportingRights(enabled = true) {
  return useQuery({ queryKey: teamKeys.rights, queryFn: fetchReportingRights, staleTime: 5 * 60_000, enabled });
}

export function useDashboard(enabled = true) {
  return useQuery({ queryKey: teamKeys.dashboard, queryFn: fetchDashboard, enabled });
}

export function useWeeklyReport(lang: ReportLanguage, enabled = true) {
  return useQuery({ queryKey: teamKeys.weekly(lang), queryFn: () => fetchWeeklyReport(lang), enabled });
}

export function useMonthlyReport(month: string, lang: ReportLanguage, enabled = true) {
  return useQuery({
    queryKey: teamKeys.monthly(month, lang),
    queryFn: () => fetchMonthlyReport(month, lang),
    enabled: enabled && /^\d{4}-\d{2}$/.test(month),
  });
}
