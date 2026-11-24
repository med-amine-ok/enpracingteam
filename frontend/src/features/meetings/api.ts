import { api } from "@/lib/api/client";
import { dataOf, ensureOk, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type Meeting = Schemas["Meeting"];
export type MeetingDetail = Schemas["MeetingDetail"];
export type MeetingWrite = Schemas["MeetingWriteRequest"];
export type MeetingChange = Schemas["PatchedMeetingWriteRequest"];
export type MeetingKind = Schemas["MeetingKindEnum"];
export type Attendance = Schemas["Attendance"];
export type AttendanceStatus = Schemas["AttendanceStatusEnum"];
export type ExcuseReason = Schemas["ExcuseReasonEnum"];
export type ExcuseStatus = Schemas["ExcuseStatusEnum"];
export type MeetingAction = Schemas["Action"];
export type ActionWrite = Schemas["ActionWriteRequest"];
export type ActionChange = Schemas["PatchedActionWriteRequest"];
export type ExcuseRow = Schemas["ExcuseRow"];
export type Presence = Schemas["Presence"];
export type MeetingRights = Schemas["MeetingRights"];
export type Mark = Extract<AttendanceStatus, "present" | "late" | "absent">;

export const MEETING_KINDS: MeetingKind[] = ["department", "general", "workshop", "training", "event"];
export const EXCUSE_REASONS: ExcuseReason[] = ["exam", "illness", "family", "mission"];
export const MARKS: Mark[] = ["present", "late", "absent"];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

// --- Sessions ---

export async function fetchMeetingRights() {
  return dataOf(await call(() => api.GET("/api/meetings/rights/")));
}

export function fetchMeetings(when?: "upcoming" | "past") {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/meetings/", { params: { query: { page, ...(when ? { when } : {}) } } }))),
  );
}

export async function fetchMeeting(id: number) {
  return dataOf(await call(() => api.GET("/api/meetings/{id}/", { params: { path: { id } } })));
}

export async function createMeeting(body: MeetingWrite) {
  return dataOf(await call(() => api.POST("/api/meetings/", { body })));
}

export async function updateMeeting(id: number, body: MeetingChange) {
  return dataOf(await call(() => api.PATCH("/api/meetings/{id}/", { params: { path: { id } }, body })));
}

export async function cancelMeeting(id: number, reason: string) {
  return dataOf(
    await call(() => api.POST("/api/meetings/{id}/cancel/", { params: { path: { id } }, body: { reason } })),
  );
}

export async function addInvitee(id: number, member: number) {
  return dataOf(
    await call(() =>
      api.POST("/api/meetings/{id}/invitees/", { params: { path: { id } }, body: { member_id: member } }),
    ),
  );
}

export async function removeInvitee(id: number, member: number) {
  ensureOk(
    await call(() =>
      api.DELETE("/api/meetings/{id}/invitees/{member_id}/", { params: { path: { id, member_id: member } } }),
    ),
  );
}

// --- Attendance ---

export async function checkIn(id: number) {
  return dataOf(await call(() => api.POST("/api/meetings/{id}/check-in/", { params: { path: { id } } })));
}

export async function confirmAttendance(id: number, entries: { member_id: number; status: Mark }[]) {
  return dataOf(
    await call(() => api.POST("/api/meetings/{id}/attendance/", { params: { path: { id } }, body: { entries } })),
  );
}

export async function askExcuse(id: number, reason: ExcuseReason, note: string) {
  return dataOf(
    await call(() => api.POST("/api/meetings/{id}/excuse/", { params: { path: { id } }, body: { reason, note } })),
  );
}

export function fetchExcuses() {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/meetings/excuses/", { params: { query: { page } } }))),
  );
}

export async function decideExcuse(id: number, accept: boolean, note = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/meetings/excuses/{id}/decide/", { params: { path: { id } }, body: { accept, note } }),
    ),
  );
}

export async function fetchPresence(member?: number) {
  return dataOf(await call(() => api.GET("/api/meetings/presence/", { params: { query: member ? { member } : {} } })));
}

// --- Minutes, decisions, actions ---

export async function saveMinutes(id: number, minutes: string, publish: boolean) {
  return dataOf(
    await call(() => api.POST("/api/meetings/{id}/minutes/", { params: { path: { id } }, body: { minutes, publish } })),
  );
}

export async function addDecision(id: number, text: string) {
  return dataOf(
    await call(() => api.POST("/api/meetings/{id}/decisions/", { params: { path: { id } }, body: { text } })),
  );
}

export async function deleteDecision(id: number, decision: number) {
  ensureOk(
    await call(() =>
      api.DELETE("/api/meetings/{id}/decisions/{decision_id}/", {
        params: { path: { id, decision_id: decision } },
      }),
    ),
  );
}

export async function addAction(id: number, body: ActionWrite) {
  return dataOf(await call(() => api.POST("/api/meetings/{id}/actions/", { params: { path: { id } }, body })));
}

export async function changeAction(id: number, action: number, body: ActionChange) {
  return dataOf(
    await call(() =>
      api.PATCH("/api/meetings/{id}/actions/{action_id}/", { params: { path: { id, action_id: action } }, body }),
    ),
  );
}

export async function actionToTask(id: number, action: number, project: number) {
  return dataOf(
    await call(() =>
      api.POST("/api/meetings/{id}/actions/{action_id}/task/", {
        params: { path: { id, action_id: action } },
        body: { project_id: project },
      }),
    ),
  );
}
