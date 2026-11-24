"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchDisciplineRights,
  fetchExclusions,
  fetchReports,
  fetchStanding,
  fetchTargets,
  fetchWarning,
  fetchWarnings,
  type ReportFilters,
  type WarningFilters,
} from "./api";

export const disciplineKeys = {
  rights: ["discipline-rights"] as const,
  targets: ["discipline-targets"] as const,
  standing: (id: number) => ["discipline-standing", id] as const,
  reports: (filters: ReportFilters = {}) => ["discipline-reports", filters] as const,
  warnings: (filters: WarningFilters = {}) => ["discipline-warnings", filters] as const,
  warning: (id: number) => ["discipline-warning", id] as const,
  exclusions: ["discipline-exclusions"] as const,
};

export function useDisciplineRights() {
  return useQuery({ queryKey: disciplineKeys.rights, queryFn: fetchDisciplineRights });
}

export function useTargets(enabled = true) {
  return useQuery({ queryKey: disciplineKeys.targets, queryFn: fetchTargets, enabled });
}

export function useStanding(id: number) {
  return useQuery({ queryKey: disciplineKeys.standing(id), queryFn: () => fetchStanding(id), enabled: id > 0 });
}

export function useReports(filters: ReportFilters = {}, enabled = true) {
  return useQuery({ queryKey: disciplineKeys.reports(filters), queryFn: () => fetchReports(filters), enabled });
}

export function useWarnings(filters: WarningFilters = {}) {
  return useQuery({ queryKey: disciplineKeys.warnings(filters), queryFn: () => fetchWarnings(filters) });
}

export function useWarning(id: number) {
  return useQuery({ queryKey: disciplineKeys.warning(id), queryFn: () => fetchWarning(id), enabled: id > 0 });
}

export function useExclusions(enabled = true) {
  return useQuery({ queryKey: disciplineKeys.exclusions, queryFn: fetchExclusions, enabled });
}

/** After a change: everything about warnings is fetched again when next shown. */
export function refreshDiscipline(queryClient: QueryClient) {
  return Promise.all(
    [
      "discipline-rights",
      "discipline-standing",
      "discipline-reports",
      "discipline-warnings",
      "discipline-warning",
      "discipline-exclusions",
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  );
}
