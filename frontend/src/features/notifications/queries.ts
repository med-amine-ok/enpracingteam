"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchNotifications, fetchUnreadCount, markAllRead, markRead } from "./api";

export const notificationKeys = {
  all: ["notifications"] as const,
  list: (unread: boolean) => ["notifications", "list", { unread }] as const,
  unreadCount: ["notifications", "unread-count"] as const,
};

/** Checked again every minute while the page is shown (not in a hidden tab), and on coming back to it. */
const EVERY_MINUTE = 60_000;

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: fetchUnreadCount,
    refetchInterval: EVERY_MINUTE,
    enabled,
  });
}

export function useNotifications(unread = false, enabled = true) {
  return useQuery({
    queryKey: notificationKeys.list(unread),
    queryFn: () => fetchNotifications(unread),
    refetchInterval: EVERY_MINUTE,
    enabled,
  });
}

export function refreshNotifications(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: notificationKeys.all });
}

/** Marks one notification read (opening it does so), then lists and counts again. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  // Wrapped: TanStack Query passes a second argument (its context) to mutationFn.
  return useMutation({ mutationFn: (id: number) => markRead(id), onSuccess: () => refreshNotifications(queryClient) });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => markAllRead(), onSuccess: () => refreshNotifications(queryClient) });
}
