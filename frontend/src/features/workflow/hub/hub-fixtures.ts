// Test data of the work hub's tests (not imported by the app).
import type { Blocker, Deliverable, DependencyLink, WorkDashboard, WorkMe } from "../api";

export const LINA = { id: 1, first_name: "Lina", last_name: "Demo" };
export const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const UNIT = { id: 10, code: "PT", name: "Powertrain", type: "fs_department" as const };

export function workMe(overrides: Partial<WorkMe> = {}): WorkMe {
  return {
    is_head: false,
    headed_department_ids: [],
    is_club_admin: false,
    current_season: { id: 3, year: 2026, label: "2026-2027", code: "S26" },
    ...overrides,
  };
}

export function deliverable(id: number, title: string, overrides: Partial<Deliverable> = {}): Deliverable {
  return {
    id,
    code: `D-${id}`,
    title,
    work_order: {
      id: 50,
      code: "WO-50",
      title: "Pack batterie",
      status: "active",
      department: UNIT,
      project: { id: 4, name: "Monoplace 2027" },
      season: 3,
    },
    status: "in_progress",
    dep_state: "no_blocking_dependencies",
    execution_state: "normal",
    progress: 40,
    original_deadline: "2099-01-10",
    effective_deadline: "2099-01-10",
    assignees: [LINA],
    proposal_status: null,
    proposed_by: LINA,
    allocated_points: null,
    created_at: "2026-10-01T08:00:00Z",
    ...overrides,
  };
}

export function dashboard(head: WorkDashboard["head"] = null): WorkDashboard {
  return {
    member: {
      cards: { active: 2, due_soon: 1, overdue: 0, waiting: 1, revision_requested: 0, blockers: 1, validated: 3 },
      deliverables: [deliverable(1, "Modéliser le boîtier"), deliverable(2, "Câbler le BMS")],
      recent: [
        {
          id: 9,
          entity_type: "deliverable",
          entity_id: 1,
          deliverable: 1,
          work_order: 50,
          action: "progress_updated",
          actor: RAYAN,
          occurred_at: "2026-11-20T10:00:00Z",
        },
      ],
    },
    head,
  };
}

export function headPart(): NonNullable<WorkDashboard["head"]> {
  return {
    cards: {
      active_work_orders: 3,
      active_deliverables: 8,
      wo_proposals: 1,
      deliverable_proposals: 2,
      to_review: 1,
      open_blockers: 2,
      relief_claims: 0,
      attention: 1,
    },
    to_review: [deliverable(7, "Valider le schéma HV", { status: "submitted" })],
    attention: [],
    workload: [{ member_id: 1, name: "Lina Demo", open_deliverables: 2 }],
    high_blockers: [],
  };
}

const end = (id: number, title: string) => ({
  id,
  code: `D-${id}`,
  title,
  status: "in_progress" as const,
  work_order: { id: 50, code: "WO-50", department: 10 },
});

export function link(id: number, overrides: Partial<DependencyLink> = {}): DependencyLink {
  return {
    id,
    prerequisite: end(1, "Modéliser le boîtier"),
    dependent: end(2, "Câbler le BMS"),
    link_type: "blocks",
    release_condition: "validated",
    release_milestone: null,
    link_status: "active",
    state: "waiting",
    released_at: null,
    manually_released: false,
    manual_release_by: null as never,
    created_by: RAYAN,
    approved_by: null as never,
    created_at: "2026-11-01T08:00:00Z",
    rights: { cancel: true, manual_release: true },
    ...overrides,
  };
}

export function blocker(id: number, overrides: Partial<Blocker> = {}): Blocker {
  return {
    id,
    deliverable: 1,
    work_order: null,
    target: { kind: "deliverable", id: 1, code: "D-1", title: "Modéliser le boîtier" },
    origin: "technical",
    severity: "high",
    impact: "partial",
    description: "Le fournisseur n’a pas livré les cellules.",
    required_action: "Relancer le fournisseur",
    responsible_unit: null as never,
    resolver: LINA,
    status: "open",
    resolution_note: "",
    reported_by: RAYAN,
    reported_at: "2026-11-10T08:00:00Z",
    resolved_by: null as never,
    updated_at: "2026-11-10T08:00:00Z",
    validation: null,
    rights: { edit: false, resolve: true, cancel: false, validate_impact: false },
    ...overrides,
  };
}
