"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fetchExcuses, fetchMeeting, fetchMeetingRights, fetchMeetings, fetchPresence } from "./api";

/** Cache keys of the sessions. A change invalidates them all (see refreshMeetings): the lists are small. */
export const meetingKeys = {
  rights: ["meeting-rights"] as const,
  list: (when?: "upcoming" | "past") => ["meetings", when ?? "all"] as const,
  detail: (id: number) => ["meeting", id] as const,
  excuses: ["meeting-excuses"] as const,
  presence: (member?: number) => ["meeting-presence", member ?? "me"] as const,
};

export function useMeetingRights() {
  return useQuery({ queryKey: meetingKeys.rights, queryFn: fetchMeetingRights });
}

export function useMeetings(when?: "upcoming" | "past") {
  return useQuery({ queryKey: meetingKeys.list(when), queryFn: () => fetchMeetings(when) });
}

export function useMeeting(id: number) {
  return useQuery({ queryKey: meetingKeys.detail(id), queryFn: () => fetchMeeting(id), enabled: id > 0 });
}

export function useExcuses(enabled = true) {
  return useQuery({ queryKey: meetingKeys.excuses, queryFn: fetchExcuses, enabled });
}

export function usePresence(member?: number) {
  return useQuery({ queryKey: meetingKeys.presence(member), queryFn: () => fetchPresence(member) });
}

/** After a change: the sessions, the excuses, the presence and the rights listed again when next shown. */
export function refreshMeetings(queryClient: QueryClient) {
  return Promise.all(
    ["meeting-rights", "meetings", "meeting", "meeting-excuses", "meeting-presence", "tasks"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
