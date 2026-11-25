/**
 * The work module (documentation/documentation_Tasks): Work Orders → Deliverables → Milestones, dependencies,
 * blockers, submissions and reviews, under /api/work/. The backend decides every status, progress aggregate and
 * deadline; the screens only show them and send the actions (front guide §16.3).
 *
 * Confidentiality (guide §2.1): budgets, weights and allocated points come only to a viewer who may see them
 * (the Heads, the scoring admins): for anybody else the fields are absent, so always read them as optional.
 */
import { api } from "@/lib/api/client";
import { dataOf, ensureOk, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type Season = Schemas["Season"];
export type WorkOrder = Schemas["WorkOrder"];
export type WorkOrderDetail = Schemas["WorkOrderDetail"];
export type WorkOrderWrite = Schemas["WorkOrderWriteRequest"];
export type WorkOrderChange = Schemas["PatchedWorkOrderUpdateRequest"];
export type WorkOrderStatus = Schemas["WorkOrderStatusEnum"];
export type ProposalStatus = Schemas["WorkProposalStatusEnum"];
export type Deliverable = Schemas["Deliverable"];
export type DeliverableDetail = Schemas["DeliverableDetail"];
export type DeliverableWrite = Schemas["DeliverableWriteRequest"];
export type DeliverableChange = Schemas["PatchedDeliverableWriteRequest"];
export type DeliverableStatus = Schemas["DeliverableStatusEnum"];
export type DependencyState = Schemas["DependencyStateEnum"];
export type ExecutionState = Schemas["ExecutionStateEnum"];
export type Milestone = Schemas["Milestone"];
export type MilestoneHistory = Schemas["MilestoneHistory"];
export type Assignment = Schemas["Assignment"];
export type AssignmentRole = Schemas["AssignmentRoleEnum"];
export type Submission = Schemas["Submission"];
export type SubmitBody = Schemas["WorkSubmitRequest"];
export type Evidence = Schemas["EvidenceRequest"];
export type EvidenceType = Schemas["EvidenceLinkTypeEnum"];
export type ReviewBody = Schemas["ReviewWriteRequest"];
export type RevisionSeverity = Schemas["RevisionSeverityEnum"];
export type DependencyLink = Schemas["DependencyLink"];
export type DependencyBody = Schemas["DependencyCreateRequest"];
export type DependencyType = Schemas["DependencyTypeEnum"];
export type ReleaseCondition = Schemas["ReleaseConditionEnum"];
export type DependencyProposal = Schemas["DependencyProposal"];
export type ReliefInterval = Schemas["ReliefInterval"];
export type ReliefClaim = Schemas["ReliefIntervalRequest"];
export type ReliefDecision = Schemas["ReliefDecisionRequest"];
export type ReliefStatus = Schemas["ReliefStatusEnum"];
export type Blocker = Schemas["WorkBlocker"];
export type BlockerWrite = Schemas["WorkBlockerWriteRequest"];
export type BlockerChange = Schemas["PatchedWorkBlockerUpdateRequest"];
export type BlockerStatus = Schemas["WorkBlockerStatusEnum"];
export type BlockerSeverity = Schemas["SeverityEnum"];
export type BlockerOrigin = Schemas["WorkBlockerOriginEnum"];
export type BlockerImpact = Schemas["BlockerImpactEnum"];
export type Activity = Schemas["Activity"];
export type WorkAction = Schemas["WorkActionEnum"];
export type Priority = Schemas["PriorityEnum"];
export type Member = Schemas["MemberSummary"];
export type Unit = Schemas["OrgUnitSummary"];
export type WorkOrderFilters = NonNullable<operations["work_work_orders_list"]["parameters"]["query"]>;
export type DeliverableFilters = NonNullable<operations["work_deliverables_list"]["parameters"]["query"]>;

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  "draft",
  "planning",
  "active",
  "in_progress",
  "completed",
  "cancelled",
];
export const DELIVERABLE_STATUSES: DeliverableStatus[] = [
  "draft",
  "ready",
  "in_progress",
  "submitted",
  "revision_requested",
  "validated",
  "cancelled",
];
export const DEPENDENCY_STATES: DependencyState[] = ["no_blocking_dependencies", "waiting", "released"];
export const EXECUTION_STATES: ExecutionState[] = ["normal", "partially_blocked", "fully_blocked"];
export const DEPENDENCY_TYPES: DependencyType[] = ["blocks", "follows", "relates_to", "duplicates"];
export const RELEASE_CONDITIONS: ReleaseCondition[] = ["validated", "submitted", "milestone_completed"];
export const BLOCKER_SEVERITIES: BlockerSeverity[] = ["low", "medium", "high", "critical"];
export const BLOCKER_ORIGINS: BlockerOrigin[] = [
  "technical",
  "resource",
  "external",
  "dependency",
  "decision",
  "other",
];
export const BLOCKER_IMPACTS: BlockerImpact[] = ["none", "partial", "full"];
export const REVISION_SEVERITIES: RevisionSeverity[] = ["minor", "moderate", "major", "critical"];
export const EVIDENCE_TYPES: EvidenceType[] = ["drive", "github", "cad", "report", "other"];
export const PRIORITIES: Priority[] = ["high", "medium", "low"];
export const BUDGET_TIERS = [1, 2, 3, 4, 5] as const;

