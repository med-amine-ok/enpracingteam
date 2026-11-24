"use client";

import { useQuery } from "@tanstack/react-query";
import { liveryOfUnit } from "@/lib/livery";
import { fetchMemberAdding, fetchMemberManage, fetchMembers, fetchOrgUnits } from "./api";

export const membersQueryKey = ["members"] as const;
export const orgUnitsQueryKey = ["org-units"] as const;
export const memberAddingQueryKey = ["member-adding"] as const;
export const memberManageQueryKey = (id: number) => ["member-manage", id] as const;

/** All members, shared by the directory and the org chart (loaded once, kept 5 minutes). */
export function useMembers() {
  return useQuery({ queryKey: membersQueryKey, queryFn: fetchMembers, staleTime: 5 * 60_000 });
}

/** All org units (they rarely change). */
export function useOrgUnits() {
  return useQuery({ queryKey: orgUnitsQueryKey, queryFn: fetchOrgUnits, staleTime: 30 * 60_000 });
}

/** The livery of a unit by its code: through its parents once the org units are loaded (a unit added later under a
 * department wears the department's), by its code alone until then. */
export function useUnitLivery() {
  const units = useOrgUnits();
  return (code: string | null | undefined) => liveryOfUnit(code, units.data);
}

/** Where the viewer may add members, and with which roles (none: no "Add a member" button). */
export function useMemberAdding() {
  return useQuery({ queryKey: memberAddingQueryKey, queryFn: fetchMemberAdding, staleTime: 5 * 60_000 });
}

/** A member as the Board and the Team Manager edit them (decision D-025). */
export function useMemberManage(id: number) {
  return useQuery({ queryKey: memberManageQueryKey(id), queryFn: () => fetchMemberManage(id), enabled: id > 0 });
}
