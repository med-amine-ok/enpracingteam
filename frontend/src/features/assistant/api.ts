import { api } from "@/lib/api/client";
import { dataOf, ensureOk, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type AssistantRights = Schemas["AssistantRights"];
export type Conversation = Schemas["Conversation"];
export type ConversationDetail = Schemas["ConversationDetail"];
export type Message = Schemas["Message"];
export type Citation = Schemas["Citation"];
export type Answer = Schemas["Answer"];
export type Source = Schemas["Source"];
export type SourceStatus = Schemas["SourceStatusEnum"];

/** What the assistant reads (backend/apps/assistant/reading.py ALLOWED_EXTENSIONS). */
export const ACCEPTED_SOURCES = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg";

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

export async function fetchAssistantRights() {
  return dataOf(await call(() => api.GET("/api/assistant/rights/")));
}

// --- Conversations (each member's own) ---

export function fetchConversations() {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/assistant/conversations/", { params: { query: { page } } }))),
  );
}

export async function fetchConversation(id: number) {
  return dataOf(await call(() => api.GET("/api/assistant/conversations/{id}/", { params: { path: { id } } })));
}

export async function deleteConversation(id: number) {
  ensureOk(await call(() => api.DELETE("/api/assistant/conversations/{id}/", { params: { path: { id } } })));
}

/** The answer, from the sources: a new conversation, or the next question of `conversationId`. */
export async function askAssistant(question: string, conversationId: number | null) {
  return dataOf(
    await call(() =>
      api.POST("/api/assistant/conversations/ask/", {
        body: { question, ...(conversationId ? { conversation_id: conversationId } : {}) },
      }),
    ),
  );
}

// --- Sources (the Executive Bureau) ---

export async function fetchSources() {
  return dataOf(await call(() => api.GET("/api/assistant/sources/")));
}

/** A source with its file, sent as a form (multipart): the browser sets its boundary. */
export async function addSource(fields: { title: string; season: number; file: File }) {
  const form = new FormData();
  form.append("title", fields.title);
  form.append("season", String(fields.season));
  form.append("file", fields.file);
  return dataOf(await call(() => api.POST("/api/assistant/sources/", { body: form as never })));
}

export async function rereadSource(id: number) {
  return dataOf(await call(() => api.POST("/api/assistant/sources/{id}/reread/", { params: { path: { id } } })));
}

export async function deleteSource(id: number) {
  ensureOk(await call(() => api.DELETE("/api/assistant/sources/{id}/", { params: { path: { id } } })));
}
