import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type MyRanking = Schemas["MyRanking"];
export type Score = Schemas["Score"];
export type ScoreDetails = Schemas["ScoreDetails"];
export type Criterion = Schemas["Criterion"];
export type History = Schemas["History"];
export type MonthTable = Schemas["MonthTable"];
export type MonthRow = Schemas["MonthRow"];
export type MemberMonth = Schemas["MemberMonth"];
export type Assessment = Schemas["Assessment"];
export type AssessmentWrite = Schemas["AssessmentWriteRequest"];
export type Contribution = Schemas["Contribution"];
export type ContributionStatus = Schemas["ContributionStatusEnum"];
export type RankingCategory = Schemas["RankingCategoryEnum"];
export type ContributionFilters = Omit<NonNullable<operations["contributions_list"]["parameters"]["query"]>, "page">;

/** The four parts of the monthly score and their weights (Ranking System §1). */
export const PARTS = [
  { key: "delivery", weight: 55 },
  { key: "presence", weight: 15 },
  { key: "reliability", weight: 15 },
  { key: "team", weight: 15 },
] as const;
export type PartKey = (typeof PARTS)[number]["key"];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

export async function fetchRankingRights() {
  return dataOf(await call(() => api.GET("/api/ranking/rights/")));
}

export async function fetchMyRanking(month?: string) {
  return dataOf(await call(() => api.GET("/api/ranking/me/", { params: { query: month ? { month } : {} } })));
}

export async function fetchMonthTable(month: string) {
  return dataOf(await call(() => api.GET("/api/ranking/months/{month}/", { params: { path: { month } } })));
}

export async function publishMonth(month: string) {
  return dataOf(await call(() => api.POST("/api/ranking/months/{month}/publish/", { params: { path: { month } } })));
}

export async function fetchMemberMonth(memberId: number, month: string) {
  return dataOf(
    await call(() =>
      api.GET("/api/ranking/members/{member_id}/", { params: { path: { member_id: memberId }, query: { month } } }),
    ),
  );
}

export async function saveAssessment(memberId: number, body: AssessmentWrite) {
  return dataOf(
    await call(() =>
      api.PUT("/api/ranking/members/{member_id}/assessment/", { params: { path: { member_id: memberId } }, body }),
    ),
  );
}

export function fetchContributions(query: ContributionFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/contributions/", { params: { query: { ...query, page } } }))),
  );
}

export async function createContribution(body: {
  member_id: number;
  points: number;
  description: string;
  occurred_on: string;
}) {
  return dataOf(await call(() => api.POST("/api/contributions/", { body })));
}

export async function validateContribution(id: number) {
  return dataOf(await call(() => api.POST("/api/contributions/{id}/validate/", { params: { path: { id } } })));
}

export async function rejectContribution(id: number, note: string) {
  return dataOf(
    await call(() => api.POST("/api/contributions/{id}/reject/", { params: { path: { id } }, body: { note } })),
  );
}
