"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchEquipment,
  fetchEquipmentList,
  fetchLoans,
  fetchMyReservations,
  fetchWeekReservations,
  fetchWorkshopRights,
  type EquipmentFilters,
  type LoanFilters,
  type ReservationWhen,
} from "./api";

export const workshopKeys = {
  list: (filters: EquipmentFilters = {}) => ["equipment", filters] as const,
  detail: (id: number) => ["equipment-item", id] as const,
  rights: ["workshop-rights"] as const,
  reservations: (when?: ReservationWhen) => ["equipment-reservations", when ?? "all"] as const,
  week: (start: string, equipment?: number) => ["equipment-week", start, equipment ?? 0] as const,
  loans: (filters: LoanFilters = {}) => ["equipment-loans", filters] as const,
};

export function useEquipmentList(filters: EquipmentFilters = {}) {
  return useQuery({ queryKey: workshopKeys.list(filters), queryFn: () => fetchEquipmentList(filters) });
}

export function useEquipment(id: number) {
  return useQuery({ queryKey: workshopKeys.detail(id), queryFn: () => fetchEquipment(id), enabled: id > 0 });
}

/** May the viewer manage the equipment, certify the members (kept 5 minutes: roles rarely change). */
export function useWorkshopRights() {
  return useQuery({ queryKey: workshopKeys.rights, queryFn: fetchWorkshopRights, staleTime: 5 * 60_000 });
}

export function useMyReservations(when?: ReservationWhen) {
  return useQuery({ queryKey: workshopKeys.reservations(when), queryFn: () => fetchMyReservations(when) });
}

export function useWeekReservations(start: string, equipment?: number) {
  return useQuery({
    queryKey: workshopKeys.week(start, equipment),
    queryFn: () => fetchWeekReservations(start, equipment),
  });
}

export function useLoans(filters: LoanFilters = {}, enabled = true) {
  return useQuery({ queryKey: workshopKeys.loans(filters), queryFn: () => fetchLoans(filters), enabled });
}

/** After a change: everything of the workshop is fetched again when next shown. */
export function refreshWorkshop(queryClient: QueryClient) {
  return Promise.all(
    ["equipment", "equipment-item", "equipment-reservations", "equipment-week", "equipment-loans"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