// --- The answers the API types as plain objects (aggregates) ---

/** What the viewer may do (GET /api/work/me/). `scoring` is absent for whoever has no scoring access. */
export type WorkMe = {
  is_head: boolean;
  headed_department_ids: number[] | null;
  is_club_admin: boolean;
  scoring?: { admin: boolean; config: boolean; publish: boolean };
  current_season: Season | null;
};

export type DepartmentProgress = Unit & { progress: number | null };
export type ProjectProgress = {
  id: number;
  name: string;
  status: string;
  season: number | null;
  progress: number | null;
  departments: DepartmentProgress[];
};
export type ProjectOverview = ProjectProgress & { work_orders: WorkOrder[]; can_manage: boolean };
export type SeasonOverview = { season: Season; progress: number | null; projects: ProjectProgress[] };

export type Workload = { member_id: number; name: string; open_deliverables: number };
export type WorkDashboard = {
  member: {
    cards: {
      active: number;
      due_soon: number;
      overdue: number;
      waiting: number;
      revision_requested: number;
      blockers: number;
      validated: number;
    };
    deliverables: Deliverable[];
    recent: Activity[];
  };
  head: null | {
    cards: {
      active_work_orders: number;
      active_deliverables: number;
      wo_proposals: number;
      deliverable_proposals: number;
      to_review: number;
      open_blockers: number;
      relief_claims: number;
      attention: number;
    };
    to_review: Deliverable[];
    attention: Deliverable[];
    workload: Workload[];
    high_blockers: Blocker[];
  };
};

type ProposalGroups = { work_orders: WorkOrder[]; deliverables: Deliverable[]; dependencies: DependencyProposal[] };
export type Proposals = { to_decide: ProposalGroups; mine: ProposalGroups };

export type OperationalReport = {
  work_orders_by_status: Partial<Record<WorkOrderStatus, number>>;
  deliverables_by_status: Partial<Record<DeliverableStatus, number>>;
  departments: (DepartmentProgress & { work_orders: number })[];
  work_orders: {
    id: number;
    code: string | null;
    title: string;
    status: WorkOrderStatus;
    department: string;
    progress: number | null;
    budget_tier?: number | null;
  }[];
  overdue: Deliverable[];
  waiting: number;
  workload: Workload[];
};

export type SearchResults = {
  work_orders: { id: number; code: string | null; title: string; status: WorkOrderStatus }[];
  deliverables: { id: number; code: string | null; title: string; status: DeliverableStatus }[];
  milestones: { id: number; title: string; deliverable: number; is_completed: boolean }[];
  blockers: {
    id: number;
    description: string;
    status: BlockerStatus;
    deliverable: number | null;
    work_order: number | null;
  }[];
};

export type ProgressEntry = {
  id: number;
  progress: number;
  note: string;
  recorded_at: string;
  recorded_by: string | null;
};

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

