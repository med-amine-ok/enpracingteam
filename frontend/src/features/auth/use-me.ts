"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "./api";

export const meQueryKey = ["me"] as const;

/** The logged-in member (null: not logged in), shared by every component that asks for it. */
export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 60_000 });
}
