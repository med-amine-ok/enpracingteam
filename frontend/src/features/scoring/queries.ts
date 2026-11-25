"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchAudit,
  fetchFormulaVersions,
  fetchMemberScores,
  fetchQualityInputs,
  fetchRun,
  fetchRunRankings,
  fetchRuns,
  fetchScoringDashboard,
  fetchValidationIssues,
  type AuditFilters,
} from "./api";

/** Cache keys of the scoring workspace; every change refreshes them all (refreshScoring): a run, a publication or a
 * new formula changes what every screen shows. */
export const scoringKeys = {
  all: ["scoring"] as const,
  dashboard: (season?: number | null) => ["scoring", "dashboard", season ?? 0] as const,
  validation: (season?: number | null) => ["scoring", "validation", season ?? 0] as const,
  runs: (season?: number | null) => ["scoring", "runs", season ?? 0] as const,
  run: (id: number) => ["scoring", "run", id] as const,
  rankings: (id: number, department?: number | null) => ["scoring", "rankings", id, department ?? 0] as const,
  member: (id: number, run?: number | null) => ["scoring", "member", id, run ?? 0] as const,
  formulas: ["scoring", "formulas"] as const,
  audit: (filters: AuditFilters = {}) => ["scoring", "audit", filters] as const,
  quality: (season?: number | null) => ["scoring", "quality", season ?? 0] as const,
};

export function refreshScoring(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: scoringKeys.all });
}

export function useScoringDashboard(season?: number | null) {
  return useQuery({ queryKey: scoringKeys.dashboard(season), queryFn: () => fetchScoringDashboard(season) });
}

export function useValidationIssues(season?: number | null) {
  return useQuery({ queryKey: scoringKeys.validation(season), queryFn: () => fetchValidationIssues(season) });
}

export function useRuns(season?: number | null) {
  return useQuery({ queryKey: scoringKeys.runs(season), queryFn: () => fetchRuns(season) });
}

export function useRun(id: number | null | undefined) {
  return useQuery({ queryKey: scoringKeys.run(id ?? 0), queryFn: () => fetchRun(id ?? 0), enabled: !!id && id > 0 });
}

export function useRunRankings(id: number, department?: number | null) {
  return useQuery({
    queryKey: scoringKeys.rankings(id, department),
    queryFn: () => fetchRunRankings(id, department),
    enabled: id > 0,
  });
}

export function useMemberScores(id: number, run?: number | null) {
  return useQuery({
    queryKey: scoringKeys.member(id, run),
    queryFn: () => fetchMemberScores(id, run),
    enabled: id > 0,
  });
}

export function useFormulaVersions() {
  return useQuery({ queryKey: scoringKeys.formulas, queryFn: fetchFormulaVersions });
}

export function useAudit(filters: AuditFilters = {}) {
  return useQuery({ queryKey: scoringKeys.audit(filters), queryFn: () => fetchAudit(filters) });
}

export function useQualityInputs(season?: number | null) {
  return useQuery({ queryKey: scoringKeys.quality(season), queryFn: () => fetchQualityInputs(season) });
}
