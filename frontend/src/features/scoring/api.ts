/**
 * The confidential scoring workspace of the club admins (front guide §2.3, §14), under /api/scoring/.
 * Every value shown comes from the backend (guide §16.3): the screens never compute a score, a factor or a rank.
 *
 * Whoever is not a scoring admin gets 404 from every endpoint, as if the workspace did not exist (guide §17).
 */
import { api } from "@/lib/api/client";
import { ApiError, dataOf, send } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type Member = Schemas["MemberSummary"];
export type FormulaVersion = Schemas["FormulaVersion"];
export type FormulaVersionWrite = Schemas["FormulaVersionRequest"];
export type AuditEntry = Schemas["Audit"];
export type RunStatus = Schemas["RunStatusEnum"];
export type QualityDataStatus = Schemas["QualityDataStatusEnum"];

export const QUALITY_DATA_STATUSES: QualityDataStatus[] = [
  "incomplete",
  "complete",
  "requires_correction",
  "submitted",
];

/** The constants of a formula version (backend models/ranking.py FormulaVersion), grouped as on screen. */
export const FORMULA_GROUPS = {
  penalties: ["penalty_minor", "penalty_moderate", "penalty_major", "penalty_critical"],
  escalation: ["escalation_base", "penalty_round_cap", "revision_cap"],
  time: ["tf_early", "tf_on_time", "tf_late_25", "tf_late_50", "tf_late_over50", "tf_no_submit"],
  rubric: ["weight_effort", "weight_complexity", "weight_uncertainty", "weight_responsibility"],
} as const;
export type FormulaConstant = (typeof FORMULA_GROUPS)[keyof typeof FORMULA_GROUPS][number];
export const FORMULA_CONSTANTS = Object.values(FORMULA_GROUPS).flat() as FormulaConstant[];

/** The actions the backend writes to the scoring audit log (services: scoring, submissions, work_orders). */
export const AUDIT_ACTIONS = [
  "calculation_run",
  "calculation_failed",
  "published",
  "formula_created",
  "formula_set_current",
  "quality_input_changed",
  "budget_rubric_set",
] as const;
export const AUDIT_ENTITY_TYPES = ["calculation_run", "formula_version", "deliverable", "work_order"] as const;

// --- The answers the API types as plain objects (scoring_views.py, services/scoring.py) ---

/** A problem met by a calculation run, for one Deliverable (or the whole run when it failed). */
export type RunIssue = {
  deliverable?: number;
  code?: string;
  title?: string;
  level: "error" | "warning" | "info";
  message: string;
};

export type Run = Omit<Schemas["Run"], "issues" | "published_by" | "triggered_by"> & {
  issues?: RunIssue[];
  triggered_by: Member | null;
  published_by: Member | null;
};

/** What is missing or inconsistent before a calculation or a publication (services/scoring.validation_issues). */
export type ValidationIssue =
  | {
      kind: "quality_missing" | "quality_correction" | "quality_unconfirmed";
      deliverable: number;
      code: string | null;
      title: string;
      department: string;
    }
  | { kind: "weights"; work_order: number; code: string | null; title: string; total: string }
  | { kind: "no_cutoff"; season: number };

export type ScoringDashboard = {
  season: { id: number; label: string; scoring_cutoff_at: string | null };
  deliverables: number;
  validated: number;
  quality_complete: number;
  departments: number;
  members: number;
  issues: ValidationIssue[];
  latest_run: Run | null;
  published_run: Run | null;
  current_formula: string | null;
  recent: AuditEntry[];
};

/** A member's total in a run, ranked by the backend (1, 2, 2, 4). `total` is a decimal string. */
export type MemberRankingRow = { member_id: number; name: string; total: string; deliverables: number; rank: number };
export type DepartmentRankingRow = {
  department_id: number | null;
  name: string;
  total: string;
  member_count: number;
  rank: number;
};
export type RunRankings = { run: Run; members: MemberRankingRow[]; departments: DepartmentRankingRow[] };

/** One revision round of a score (services/formulas.revision_penalty). */
export type RevisionRound = {
  round: number;
  severity: string;
  attributable: boolean;
  escalation: string;
  penalty: string;
};

export type ScoreDeliverable = {
  id: number;
  code: string | null;
  title: string;
  work_order: { id: number; code: string | null; title: string };
};

export type ScoreSnapshot = Omit<Schemas["ScoreSnapshot"], "deliverable" | "revision_rounds"> & {
  deliverable: ScoreDeliverable;
  revision_rounds: RevisionRound[] | null;
};

/** A member's score traced to every Deliverable (guide §14.2): `total` is the backend's sum. */
export type MemberScores = { member_id: number; total: string; scores: ScoreSnapshot[]; earlier: ScoreSnapshot[] };

