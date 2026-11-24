import { api } from "@/lib/api/client";
import { dataOf, ensureOk, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type Goal = Schemas["Goal"];
export type GoalStatus = Schemas["ObjectiveStatusEnum"];
export type NewGoal = Schemas["GoalCreateRequest"];
export type GoalChange = Schemas["PatchedGoalChangeRequest"];
export type Training = Schemas["Training"];
export type TrainingStatus = Schemas["TrainingStatusEnum"];
export type NewTraining = Schemas["TrainingCreateRequest"];
export type Volunteering = Schemas["Volunteering"];
export type VolunteeringKind = Schemas["VolunteeringKindEnum"];
export type VolunteeringStatus = Schemas["VolunteeringStatusEnum"];
export type NewVolunteering = Schemas["VolunteeringCreateRequest"];
export type FollowedMember = Schemas["FollowedMember"];
export type CharterIssue = Schemas["CharterIssue"];
export type MemberSheet = Schemas["MemberSheet"];
export type GoalFilters = Omit<NonNullable<operations["objectives_list"]["parameters"]["query"]>, "page">;
export type TrainingFilters = Omit<NonNullable<operations["trainings_list"]["parameters"]["query"]>, "page">;
export type VolunteeringFilters = Omit<NonNullable<operations["volunteering_list"]["parameters"]["query"]>, "page">;

export const GOAL_STATUSES: GoalStatus[] = ["in_progress", "achieved", "not_achieved", "dropped"];
export const VOLUNTEERING_KINDS: VolunteeringKind[] = [
  "workshop",
  "equipment",
  "team_works",
  "event",
  "other_department",
  "logistics",
  "documentation",
  "other",
];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

export async function fetchEngagementRights() {
  return dataOf(await call(() => api.GET("/api/engagement/rights/")));
}

/** The members the viewer heads (everyone for the Team Manager and the Bureau), never themself. */
export async function fetchFollowedMembers() {
  return dataOf(await call(() => api.GET("/api/engagement/members/")));
}

export async function fetchMemberSheet(memberId: number) {
  return dataOf(
    await call(() => api.GET("/api/engagement/sheet/{member_id}/", { params: { path: { member_id: memberId } } })),
  );
}

export async function fetchCharterIssues() {
  return dataOf(await call(() => api.GET("/api/engagement/charter-issues/")));
}

// --- Goals ---

export function fetchGoals(query: GoalFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/objectives/", { params: { query: { ...query, page } } }))),
  );
}

export async function createGoal(body: NewGoal) {
  return dataOf(await call(() => api.POST("/api/objectives/", { body })));
}

export async function changeGoal(id: number, body: GoalChange) {
  return dataOf(await call(() => api.PATCH("/api/objectives/{id}/", { params: { path: { id } }, body })));
}

// --- Trainings ---

export function fetchTrainings(query: TrainingFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/trainings/", { params: { query: { ...query, page } } }))),
  );
}

export async function createTraining(body: NewTraining) {
  return dataOf(await call(() => api.POST("/api/trainings/", { body })));
}

export async function withdrawTraining(id: number) {
  ensureOk(await call(() => api.DELETE("/api/trainings/{id}/", { params: { path: { id } } })));
}

export async function planTraining(id: number, body: { session_id: number | null; note: string }) {
  return dataOf(await call(() => api.POST("/api/trainings/{id}/plan/", { params: { path: { id } }, body })));
}

export async function followTraining(id: number, body: { followed_on: string; note: string }) {
  return dataOf(await call(() => api.POST("/api/trainings/{id}/follow/", { params: { path: { id } }, body })));
}

export async function dropTraining(id: number, note: string) {
  return dataOf(await call(() => api.POST("/api/trainings/{id}/drop/", { params: { path: { id } }, body: { note } })));
}

// --- Volunteering ---

export function fetchVolunteering(query: VolunteeringFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/volunteering/", { params: { query: { ...query, page } } }))),
  );
}

export async function createVolunteering(body: NewVolunteering) {
  return dataOf(await call(() => api.POST("/api/volunteering/", { body })));
}

export async function deleteVolunteering(id: number) {
  ensureOk(await call(() => api.DELETE("/api/volunteering/{id}/", { params: { path: { id } } })));
}

export async function validateVolunteering(id: number) {
  return dataOf(await call(() => api.POST("/api/volunteering/{id}/validate/", { params: { path: { id } } })));
}

export async function refuseVolunteering(id: number, note: string) {
  return dataOf(
    await call(() => api.POST("/api/volunteering/{id}/refuse/", { params: { path: { id } }, body: { note } })),
  );
}

/** The members the viewer heads without a validated volunteering in the month ("2026-10"; this month by default). */
export async function fetchMissingVolunteering(month?: string) {
  return dataOf(await call(() => api.GET("/api/volunteering/missing/", { params: { query: month ? { month } : {} } })));
}
