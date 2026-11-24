// Fictional people and units for the tests (never real members' data).
import type { Me } from "@/features/auth/api";
import type { Attendance, Meeting, MeetingDetail } from "@/features/meetings/api";
import type { Member, Membership, OrgUnit } from "@/features/members/api";
import type { Notification } from "@/features/notifications/api";
import type { PurchaseOrder, PurchaseRequest, PurchaseRequestDetail, Supplier } from "@/features/purchasing/api";
import type { StockItemDetail, StockMovement } from "@/features/stock/api";
import type { Blocker, LifecycleStep, Project, StepState, Subsystem, Task, TaskDetail } from "@/features/work/api";

type Role = Membership["role"];

export function unit(id: number, name: string, overrides: Partial<OrgUnit> = {}): OrgUnit {
  return {
    id,
    code: null,
    name,
    type: "club_department",
    parent: null,
    description: "",
    is_temporary: false,
    is_active: true,
    ...overrides,
  };
}

export function role(id: number, name: string, overrides: Partial<Role> = {}): Role {
  return {
    id,
    name,
    role_type: "member",
    scope: "club",
    is_leadership: false,
    can_be_project_manager: false,
    ...overrides,
  };
}

let nextMembershipId = 1;

export function membership(orgUnit: OrgUnit, memberRole: Role, overrides: Partial<Membership> = {}): Membership {
  return {
    id: nextMembershipId++,
    org_unit: orgUnit,
    role: memberRole,
    member_level: "",
    start_date: "2025-10-01",
    end_date: null,
    is_primary: false,
    ...overrides,
  };
}

export function member(id: number, firstName: string, lastName: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    first_name: firstName,
    last_name: lastName,
    email: `${firstName}.${lastName}@example.invalid`.toLowerCase(),
    phone: null,
    facebook_url: null,
    skill: "",
    status: "active",
    join_date: "2025-10-01",
    race_number: null,
    alumni_profile: null,
    memberships: [],
    projects: [],
    ...overrides,
  };
}

export function me(overrides: Partial<Me> = {}): Me {
  return { ...member(1, "Lina", "Demo"), language: "", muted_email_topics: [], ...overrides };
}

const EV_PROJECT = { id: 1, name: "[DEMO] EV 2027", category: "ev" } as const;

export function project(id: number, name: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name,
    key: "",
    category: "ev",
    status: "active",
    description: "",
    start_date: "2026-09-02",
    end_date: "2027-06-14",
    org_unit: { id: 1, code: null, name: "Formula Student Team", type: "fs_team" },
    project_manager: { id: 1, first_name: "Lina", last_name: "Demo" },
    tasks_total: 0,
    tasks_done: 0,
    tasks_blocked: 0,
    tasks_overdue: 0,
    health: "on_track",
    subsystems_count: 0,
    permissions: { edit: true, create_task: true, estimate_tasks: true },
    ...overrides,
  };
}

export function task(id: number, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    reference: `EV27-${String(id).padStart(3, "0")}`,
    title,
    status: "planned",
    priority: null,
    points: null,
    start_date: null,
    due_date: null,
    is_overdue: false,
    is_blocked: false,
    scored: true,
    quality_mark: null,
    project: EV_PROJECT,
    subsystem: null,
    lifecycle_step: null,
    unit: { id: 1, code: null, name: "Formula Student Team", type: "fs_team" },
    parent_id: null,
    assignees: [],
    subtasks_total: 0,
    subtasks_done: 0,
    comments_count: 0,
    progress: 0,
    progress_mode: "manual",
    health: "on_track",
    current_phase: "",
    next_step: "",
    permissions: {
      edit: true,
      delete: true,
      comment: true,
      start: false,
      submit: false,
      validate: false,
      estimate: false,
      declare_blocker: true,
      update_progress: false,
    },
    ...overrides,
  };
}

export function taskDetail(id: number, title: string, overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    ...task(id, title),
    parent: null,
    description: "",
    deliverable: "",
    success_criteria: "",
    actual_deliverable: "",
    initial_due_date: null,
    started_at: null,
    submitted_at: null,
    validated_at: null,
    validated_by: null,
    created_by: { id: 1, first_name: "Lina", last_name: "Demo" },
    created_at: "2026-10-17T16:58:00Z",
    updated_at: "2026-10-17T16:58:00Z",
    subtasks: [],
    comments: [],
    links: [],
    blockers: [],
    events: [],
    ...overrides,
  };
}

