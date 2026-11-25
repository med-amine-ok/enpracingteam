// Fictional Work Orders for the tests of this folder (never real data).
import type { WorkMe, WorkOrder, WorkOrderDetail } from "../api";

export function workMe(overrides: Partial<WorkMe> = {}): WorkMe {
  return {
    is_head: false,
    headed_department_ids: [],
    is_club_admin: false,
    current_season: { id: 3, year: 2027, label: "Saison 2027", is_active: true },
    ...overrides,
  };
}

/** A Work Order as an ordinary member receives it: no budget field at all. */
export function workOrder(id: number, title: string, overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id,
    code: `WO-${id}`,
    title,
    season: 3,
    department: { id: 10, code: "MEC", name: "Mécanique", type: "fs_department" },
    project: { id: 1, name: "[DEMO] EV 2027" },
    status: "active",
    priority: "",
    coordinator: null as unknown as WorkOrder["coordinator"],
    proposed_by: null as unknown as WorkOrder["proposed_by"],
    proposal_status: null,
    progress: 40,
    deliverable_count: 2,
    next_deadline: "2027-01-15",
    execution_state: "normal",
    created_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

const NO_RIGHTS: WorkOrderDetail["rights"] = {
  edit: false,
  decide: false,
  submit_proposal: false,
  plan: false,
  activate: false,
  cancel: false,
  propose_deliverable: false,
};

export function workOrderDetail(
  id: number,
  title: string,
  overrides: Partial<Omit<WorkOrderDetail, "rights">> & { rights?: Partial<WorkOrderDetail["rights"]> } = {},
): WorkOrderDetail {
  const { rights, ...rest } = overrides;
  return {
    ...workOrder(id, title),
    description: "",
    objectives: "",
    justification: "",
    estimated_effort_units: null,
    members: [],
    credit_plan: null,
    plan_problems: [],
    rubric: null,
    proposal_submitted_at: null,
    proposal_decided_at: null,
    proposal_decided_by: null as unknown as WorkOrderDetail["proposal_decided_by"],
    proposal_note: "",
    created_by: { id: 1, first_name: "Lina", last_name: "Demo" },
    updated_at: "2026-10-01T10:00:00Z",
    ...rest,
    rights: { ...NO_RIGHTS, ...rights },
  };
}
