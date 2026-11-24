import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type BreachReport = Schemas["BreachReport"];
export type MemberWarning = Schemas["MemberWarning"];
export type Exclusion = Schemas["Exclusion"];
export type Ground = Schemas["DisciplineGroundEnum"];
export type SeriousGround = Schemas["SeriousGroundEnum"];
export type Target = Schemas["DisciplineTarget"];
export type NewWarning = Schemas["MemberWarningCreateRequest"];
export type WarningFilters = Omit<NonNullable<operations["discipline_warnings_list"]["parameters"]["query"]>, "page">;
export type ReportFilters = Omit<NonNullable<operations["discipline_reports_list"]["parameters"]["query"]>, "page">;

export const GROUNDS: Ground[] = ["work_not_done", "commitments", "communication", "team_rules", "other"];
export const SERIOUS_GROUNDS: SeriousGround[] = [
  "violence",
  "harassment",
  "threats",
  "sabotage",
  "theft",
  "endangering",
  "damage",
  "disclosure",
  "image",
];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

export async function fetchDisciplineRights() {
  return dataOf(await call(() => api.GET("/api/discipline/rights/")));
}

export async function fetchTargets() {
  return dataOf(await call(() => api.GET("/api/discipline/members/")));
}

export async function fetchStanding(memberId: number) {
  return dataOf(
    await call(() => api.GET("/api/discipline/standing/{member_id}/", { params: { path: { member_id: memberId } } })),
  );
}

// --- Reports ---

export function fetchReports(query: ReportFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/discipline/reports/", { params: { query: { ...query, page } } }))),
  );
}

export async function createReport(body: { member_id: number; ground: Ground; facts: string }) {
  return dataOf(await call(() => api.POST("/api/discipline/reports/", { body })));
}

export async function dismissReport(id: number, note: string) {
  return dataOf(
    await call(() => api.POST("/api/discipline/reports/{id}/dismiss/", { params: { path: { id } }, body: { note } })),
  );
}

// --- Warnings ---

export function fetchWarnings(query: WarningFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/discipline/warnings/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchWarning(id: number) {
  return dataOf(await call(() => api.GET("/api/discipline/warnings/{id}/", { params: { path: { id } } })));
}

export async function createWarning(body: NewWarning) {
  return dataOf(await call(() => api.POST("/api/discipline/warnings/", { body })));
}

export async function respondToWarning(id: number, response: string) {
  return dataOf(
    await call(() =>
      api.POST("/api/discipline/warnings/{id}/respond/", { params: { path: { id } }, body: { response } }),
    ),
  );
}

export async function recordCouncil(id: number, decision: string) {
  return dataOf(
    await call(() =>
      api.POST("/api/discipline/warnings/{id}/council/", { params: { path: { id } }, body: { decision } }),
    ),
  );
}

export async function cancelWarning(id: number, reason: string) {
  return dataOf(
    await call(() => api.POST("/api/discipline/warnings/{id}/cancel/", { params: { path: { id } }, body: { reason } })),
  );
}

// --- Exclusions ---

export function fetchExclusions() {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/discipline/exclusions/", { params: { query: { page } } }))),
  );
}

export async function proposeExclusion(body: { member_id: number; serious_ground: SeriousGround; facts: string }) {
  return dataOf(await call(() => api.POST("/api/discipline/exclusions/", { body })));
}

export async function confirmExclusion(id: number) {
  return dataOf(await call(() => api.POST("/api/discipline/exclusions/{id}/confirm/", { params: { path: { id } } })));
}

export async function abandonExclusion(id: number, note: string) {
  return dataOf(
    await call(() =>
      api.POST("/api/discipline/exclusions/{id}/abandon/", { params: { path: { id } }, body: { note } }),
    ),
  );
}
