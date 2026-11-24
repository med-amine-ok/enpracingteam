"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fetchAssistantRights, fetchConversation, fetchConversations, fetchSources } from "./api";

export const assistantKeys = {
  rights: ["assistant-rights"] as const,
  conversations: ["assistant-conversations"] as const,
  conversation: (id: number) => ["assistant-conversation", id] as const,
  sources: ["assistant-sources"] as const,
};

export function useAssistantRights() {
  return useQuery({ queryKey: assistantKeys.rights, queryFn: fetchAssistantRights });
}

export function useConversations() {
  return useQuery({ queryKey: assistantKeys.conversations, queryFn: fetchConversations });
}

export function useConversation(id: number | null) {
  return useQuery({
    queryKey: assistantKeys.conversation(id ?? 0),
    queryFn: () => fetchConversation(id!),
    enabled: id !== null,
  });
}

/** The sources, fetched again every 3 seconds while one is being read. */
export function useSources(enabled = true) {
  return useQuery({
    queryKey: assistantKeys.sources,
    queryFn: fetchSources,
    enabled,
    refetchInterval: (query) => (query.state.data?.some((source) => source.status === "reading") ? 3000 : false),
  });
}

export function refreshAssistant(queryClient: QueryClient) {
  return Promise.all(
    ["assistant-rights", "assistant-conversations", "assistant-conversation", "assistant-sources"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