const id = (value: number) => ({ params: { path: { id: value } } });

// --- Viewer, seasons, projects ---

export async function fetchWorkMe() {
  return dataOf(await call(() => api.GET("/api/work/me/"))) as unknown as WorkMe;
}

export async function fetchSeasons() {
  return dataOf(await call(() => api.GET("/api/work/seasons/")));
}

export async function fetchSeasonOverview(season: number) {
  return dataOf(await call(() => api.GET("/api/work/seasons/{id}/overview/", id(season)))) as unknown as SeasonOverview;
}

export async function fetchWorkProjects(season?: number) {
  const query = season ? { season } : {};
  return dataOf(
    await call(() => api.GET("/api/work/projects/", { params: { query } as never })),
  ) as unknown as ProjectProgress[];
}

export async function fetchProjectOverview(project: number) {
  return dataOf(await call(() => api.GET("/api/work/projects/{id}/", id(project)))) as unknown as ProjectOverview;
}

// --- Work Orders ---

export function fetchWorkOrders(query: Omit<WorkOrderFilters, "page"> = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/work/work-orders/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchWorkOrder(workOrder: number) {
  return dataOf(await call(() => api.GET("/api/work/work-orders/{id}/", id(workOrder))));
}

/** A Head of the department creates an official Work Order; anybody else's is a proposal (`asProposal` forces
 * it). `submit: false` keeps a proposal as a draft. */
export async function createWorkOrder(body: WorkOrderWrite, asProposal = false) {
  return dataOf(
    await call(() =>
      api.POST("/api/work/work-orders/", { body, params: { query: asProposal ? { proposal: "1" } : {} } as never }),
    ),
  );
}

export async function updateWorkOrder(workOrder: number, body: WorkOrderChange) {
  return dataOf(await call(() => api.PATCH("/api/work/work-orders/{id}/", { ...id(workOrder), body })));
}

type WorkOrderAction = "submit-proposal" | "approve" | "reject" | "to-planning" | "activate" | "cancel";

/** approve/reject take a `note`; cancel takes a `reason`. */
export async function workOrderAction(workOrder: number, action: WorkOrderAction, text = "") {
  const path = `/api/work/work-orders/{id}/${action}/` as "/api/work/work-orders/{id}/approve/";
  const body = action === "cancel" ? { reason: text } : { note: text };
  return dataOf(await call(() => api.POST(path, { ...id(workOrder), body: body as never })));
}

export async function setRubric(
  workOrder: number,
  body: { effort: number; complexity: number; uncertainty: number; responsibility: number },
) {
  return dataOf(await call(() => api.POST("/api/work/work-orders/{id}/rubric/", { ...id(workOrder), body })));
}

/** The official weights by Deliverable id ("40.000"); once active, they total 100 % and need a reason. */
export async function setWeights(workOrder: number, weights: Record<string, string>, reason = "") {
  return dataOf(
    await call(() => api.POST("/api/work/work-orders/{id}/weights/", { ...id(workOrder), body: { weights, reason } })),
  );
}

export async function fetchWorkOrderActivity(workOrder: number) {
  return dataOf(await call(() => api.GET("/api/work/work-orders/{id}/activity/", id(workOrder)))).results;
}

export async function fetchWorkOrderDependencies(workOrder: number) {
  return dataOf(await call(() => api.GET("/api/work/work-orders/{id}/dependencies/", id(workOrder))));
}

// --- Deliverables ---

export function fetchDeliverables(query: Omit<DeliverableFilters, "page"> = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/work/deliverables/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchDeliverable(deliverable: number) {
  return dataOf(await call(() => api.GET("/api/work/deliverables/{id}/", id(deliverable))));
}

/** A Head of the Work Order's department creates an official Deliverable; anybody else's is a proposal. */
export async function createDeliverable(body: DeliverableWrite & { work_order: number }, asProposal = false) {
  return dataOf(
    await call(() =>
      api.POST("/api/work/deliverables/", {
        body: body as DeliverableWrite,
        params: { query: asProposal ? { proposal: "1" } : {} } as never,
      }),
    ),
  );
}

export async function updateDeliverable(deliverable: number, body: DeliverableChange) {
  return dataOf(await call(() => api.PATCH("/api/work/deliverables/{id}/", { ...id(deliverable), body })));
}

type DeliverableAction = "submit-proposal" | "reject" | "mark-ready" | "start" | "cancel" | "reopen";

/** reject takes a `note`; cancel and reopen a `reason`. */
export async function deliverableAction(deliverable: number, action: DeliverableAction, text = "") {
  const path = `/api/work/deliverables/{id}/${action}/` as "/api/work/deliverables/{id}/cancel/";
  const body = action === "reject" ? { note: text } : { reason: text };
  return dataOf(await call(() => api.POST(path, { ...id(deliverable), body: body as never })));
}

/** Approving a proposal sets its official criteria, dates, weight and members (spec §4.2). */
export async function approveDeliverable(deliverable: number, body: DeliverableChange) {
  return dataOf(
    await call(() => api.POST("/api/work/deliverables/{id}/approve/", { ...id(deliverable), body: body as never })),
  );
}

export async function updateDeliverableProgress(deliverable: number, progress: number, note = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/work/deliverables/{id}/progress/", { ...id(deliverable), body: { progress, note } }),
    ),
  );
}

