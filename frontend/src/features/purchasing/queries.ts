"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchPart,
  fetchPurchase,
  fetchPurchases,
  fetchPurchaseSummary,
  fetchShippingAddresses,
  fetchSuppliers,
  searchParts,
  type PurchaseFilters,
} from "./api";

/** Cache keys of the purchasing data. A change invalidates what it may affect (see refreshPurchasing). */
export const purchasingKeys = {
  purchases: (filters: PurchaseFilters = {}) => ["purchases", filters] as const,
  purchase: (id: number) => ["purchase", id] as const,
  summary: ["purchase-summary"] as const,
  suppliers: ["suppliers"] as const,
  parts: (search: string) => ["parts", search] as const,
  part: (id: number) => ["part", id] as const,
  shippingAddresses: ["shipping-addresses"] as const,
};

export function usePurchases(filters: PurchaseFilters = {}) {
  return useQuery({ queryKey: purchasingKeys.purchases(filters), queryFn: () => fetchPurchases(filters) });
}

export function usePurchase(id: number) {
  return useQuery({ queryKey: purchasingKeys.purchase(id), queryFn: () => fetchPurchase(id), enabled: id > 0 });
}

export function usePurchaseSummary() {
  return useQuery({ queryKey: purchasingKeys.summary, queryFn: fetchPurchaseSummary });
}

export function useSuppliers() {
  return useQuery({ queryKey: purchasingKeys.suppliers, queryFn: fetchSuppliers });
}

export function usePart(id: number) {
  return useQuery({ queryKey: purchasingKeys.part(id), queryFn: () => fetchPart(id), enabled: id > 0 });
}

/** Parts already known whose name or reference contains `search` (from 2 characters). */
export function useParts(search: string) {
  const words = search.trim();
  return useQuery({
    queryKey: purchasingKeys.parts(words),
    queryFn: () => searchParts(words),
    enabled: words.length >= 2,
  });
}

/** Operations only (the API refuses the others): ask only when allowed. */
export function useShippingAddresses(enabled: boolean) {
  return useQuery({ queryKey: purchasingKeys.shippingAddresses, queryFn: fetchShippingAddresses, enabled });
}

/** After a change: the lists, the counters and the request itself are read again when next shown. */
export function refreshPurchasing(queryClient: QueryClient) {
  return Promise.all(
    ["purchases", "purchase", "purchase-summary", "suppliers", "notifications"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
