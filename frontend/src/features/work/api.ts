import { api } from "@/lib/api/client";
import { dataOf, ensureOk, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type Project = Schemas["Project"];
export type ProjectDetail = Schemas["ProjectDetail"];
export type ProjectStatus = Schemas["ProjectStatusEnum"];
export type ProjectHealth = Schemas["ProjectHealthEnum"];
export type ProjectCategory = Schemas["CategoryEnum"];
export type Subsystem = Schemas["Subsystem"];
export type SubsystemStatus = Schemas["SubsystemStatusEnum"];
export type StepState = Schemas["StepState"];
export type LifecycleStep = Schemas["LifecycleStep"];
export type Task = Schemas["Task"];
export type TaskDetail = Schemas["TaskDetail"];
export type TaskComment = Schemas["TaskComment"];
export type TaskStatus = Schemas["TaskStatusEnum"];
export type TaskPriority = Schemas["PriorityEnum"];
export type TaskWrite = Schemas["TaskWriteRequest"];
export type TaskChange = Schemas["PatchedTaskWriteRequest"];
export type TaskPoints = Schemas["PointsEnum"];
export type TaskLinkType = Schemas["LinkTypeEnum"];
export type TaskEvent = Schemas["TaskEvent"];
export type TaskEventKind = Schemas["TaskEventKindEnum"];
export type Blocker = Schemas["Blocker"];
export type BlockerWrite = Schemas["BlockerWriteRequest"];
export type BlockerSeverity = Schemas["SeverityEnum"];
export type BlockerOrigin = Schemas["OriginEnum"];
export type BlockerStatus = Schemas["BlockerStatusEnum"];
export type Submission = Schemas["SubmitRequest"];
export type TaskHealth = Schemas["TaskHealthEnum"];
export type ProgressUpdate = Schemas["ProgressRequest"];
export type ProjectFilters = NonNullable<operations["projects_list"]["parameters"]["query"]>;
export type TaskFilters = NonNullable<operations["tasks_list"]["parameters"]["query"]>;

/** The lifecycle steps of a project's car: those of an IC project, or of an EV one; all of them for the
 * other projects (apps/subsystems/serializers.py steps_for, decision D-023). */
export function stepsFor(category: ProjectCategory | undefined, steps: LifecycleStep[]) {
  if (category === "ic") {
    return steps.filter((step) => step.applies_to_ic);
  }
  if (category === "ev") {
    return steps.filter((step) => step.applies_to_ev);
  }
  return steps;
}

/** The steps of a task, in order (decision D-012): its leaders validate what its people submit. */
export const TASK_STATUSES: TaskStatus[] = ["planned", "in_progress", "submitted", "needs_revision", "validated"];
/** 1 routine to 5 critical for the project (Ranking System §2.1). */
export const TASK_POINTS: TaskPoints[] = [1, 2, 3, 4, 5];
export const QUALITY_MARKS = [0, 1, 2, 3, 4, 5] as const;
export const LINK_TYPES: TaskLinkType[] = ["drive", "github", "cad", "report", "other"];
export const BLOCKER_SEVERITIES: BlockerSeverity[] = ["low", "medium", "high", "critical"];
export const BLOCKER_ORIGINS: BlockerOrigin[] = ["technical", "supplier", "financial", "organisation", "other"];
export const TASK_PRIORITIES: TaskPriority[] = ["high", "medium", "low"];
export const PROJECT_STATUSES: ProjectStatus[] = ["planned", "active", "on_hold", "completed"];
export const PROJECT_HEALTHS: ProjectHealth[] = ["on_track", "at_risk", "planning", "on_hold", "completed"];
export const SUBSYSTEM_STATUSES: SubsystemStatus[] = ["planned", "active", "blocked", "complete"];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

// --- Projects ---

export function fetchProjects(query: Omit<ProjectFilters, "page"> = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/projects/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchProject(id: number) {
  return dataOf(await call(() => api.GET("/api/projects/{id}/", { params: { path: { id } } })));
}

export async function updateProject(id: number, body: Schemas["PatchedProjectRequest"]) {
  return dataOf(await call(() => api.PATCH("/api/projects/{id}/", { params: { path: { id } }, body })));
}

export type ProjectCreate = Schemas["ProjectRequest"];
export const PROJECT_CATEGORIES: ProjectCategory[] = ["ic", "ev", "complementary_competition", "club_project"];

/** Whether the viewer creates projects: the Board and the Team Manager (decision D-025). */
export async function fetchProjectCreating() {
  return dataOf(await call(() => api.GET("/api/projects/creating/")));
}

/** Creates a project, with its manager (charter art. 2 and 6: named by the Board). */
export async function createProject(body: ProjectCreate) {
  return dataOf(await call(() => api.POST("/api/projects/", { body })));
}

// --- Subsystems and lifecycle ---

export function fetchSubsystems(project: number) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/subsystems/", { params: { query: { project, page } } }))),
  );
}