export async function fetchProgressLog(deliverable: number) {
  return dataOf(
    await call(() => api.GET("/api/work/deliverables/{id}/progress-log/", id(deliverable))),
  ) as unknown as ProgressEntry[];
}

export async function assignMember(deliverable: number, member: number, role: AssignmentRole = "member") {
  return dataOf(
    await call(() =>
      api.POST("/api/work/deliverables/{id}/assign/", { ...id(deliverable), body: { member, role, reason: "" } }),
    ),
  );
}

export async function unassign(assignment: number, reason = "") {
  ensureOk(await call(() => api.POST("/api/work/assignments/{id}/unassign/", { ...id(assignment), body: { reason } })));
}

export async function setAssignmentRole(assignment: number, role: AssignmentRole) {
  ensureOk(await call(() => api.POST("/api/work/assignments/{id}/role/", { ...id(assignment), body: { role } })));
}

export async function submitDeliverable(deliverable: number, body: SubmitBody) {
  return dataOf(await call(() => api.POST("/api/work/deliverables/{id}/submit/", { ...id(deliverable), body })));
}

export async function reviewSubmission(submission: number, body: ReviewBody) {
  ensureOk(await call(() => api.POST("/api/work/submissions/{id}/review/", { ...id(submission), body })));
}

export async function fetchDeliverableActivity(deliverable: number) {
  return dataOf(await call(() => api.GET("/api/work/deliverables/{id}/activity/", id(deliverable)))).results;
}

// --- Milestones ---

export async function createMilestone(deliverable: number, title: string, description = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/work/deliverables/{id}/milestones/", { ...id(deliverable), body: { title, description } }),
    ),
  );
}

export async function updateMilestone(milestone: number, body: { title?: string; description?: string }) {
  return dataOf(await call(() => api.PATCH("/api/work/milestones/{id}/", { ...id(milestone), body: body as never })));
}

export async function completeMilestone(milestone: number, isCompleted: boolean, note = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/work/milestones/{id}/complete/", { ...id(milestone), body: { is_completed: isCompleted, note } }),
    ),
  );
}

export async function cancelMilestone(milestone: number, reason: string) {
  return dataOf(
    await call(() => api.POST("/api/work/milestones/{id}/cancel/", { ...id(milestone), body: { reason } })),
  );
}

export async function deleteMilestone(milestone: number) {
  ensureOk(await call(() => api.DELETE("/api/work/milestones/{id}/", id(milestone))));
}

export async function fetchMilestoneHistory(milestone: number) {
  return dataOf(await call(() => api.GET("/api/work/milestones/{id}/history/", id(milestone))));
}

// --- Dependencies and relief ---

