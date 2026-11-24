"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchContributions,
  fetchMemberMonth,
  fetchMonthTable,
  fetchMyRanking,
  fetchRankingRights,
  type ContributionFilters,
} from "./api";

export const rankingKeys = {
  rights: ["ranking-rights"] as const,
  mine: (month?: string) => ["ranking-me", month ?? "current"] as const,
  month: (month: string) => ["ranking-month", month] as const,
  member: (id: number, month: string) => ["ranking-member", id, month] as const,
  contributions: (filters: ContributionFilters = {}) => ["contributions", filters] as const,
};

export function useRankingRights() {
  return useQuery({ queryKey: rankingKeys.rights, queryFn: fetchRankingRights, staleTime: 5 * 60_000 });
}

export function useMyRanking(month?: string) {
  return useQuery({ queryKey: rankingKeys.mine(month), queryFn: () => fetchMyRanking(month) });
}

export function useMonthTable(month: string, enabled = true) {
  return useQuery({ queryKey: rankingKeys.month(month), queryFn: () => fetchMonthTable(month), enabled });
}

export function useMemberMonth(id: number, month: string) {
  return useQuery({
    queryKey: rankingKeys.member(id, month),
    queryFn: () => fetchMemberMonth(id, month),
    enabled: id > 0,
  });
}

export function useContributions(filters: ContributionFilters = {}) {
  return useQuery({ queryKey: rankingKeys.contributions(filters), queryFn: () => fetchContributions(filters) });
}

/** After a change: the scores and the points are fetched again when next shown. */
export function refreshRanking(queryClient: QueryClient) {
  return Promise.all(
    ["ranking-me", "ranking-month", "ranking-member", "contributions"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