export async function fetchLifecycleSteps() {
  return dataOf(await call(() => api.GET("/api/lifecycle-steps/")));
}

export async function updateSubsystemStatus(id: number, status: SubsystemStatus) {
  return dataOf(await call(() => api.PATCH("/api/subsystems/{id}/", { params: { path: { id } }, body: { status } })));
}

export async function tickStep(subsystem: number, step: number, isComplete: boolean) {
  return dataOf(
    await call(() =>
      api.PATCH("/api/subsystems/{id}/steps/{step_id}/", {
        params: { path: { id: subsystem, step_id: step } },
        body: { is_complete: isComplete },
      }),
    ),
  );
}

// --- Tasks ---

export function fetchTasks(query: Omit<TaskFilters, "page"> = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/tasks/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchTask(id: number) {
  return dataOf(await call(() => api.GET("/api/tasks/{id}/", { params: { path: { id } } })));
}

export async function createTask(body: TaskWrite) {
  return dataOf(await call(() => api.POST("/api/tasks/", { body })));
}

export async function updateTask(id: number, body: TaskChange) {
  return dataOf(await call(() => api.PATCH("/api/tasks/{id}/", { params: { path: { id } }, body })));
}

export async function deleteTask(id: number) {
  ensureOk(await call(() => api.DELETE("/api/tasks/{id}/", { params: { path: { id } } })));
}

// --- The steps of a task (start, submit, validate or send back) and its blockers ---

/** Gives how far a task is, its current phase and its next step (the Figma's work order). */
export async function updateProgress(id: number, body: ProgressUpdate) {
  return dataOf(await call(() => api.POST("/api/tasks/{id}/progress/", { params: { path: { id } }, body })));
}

/** The task a reference names ("EV27-007"), or null when no task has it. */
export async function findTask(reference: string): Promise<Task | null> {
  const result = await call(() => api.GET("/api/tasks/find/", { params: { query: { reference } } }));
  if (result.response.status === 404) {
    return null;
  }
  return ensureOk(result).data ?? null;
}

export async function startTask(id: number) {
  return dataOf(await call(() => api.POST("/api/tasks/{id}/start/", { params: { path: { id } } })));
}

export async function submitTask(id: number, body: Submission) {
  return dataOf(await call(() => api.POST("/api/tasks/{id}/submit/", { params: { path: { id } }, body })));
}

export async function validateTask(id: number, qualityMark: number) {
  return dataOf(
    await call(() =>
      api.POST("/api/tasks/{id}/validate/", { params: { path: { id } }, body: { quality_mark: qualityMark } }),
    ),
  );
}

export async function reviseTask(id: number, comment: string) {
  return dataOf(await call(() => api.POST("/api/tasks/{id}/revise/", { params: { path: { id } }, body: { comment } })));
}

export async function addLink(task: number, body: Schemas["TaskLinkWriteRequest"]) {
  return dataOf(await call(() => api.POST("/api/tasks/{id}/links/", { params: { path: { id: task } }, body })));
}

export async function declareBlocker(task: number, body: BlockerWrite) {
  return dataOf(await call(() => api.POST("/api/tasks/{id}/blockers/", { params: { path: { id: task } }, body })));
}

export async function decideBlocker(task: number, blocker: number, accept: boolean, note = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/tasks/{id}/blockers/{blocker_id}/decide/", {
        params: { path: { id: task, blocker_id: blocker } },
        body: { accept, note },
      }),
    ),
  );
}

export async function resolveBlocker(task: number, blocker: number, resolution: string) {
  return dataOf(
    await call(() =>
      api.POST("/api/tasks/{id}/blockers/{blocker_id}/resolve/", {
        params: { path: { id: task, blocker_id: blocker } },
        body: { resolution },
      }),
    ),
  );
}

// --- Comments ---

export async function addComment(task: number, content: string) {
  return dataOf(
    await call(() => api.POST("/api/tasks/{id}/comments/", { params: { path: { id: task } }, body: { content } })),
  );
}

export async function deleteComment(task: number, comment: number) {
  ensureOk(
    await call(() =>
      api.DELETE("/api/tasks/{id}/comments/{comment_id}/", {
        params: { path: { id: task, comment_id: comment } },
      }),
    ),
  );
}
