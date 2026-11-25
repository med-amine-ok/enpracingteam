"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { refreshWorkflow } from "../queries";
import { fetchQualityHistory, fetchQualityInputs, type QualityFilters } from "./hub-api";

export const qualityKeys = {
  all: ["quality-inputs"] as const,
  list: (filters: QualityFilters) => ["quality-inputs", "list", filters] as const,
  history: (deliverable: number) => ["quality-inputs", "history", deliverable] as const,
};

/** `enabled` waits for the default filters (the current season) to be known: one request, not two. */
export function useQualityInputs(filters: QualityFilters, enabled = true) {
  return useQuery({
    queryKey: qualityKeys.list(filters),
    queryFn: () => fetchQualityInputs(filters),
    retry: false,
    enabled,
  });
}

export function useQualityHistory(deliverable: number, enabled: boolean) {
  return useQuery({
    queryKey: qualityKeys.history(deliverable),
    queryFn: () => fetchQualityHistory(deliverable),
    enabled,
  });
}

/** After a quality input changed: its rows and history, and the work module. */
export async function refreshQuality(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: qualityKeys.all });
  await refreshWorkflow(queryClient);
}
