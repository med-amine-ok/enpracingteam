/**
 * The calls of the work hub that the shared foundation (../api.ts) does not carry: a project's setup and the club
 * admins' quality inputs (front guide §13, under /api/scoring/quality-inputs/). The scoring endpoints answer 404 to
 * whoever may not see them (guide §17): the page then shows a plain "not found".
 */
import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";
import type { DeliverableStatus, Member, ProjectOverview, RevisionSeverity } from "../api";

type Schemas = components["schemas"];

export type QualityDataStatus = Schemas["QualityDataStatusEnum"];
export type QualityWrite = Schemas["QualityWriteRequest"];
export type QualityAudit = Schemas["Audit"];

export const QUALITY_DATA_STATUSES: QualityDataStatus[] = [
  "incomplete",
  "complete",
  "requires_correction",
  "submitted",
];

/** A submission round of the Deliverable, with the review's revision when one was asked. */
export type QualityRound = {
  number: number;
  complete: boolean;
  submitted_at: string | null;
  decision: string | null;
  severity: RevisionSeverity | null;
  attributable: boolean | null;
};

/** One row of GET /api/scoring/quality-inputs/ (scoring_views.QualityInputViewSet.row). */
export type QualityRow = {
  deliverable: {
    id: number;
    code: string | null;
    title: string;
    status: DeliverableStatus;
    acceptance_criteria: string;
  };
  work_order: { id: number; code: string | null; title: string };
  department: { id: number; name: string };
  season: number;
  members: Member[];
  first_complete_submission_at: string | null;
  rounds: QualityRound[];
  /** A decimal as text ("4.5"), or null when no mark was entered. */
  raw_quality: string | null;
  data_status: QualityDataStatus;
  note: string;
  last_modified_at: string | null;
  entered_by: Member | null;
};

export type QualityFilters = { season?: number; department?: number; data_status?: string };

function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

export async function fetchQualityInputs(query: QualityFilters = {}) {
  return dataOf(
    await call(() => api.GET("/api/scoring/quality-inputs/", { params: { query } as never })),
  ) as unknown as QualityRow[];
}

export async function saveQualityInput(deliverable: number, body: QualityWrite) {
  return dataOf(
    await call(() => api.PUT("/api/scoring/quality-inputs/{id}/", { params: { path: { id: deliverable } }, body })),
  ) as unknown as QualityRow;
}

export async function fetchQualityHistory(deliverable: number) {
  return dataOf(
    await call(() => api.GET("/api/scoring/quality-inputs/{id}/history/", { params: { path: { id: deliverable } } })),
  );
}

/** The project's season and its participating departments (club admins, the project's manager). */
export async function setupProject(project: number, body: { season: number | null; departments: number[] }) {
  return dataOf(
    await call(() =>
      api.POST("/api/work/projects/{id}/setup/", { params: { path: { id: project } }, body: body as never }),
    ),
  ) as unknown as ProjectOverview;
}
