import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type Equipment = Schemas["Equipment"];
export type EquipmentDetail = Schemas["EquipmentDetail"];
export type EquipmentCategory = Schemas["EquipmentCategoryEnum"];
export type EquipmentStatus = Schemas["EquipmentStatusEnum"];
export type SettableStatus = Schemas["SettableEquipmentStatusEnum"];
export type EquipmentWrite = Schemas["EquipmentWriteRequest"];
export type Reservation = Schemas["Reservation"];
export type Loan = Schemas["Loan"];
export type LoanStatus = Schemas["LoanStatusEnum"];
export type ReturnCondition = Schemas["ReturnConditionEnum"];
export type Certification = Schemas["Certification"];
export type Maintenance = Schemas["Maintenance"];
export type MaintenanceWrite = Schemas["MaintenanceCreateRequest"];
export type EquipmentFilters = Omit<NonNullable<operations["equipment_list"]["parameters"]["query"]>, "page">;
export type LoanFilters = Omit<NonNullable<operations["equipment_loans_list"]["parameters"]["query"]>, "page">;
export type ReservationWhen = "upcoming" | "past";

export const CATEGORIES: EquipmentCategory[] = [
  "machine",
  "power_tool",
  "hand_tool",
  "measuring",
  "electronics",
  "safety",
  "other",
];
export const STATUSES: EquipmentStatus[] = ["available", "borrowed", "maintenance", "out_of_service"];
/** The statuses a manager sets by hand: "borrowed" comes and goes with the loans. */
export const SETTABLE_STATUSES: SettableStatus[] = ["available", "maintenance", "out_of_service"];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

// --- Equipment ---

export function fetchEquipmentList(query: EquipmentFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/equipment/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchEquipment(id: number) {
  return dataOf(await call(() => api.GET("/api/equipment/{id}/", { params: { path: { id } } })));
}

export async function fetchWorkshopRights() {
  return dataOf(await call(() => api.GET("/api/equipment/rights/")));
}

export async function createEquipment(body: EquipmentWrite) {
  return dataOf(await call(() => api.POST("/api/equipment/", { body })));
}

export async function updateEquipment(id: number, body: Partial<EquipmentWrite>) {
  return dataOf(await call(() => api.PATCH("/api/equipment/{id}/", { params: { path: { id } }, body })));
}

export async function recordMaintenance(id: number, body: MaintenanceWrite) {
  return dataOf(await call(() => api.POST("/api/equipment/{id}/maintenance/", { params: { path: { id } }, body })));
}

// --- Certifications ---

export async function certify(id: number, memberId: number, note = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/equipment/{id}/certifications/", {
        params: { path: { id } },
        body: { member_id: memberId, note },
      }),
    ),
  );
}

export async function revokeCertification(id: number, certification: number) {
  return dataOf(
    await call(() =>
      api.POST("/api/equipment/{id}/certifications/{certification_id}/revoke/", {
        params: { path: { id, certification_id: certification } },
      }),
    ),
  );
}

// --- Reservations ---

export async function reserve(id: number, from: string, to: string, purpose = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/equipment/{id}/reservations/", {
        params: { path: { id } },
        body: { reserved_from: from, reserved_to: to, purpose },
      }),
    ),
  );
}

export function fetchMyReservations(when?: ReservationWhen) {
  return fetchAllPages(async (page) =>
    dataOf(
      await call(() =>
        api.GET("/api/equipment-reservations/", { params: { query: { ...(when ? { when } : {}), page } } }),
      ),
    ),
  );
}

/** The slots of a week ("2026-10-19", its Monday), every equipment's or one's (the week calendar). */
export async function fetchWeekReservations(start: string, equipment?: number) {
  return dataOf(
    await call(() =>
      api.GET("/api/equipment-reservations/week/", {
        params: { query: { start, ...(equipment ? { equipment } : {}) } },
      }),
    ),
  );
}

export async function cancelReservation(id: number, reason = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/equipment-reservations/{id}/cancel/", { params: { path: { id } }, body: { reason } }),
    ),
  );
}

// --- Loans ---

export async function requestLoan(id: number, reason: string, dueDate: string) {
  return dataOf(
    await call(() =>
      api.POST("/api/equipment/{id}/loans/", { params: { path: { id } }, body: { reason, due_date: dueDate } }),
    ),
  );
}

export function fetchLoans(query: LoanFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/equipment-loans/", { params: { query: { ...query, page } } }))),
  );
}

export async function approveLoan(id: number) {
  return dataOf(await call(() => api.POST("/api/equipment-loans/{id}/approve/", { params: { path: { id } } })));
}

export async function refuseLoan(id: number, note: string) {
  return dataOf(
    await call(() => api.POST("/api/equipment-loans/{id}/refuse/", { params: { path: { id } }, body: { note } })),
  );
}

export async function returnLoan(id: number, condition: ReturnCondition, note = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/equipment-loans/{id}/return/", { params: { path: { id } }, body: { condition, note } }),
    ),
  );
}

export async function cancelLoan(id: number) {
  return dataOf(await call(() => api.POST("/api/equipment-loans/{id}/cancel/", { params: { path: { id } } })));
}
