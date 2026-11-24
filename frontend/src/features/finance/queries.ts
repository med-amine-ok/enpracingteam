"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchBudget,
  fetchBudgets,
  fetchExpenses,
  fetchFinanceSummary,
  fetchSponsors,
  fetchSponsorSummary,
  type ExpenseFilters,
} from "./api";

/** Cache keys of the finance data. A change invalidates what it may affect (see refreshFinance). */
export const financeKeys = {
  summary: (year = "") => ["finance-summary", year] as const,
  budgets: (year: string) => ["finance-budgets", year] as const,
  budget: (id: number) => ["finance-budget", id] as const,
  expenses: (filters: ExpenseFilters = {}) => ["finance-expenses", filters] as const,
  sponsors: ["finance-sponsors"] as const,
  sponsorSummary: (year = "") => ["finance-sponsor-summary", year] as const,
};

/** The viewer's rights and the key figures (of the current budget year without `year`). */
export function useFinanceSummary(year?: string) {
  return useQuery({ queryKey: financeKeys.summary(year), queryFn: () => fetchFinanceSummary(year) });
}

export function useBudgets(year: string, enabled = true) {
  return useQuery({
    queryKey: financeKeys.budgets(year),
    queryFn: () => fetchBudgets(year),
    enabled: enabled && !!year,
  });
}

export function useBudget(id: number) {
  return useQuery({ queryKey: financeKeys.budget(id), queryFn: () => fetchBudget(id), enabled: id > 0 });
}

export function useExpenses(filters: ExpenseFilters = {}, enabled = true) {
  return useQuery({ queryKey: financeKeys.expenses(filters), queryFn: () => fetchExpenses(filters), enabled });
}

export function useSponsors(enabled = true) {
  return useQuery({ queryKey: financeKeys.sponsors, queryFn: fetchSponsors, enabled });
}

export function useSponsorSummary(year?: string, enabled = true) {
  return useQuery({
    queryKey: financeKeys.sponsorSummary(year),
    queryFn: () => fetchSponsorSummary(year),
    enabled,
  });
}

/** After a change: the budgets, the expenses, the counters and the sponsors are read again. */
export function refreshFinance(queryClient: QueryClient) {
  return Promise.all(
    [
      "finance-summary",
      "finance-budgets",
      "finance-budget",
      "finance-expenses",
      "finance-sponsors",
      "finance-sponsor-summary",
      "notifications",
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  );
}
