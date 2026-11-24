"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchJournal,
  fetchStock,
  fetchStockItem,
  fetchStockSummary,
  type JournalFilters,
  type StockFilters,
} from "./api";

/** Cache keys of the stock data. A change invalidates what it may affect (see refreshStock). */
export const stockKeys = {
  lines: (filters: StockFilters = {}) => ["stock", filters] as const,
  line: (id: number) => ["stock-line", id] as const,
  summary: ["stock-summary"] as const,
  journal: (filters: JournalFilters = {}) => ["stock-journal", filters] as const,
};

export function useStock(filters: StockFilters = {}) {
  return useQuery({ queryKey: stockKeys.lines(filters), queryFn: () => fetchStock(filters) });
}

export function useStockItem(id: number) {
  return useQuery({ queryKey: stockKeys.line(id), queryFn: () => fetchStockItem(id), enabled: id > 0 });
}

export function useStockSummary() {
  return useQuery({ queryKey: stockKeys.summary, queryFn: fetchStockSummary });
}

export function useJournal(filters: JournalFilters = {}, enabled = true) {
  return useQuery({ queryKey: stockKeys.journal(filters), queryFn: () => fetchJournal(filters), enabled });
}

/** After a movement or a change: the lists, the counters, the journal and the line are read again. */
export function refreshStock(queryClient: QueryClient) {
  return Promise.all(
    ["stock", "stock-line", "stock-summary", "stock-journal", "notifications"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