export type QualityRound = {
  number: number;
  complete: boolean;
  submitted_at: string | null;
  decision: string | null;
  severity: string | null;
  attributable: boolean | null;
};

/** A validated (or submitted) Deliverable's quality input (QualityInputViewSet.row). */
export type QualityInputRow = {
  deliverable: { id: number; code: string | null; title: string; status: string; acceptance_criteria: string };
  work_order: { id: number; code: string | null; title: string };
  department: { id: number; name: string };
  season: number;
  members: Member[];
  first_complete_submission_at: string | null;
  rounds: QualityRound[];
  raw_quality: string | null;
  data_status: QualityDataStatus;
  note: string;
  last_modified_at: string | null;
  entered_by: Member | null;
};

export type AuditFilters = {
  action?: string;
  entity_type?: string;
  entity_id?: string;
  actor?: string;
  search?: string;
};

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

/** Only the values given: "" and undefined are left out of the query string. */
function query(values: Record<string, string | number | null | undefined>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value != null && value !== ""));
}

/** A 404: not a scoring admin, or nothing there. Either way the screen shows a plain "page not found". */
export function isNotFound(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

// --- Dashboard and validation ---

export async function fetchScoringDashboard(season?: number | null) {
  return dataOf(
    await call(() => api.GET("/api/scoring/dashboard/", { params: { query: query({ season }) } as never })),
  ) as unknown as ScoringDashboard;
}

export async function fetchValidationIssues(season?: number | null) {
  return dataOf(
    await call(() => api.GET("/api/scoring/dashboard/validation/", { params: { query: query({ season }) } as never })),
  ) as unknown as ValidationIssue[];
}

// --- Calculation runs ---

export async function fetchRuns(season?: number | null) {
  return dataOf(
    await call(() => api.GET("/api/scoring/runs/", { params: { query: query({ season }) } as never })),
  ) as unknown as Run[];
}

export async function fetchRun(id: number) {
  return dataOf(await call(() => api.GET("/api/scoring/runs/{id}/", { params: { path: { id } } }))) as unknown as Run;
}

export async function startRun(body: { season: number; formula_version?: number; notes: string }) {
  return dataOf(await call(() => api.POST("/api/scoring/runs/", { body: body as never }))) as unknown as Run;
}

export async function publishRun(id: number, reason: string) {
  return dataOf(
    await call(() => api.POST("/api/scoring/runs/{id}/publish/", { params: { path: { id } }, body: { reason } })),
  ) as unknown as Run;
}

export async function fetchRunRankings(id: number, department?: number | null) {
  return dataOf(
    await call(() =>
      api.GET("/api/scoring/runs/{id}/rankings/", {
        params: { path: { id }, query: query({ department }) } as never,
      }),
    ),
  ) as unknown as RunRankings;
}

// --- Scores ---

export async function fetchMemberScores(member: number, run?: number | null) {
  return dataOf(
    await call(() =>
      api.GET("/api/scoring/scores/member/{member_id}/", {
        params: { path: { member_id: member }, query: query({ run }) } as never,
      }),
    ),
  ) as unknown as MemberScores;
}

// --- Formula versions ---

export async function fetchFormulaVersions() {
  return dataOf(await call(() => api.GET("/api/scoring/formula-versions/")));
}

export async function createFormulaVersion(body: FormulaVersionWrite) {
  return dataOf(await call(() => api.POST("/api/scoring/formula-versions/", { body })));
}

export async function setCurrentFormula(id: number, reason: string) {
  return dataOf(
    await call(() =>
      api.POST("/api/scoring/formula-versions/{id}/set-current/", { params: { path: { id } }, body: { reason } }),
    ),
  );
}

// --- Audit ---

export async function fetchAudit(filters: AuditFilters = {}) {
  return dataOf(await call(() => api.GET("/api/scoring/audit/", { params: { query: query(filters) } as never })));
}

// --- Quality inputs (the admins enter or correct the marks) ---

export async function fetchQualityInputs(season?: number | null) {
  return dataOf(
    await call(() => api.GET("/api/scoring/quality-inputs/", { params: { query: query({ season }) } as never })),
  ) as unknown as QualityInputRow[];
}

export type QualityWrite = {
  raw_quality: string | null;
  data_status: QualityDataStatus;
  note: string;
  reason: string;
};

/** Enters or corrects a validated Deliverable's quality mark (0–5, one decimal) and its data status. The backend
 * checks the mark and audits the change with its reason. */
export async function saveQualityInput(deliverable: number, body: QualityWrite) {
  return dataOf(
    await call(() => api.PUT("/api/scoring/quality-inputs/{id}/", { params: { path: { id: deliverable } }, body })),
  ) as unknown as QualityInputRow;
}