export function fetchDependencies(
  query: NonNullable<operations["work_dependencies_list"]["parameters"]["query"]> = {},
) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/work/dependencies/", { params: { query: { ...query, page } } }))),
  );
}

/** A Head of an involved department creates the link (members propose instead: proposeDependency). */
export async function createDependency(body: DependencyBody) {
  return dataOf(await call(() => api.POST("/api/work/dependencies/", { body })));
}

export async function cancelDependency(link: number, reason: string) {
  return dataOf(await call(() => api.POST("/api/work/dependencies/{id}/cancel/", { ...id(link), body: { reason } })));
}

/** Permanent: never revoked (spec §10, rule 6). */
export async function manualRelease(link: number, reason: string) {
  return dataOf(
    await call(() => api.POST("/api/work/dependencies/{id}/manual-release/", { ...id(link), body: { reason } })),
  );
}

export function fetchDependencyProposals(status?: string) {
  return fetchAllPages(async (page) =>
    dataOf(
      await call(() =>
        api.GET("/api/work/dependency-proposals/", { params: { query: { page, ...(status ? { status } : {}) } } }),
      ),
    ),
  );
}

export async function proposeDependency(body: DependencyBody) {
  return dataOf(await call(() => api.POST("/api/work/dependency-proposals/", { body })));
}

export async function decideDependencyProposal(proposal: number, approve: boolean, note = "") {
  const path = approve
    ? ("/api/work/dependency-proposals/{id}/approve/" as const)
    : ("/api/work/dependency-proposals/{id}/reject/" as const);
  return dataOf(await call(() => api.POST(path, { ...id(proposal), body: { note } })));
}

export async function claimRelief(deliverable: number, body: ReliefClaim) {
  return dataOf(await call(() => api.POST("/api/work/deliverables/{id}/relief/", { ...id(deliverable), body })));
}

export async function decideRelief(interval: number, body: ReliefDecision) {
  return dataOf(await call(() => api.POST("/api/work/relief/{id}/decide/", { ...id(interval), body })));
}

// --- Blockers ---

export function fetchBlockers(query: NonNullable<operations["work_blockers_list"]["parameters"]["query"]> = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/work/blockers/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchBlocker(blocker: number) {
  return dataOf(await call(() => api.GET("/api/work/blockers/{id}/", id(blocker))));
}

export async function reportBlocker(body: BlockerWrite) {
  return dataOf(await call(() => api.POST("/api/work/blockers/", { body })));
}

export async function updateBlocker(blocker: number, body: BlockerChange) {
  return dataOf(await call(() => api.PATCH("/api/work/blockers/{id}/", { ...id(blocker), body })));
}

export async function resolveBlocker(blocker: number, note: string) {
  return dataOf(await call(() => api.POST("/api/work/blockers/{id}/resolve/", { ...id(blocker), body: { note } })));
}

export async function cancelBlocker(blocker: number, reason: string) {
  return dataOf(await call(() => api.POST("/api/work/blockers/{id}/cancel/", { ...id(blocker), body: { reason } })));
}

export async function validateBlockerImpact(blocker: number, impactConfirmed: boolean, impactNote = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/work/blockers/{id}/validate-impact/", {
        ...id(blocker),
        body: { impact_confirmed: impactConfirmed, impact_note: impactNote },
      }),
    ),
  );
}

// --- Inbox, dashboard, reports, search ---

export async function fetchProposals() {
  return dataOf(await call(() => api.GET("/api/work/proposals/"))) as unknown as Proposals;
}

export async function fetchWorkDashboard(department?: number) {
  const query = department ? { department } : {};
  return dataOf(
    await call(() => api.GET("/api/work/dashboard/", { params: { query } as never })),
  ) as unknown as WorkDashboard;
}

export async function fetchOperationalReport(query: { season?: number; department?: number; project?: number } = {}) {
  return dataOf(
    await call(() => api.GET("/api/work/reports/", { params: { query } as never })),
  ) as unknown as OperationalReport;
}

export async function searchWork(q: string) {
  return dataOf(
    await call(() => api.GET("/api/work/search/", { params: { query: { q } } as never })),
  ) as unknown as SearchResults;
}