export function blocker(id: number, description: string, overrides: Partial<Blocker> = {}): Blocker {
  return {
    id,
    description,
    origin: "technical",
    severity: "medium",
    dependency: "",
    required_action: "",
    responsible: null,
    responsible_unit: null,
    known_since: "2026-10-15",
    is_late: false,
    reported_by: { id: 2, first_name: "Rayan", last_name: "Demo" },
    reported_at: "2026-10-16T09:00:00Z",
    status: "open",
    decided_by: null,
    decided_at: null,
    decision_note: "",
    resolved_at: null,
    resolution: "",
    permissions: { decide: false, resolve: false },
    ...overrides,
  };
}

export function lifecycleStep(order: number, name: string, overrides: Partial<LifecycleStep> = {}): LifecycleStep {
  return {
    id: order,
    step_order: order,
    name,
    requires_validation: false,
    applies_to_ic: true,
    applies_to_ev: true,
    ...overrides,
  };
}

export function stepState(step: LifecycleStep, overrides: Partial<StepState> = {}): StepState {
  return {
    step,
    is_complete: false,
    completed_at: null,
    validated_by: null,
    notes: "",
    waiting_for: null,
    can_tick: true,
    ...overrides,
  };
}

export function subsystem(id: number, name: string, overrides: Partial<Subsystem> = {}): Subsystem {
  return {
    id,
    name,
    status: "active",
    project: EV_PROJECT,
    org_unit: { id: 2, code: null, name: "Electronics", type: "fs_department" },
    parent_id: null,
    members: [],
    steps: [],
    permissions: { edit: true, validate: false, estimate_tasks: false },
    ...overrides,
  };
}

/** A notification about a task of the demo project, an hour old, unread. */
export function notification(
  id: number,
  kind: Notification["kind"],
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id,
    kind,
    actor: { id: 2, first_name: "Rayan", last_name: "Demo" },
    message: "",
    data: { task: "Modéliser le pack", project: "[DEMO] EV 2027" },
    target: { type: "task", id: 7 },
    is_read: false,
    created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    ...overrides,
  };
}

const NO_RIGHTS = {
  edit: false,
  approve: false,
  cancel: false,
  order: false,
  manage_order: false,
  cancel_order: false,
  close_order: false,
};

/** A purchase request of Rayan Demo for the demo battery, awaiting its leader, with no rights. */
export function purchase(id: number, partName: string, overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id,
    part: {
      id: id + 100,
      name: partName,
      category: "engine_tractive",
      reference: "",
      description: "",
      material: "",
      process: "",
    },
    quantity: 4,
    priority: "high",
    requested_date: "2026-11-12",
    status: "a_valider_chef",
    requested_by: { id: 2, first_name: "Rayan", last_name: "Demo" },
    org_unit: { id: 2, code: null, name: "Electronics", type: "fs_department" },
    subsystem: { id: 2, name: "HV Battery & BMS" },
    project: EV_PROJECT,
    suggested_supplier: null,
    order: null,
    created_at: "2026-10-17T10:00:00Z",
    permissions: NO_RIGHTS,
    ...overrides,
  };
}

export function purchaseDetail(
  id: number,
  partName: string,
  overrides: Partial<PurchaseRequestDetail> = {},
): PurchaseRequestDetail {
  return {
    ...purchase(id, partName),
    notes: "",
    updated_at: "2026-10-17T10:00:00Z",
    events: [
      {
        id: 1,
        action: "requested",
        status: "a_valider_chef",
        actor: { id: 2, first_name: "Rayan", last_name: "Demo" },
        comment: "",
        quantity: null,
        created_at: "2026-10-17T10:00:00Z",
      },
    ],
    grouped_order: null,
    ...overrides,
  };
}

