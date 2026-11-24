import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

export type Notification = components["schemas"]["Notification"];
export type NotificationKind = components["schemas"]["NotificationKindEnum"];

/** What `data` holds, depending on the kind (apps/communication/notify.py in the backend). */
export type NotificationData = {
  task?: string;
  project?: string;
  subsystem?: string;
  project_id?: number;
  step?: string;
  excerpt?: string;
  due_date?: string;
  primary_id?: number | null;
  // Purchases (apps/communication/notify.py purchase_moved).
  part?: string;
  quantity?: number;
  requester?: string;
  level?: "leader" | "operations";
  action?:
    | "approved"
    | "refused"
    | "ordered"
    | "order_cancelled"
    | "received"
    | "partly_received"
    | "closed_short"
    | "cancelled";
  /** How many parts arrived so far (a partial delivery, an order closed with them: decision D-023). */
  received?: number;
  status?: string;
  reason?: string;
  supplier?: string;
  // Low stock (notify.stock_low): the line's place and threshold (its quantity is `quantity`).
  location?: string;
  threshold?: number;
  // Budget exceeded (notify.budget_exceeded): amounts in dinars, as text ("200000.00").
  unit?: string;
  fiscal_year?: string;
  allocated?: string;
  spent?: string;
  // The steps of a task and its blockers (notify.task_validated, blocker_declared, blocker_updated).
  quality_mark?: number;
  severity?: "low" | "medium" | "high" | "critical";
  // Sessions (notify.meeting_data and the like): its title, start, place, and what happened.
  meeting?: string;
  starts_at?: string;
  mandatory?: boolean;
  cancelled?: boolean;
  member?: string;
  accepted?: boolean;
  // Documents (notify.document_data): its title and the version's number; reviewed: approved or not.
  document?: string;
  version?: number;
  approved?: boolean;
  // The workshop (notify.loan_data, reservation_cancelled, certification_granted): the item's name; a loan's
  // borrower and return date (`due_date`); a cancelled slot, and whether the item became unavailable.
  equipment?: string;
  loan?: number;
  borrower?: string;
  reserved_from?: string;
  reserved_to?: string;
  unavailable?: boolean;
  // The monthly ranking (notify.contribution_data, ranking_published): the points, for whom, why; a month
  // ("2026-10"); decided: approved or not, with the reason of a refusal.
  points?: number;
  note?: string;
  month?: string;
  date?: string;
  // Warnings (notify.discipline_data): for whom, the ground; a warning's number; an exclusion's cause.
  ground?: string;
  number?: number;
  cause?: string;
  // Goals, trainings and volunteering (notify.objective_set, training_planned, volunteering_data): the goal's
  // title (its `due_date`), the training's topic (its session's `starts_at`), the activity's title and `date`;
  // decided: `approved`, with the `note` of a refusal; the reminder: its `month`.
  objective?: string;
  training?: string;
  volunteering?: string;
};

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

/** My 50 newest notifications (or only the unread ones). */
export async function fetchNotifications(unread = false) {
  const page = dataOf(
    await call(() => api.GET("/api/notifications/", { params: { query: unread ? { unread: true } : {} } })),
  );
  return page.results;
}

export async function fetchUnreadCount() {
  return dataOf(await call(() => api.GET("/api/notifications/unread-count/"))).count;
}

export async function markRead(id: number) {
  return dataOf(await call(() => api.POST("/api/notifications/{id}/read/", { params: { path: { id } } })));
}

export async function markAllRead() {
  return dataOf(await call(() => api.POST("/api/notifications/read-all/"))).count;
}