/** An order of 4 parts in euros at 250 DA: (4 × 10 + 5 + 2) € = 47 € = 11 750 DA. */
export function purchaseOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 50,
    status: "en_commande",
    supplier: { id: 9, name: "[DEMO] Atelier Laser Alger", type: "sous_traitant" },
    currency: "EUR",
    exchange_rate: "250.0000",
    unit_price: "10.00",
    delivery_cost: "5.00",
    customs_cost: "2.00",
    total_price: "47.00",
    total_price_dzd: "11750.00",
    ordered_at: "2026-10-18",
    estimated_delivery_date: "2026-10-30",
    actual_delivery_date: null,
    shipping_address: null,
    batch: null,
    quantity_received: 0,
    ...overrides,
  };
}

/** A fictitious supplier, contacts hidden (as most members see it). */
export function supplier(id: number, name: string, overrides: Partial<Supplier> = {}): Supplier {
  return {
    id,
    name,
    type: "sous_traitant",
    status: "validee",
    technical_capabilities: "Découpe laser, pliage",
    city: "Alger",
    country: "Algérie",
    address: null,
    contact_name: null,
    contact_role: null,
    email: null,
    phone: null,
    contacted_by: { id: 9, first_name: "Mehdi", last_name: "Demo" },
    average_lead_time_days: 7,
    comments: "",
    can_edit: false,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

const MEHDI = { id: 9, first_name: "Mehdi", last_name: "Demo" } as const;

/** A fictitious stock line: 20 M8 bolts in the workshop, threshold 5, with one entry. */
export function stockItem(id: number, partName: string, overrides: Partial<StockItemDetail> = {}): StockItemDetail {
  return {
    id,
    part: {
      id: id + 200,
      name: partName,
      category: "workshop",
      reference: "ISO 4017",
      description: "",
      material: "",
      process: "",
    },
    location: "Atelier — bac A3",
    quantity_available: 20,
    min_threshold: 5,
    is_low: false,
    last_moved_at: "2026-10-18T09:00:00Z",
    updated_at: "2026-10-18T09:00:00Z",
    movements: [stockMovement(1, { stock_item: { id, part: partName, location: "Atelier — bac A3" } })],
    ...overrides,
  };
}

/** A fictitious entry of 20, recorded by Mehdi Demo. */
export function stockMovement(id: number, overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id,
    stock_item: { id: 1, part: "Vis M8 × 30", location: "Atelier — bac A3" },
    movement_type: "in",
    quantity: 20,
    change: 20,
    moved_by: MEHDI,
    moved_at: "2026-10-18T09:00:00Z",
    handed_to: null,
    task: null,
    purchase_request_id: null,
    notes: "",
    created_at: "2026-10-18T09:00:00Z",
    ...overrides,
  };
}

const LINA_SUMMARY = { id: 1, first_name: "Lina", last_name: "Demo" };

export function meeting(id: number, title: string, overrides: Partial<Meeting> = {}): Meeting {
  return {
    id,
    title,
    kind: "department",
    org_unit: { id: 3, code: null, name: "Electronics", type: "fs_department" },
    starts_at: "2026-10-23T17:00:00Z",
    ends_at: "2026-10-23T18:30:00Z",
    location: "Salle B2",
    is_mandatory: false,
    is_critical: false,
    status: "planned",
    organiser: LINA_SUMMARY,
    attendance_confirmed_at: null,
    minutes_published_at: null,
    my_attendance: null,
    counts: { invited: 0, present: 0, late: 0, absent: 0, excused: 0 },
    permissions: { edit: false, run: false, check_in: false, ask_excuse: false },
    ...overrides,
  };
}

export function attendance(
  id: number,
  person: { id: number; first_name: string; last_name: string },
  overrides: Partial<Attendance> = {},
): Attendance {
  return {
    id,
    member: person,
    status: "pending",
    checked_in_at: null,
    marked_by: null,
    marked_at: null,
    excuse_status: "none",
    excuse_reason: "",
    excuse_note: "",
    excuse_requested_at: null,
    excuse_decided_by: null,
    excuse_decided_at: null,
    excuse_decision_note: "",
    ...overrides,
  };
}

export function meetingDetail(id: number, title: string, overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return {
    ...meeting(id, title),
    agenda: "",
    cancel_reason: "",
    minutes: "",
    created_by: LINA_SUMMARY,
    created_at: "2026-10-20T09:00:00Z",
    attendance_confirmed_by: null,
    attendances: [],
    decisions: [],
    actions: [],
    ...overrides,
  };
}
