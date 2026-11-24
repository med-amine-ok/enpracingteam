import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type PurchaseRequest = Schemas["PurchaseRequest"];
export type PurchaseRequestDetail = Schemas["PurchaseRequestDetail"];
export type PurchaseEvent = Schemas["PurchaseRequestEvent"];
export type PurchaseStatus = Schemas["PurchaseStatusEnum"];
export type PurchaseAction = Schemas["PurchaseActionEnum"];
export type PurchasePriority = Schemas["PriorityEnum"];
export type PurchaseOrder = Schemas["PurchaseOrder"];
export type PurchaseSummary = Schemas["PurchaseSummary"];
export type PurchaseWrite = Schemas["PurchaseRequestWriteRequest"];
export type PurchaseChange = Schemas["PatchedPurchaseRequestWriteRequest"];
export type OrderWrite = Schemas["PurchaseOrderWriteRequest"];
export type OrderChange = Schemas["PatchedPurchaseOrderWriteRequest"];
export type Reception = Schemas["ReceptionRequest"];
export type OrderBatch = Schemas["OrderBatch"];
export type OrderBatchWrite = Schemas["OrderBatchWriteRequest"];
export type BatchReception = Schemas["BatchReceptionRequest"];
export type Supplier = Schemas["Supplier"];
export type SupplierWrite = Schemas["SupplierWriteRequest"];
export type SupplierChange = Schemas["PatchedSupplierWriteRequest"];
export type SupplierType = Schemas["SupplierTypeEnum"];
export type SupplierStatus = Schemas["SupplierStatusEnum"];
export type Part = Schemas["Part"];
export type PartCategory = Schemas["PartCategoryEnum"];
export type Currency = Schemas["CurrencyEnum"];
export type ShippingAddress = Schemas["ShippingAddress"];
export type PurchaseFilters = Omit<NonNullable<operations["purchasing_requests_list"]["parameters"]["query"]>, "page">;

/** The steps of a request, in order (apps/purchasing/models.py PurchaseStatus). */
export const PURCHASE_STATUSES: PurchaseStatus[] = [
  "a_valider_chef",
  "a_valider_operations",
  "a_commander",
  "en_commande",
  "livre",
  "annule",
];
export const PURCHASE_PRIORITIES: PurchasePriority[] = ["high", "medium", "low"];
export const CURRENCIES: Currency[] = ["DZD", "EUR", "USD", "GBP", "CNY"];
export const PART_CATEGORIES: PartCategory[] = [
  "brakes",
  "wheels_tyres",
  "chassis_body",
  "suspension",
  "steering",
  "drivetrain",
  "engine_tractive",
  "workshop",
  "low_voltage",
  "operations",
  "other",
];
export const SUPPLIER_TYPES: SupplierType[] = ["fournisseur", "sous_traitant", "mixte", "usinage", "logistique"];
export const SUPPLIER_STATUSES: SupplierStatus[] = ["validee", "en_attente", "refusee", "pas_encore_envoyee"];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

// --- Requests ---

export function fetchPurchases(query: PurchaseFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/purchasing/requests/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchPurchase(id: number) {
  return dataOf(await call(() => api.GET("/api/purchasing/requests/{id}/", { params: { path: { id } } })));
}

export async function fetchPurchaseSummary() {
  return dataOf(await call(() => api.GET("/api/purchasing/requests/summary/")));
}

export async function createPurchase(body: PurchaseWrite) {
  return dataOf(await call(() => api.POST("/api/purchasing/requests/", { body })));
}

export async function updatePurchase(id: number, body: PurchaseChange) {
  return dataOf(await call(() => api.PATCH("/api/purchasing/requests/{id}/", { params: { path: { id } }, body })));
}

export async function approvePurchase(id: number, comment = "") {
  return dataOf(
    await call(() =>
      api.POST("/api/purchasing/requests/{id}/approve/", { params: { path: { id } }, body: { comment } }),
    ),
  );
}

export async function refusePurchase(id: number, reason: string) {
  return dataOf(
    await call(() => api.POST("/api/purchasing/requests/{id}/refuse/", { params: { path: { id } }, body: { reason } })),
  );
}

export async function cancelPurchase(id: number, reason: string) {
  return dataOf(
    await call(() => api.POST("/api/purchasing/requests/{id}/cancel/", { params: { path: { id } }, body: { reason } })),
  );
}

export async function placeOrder(id: number, body: OrderWrite) {
  return dataOf(await call(() => api.POST("/api/purchasing/requests/{id}/order/", { params: { path: { id } }, body })));
}

export async function changeOrder(id: number, body: OrderChange) {
  return dataOf(
    await call(() => api.PATCH("/api/purchasing/requests/{id}/order/", { params: { path: { id } }, body })),
  );
}

export async function cancelOrder(id: number, reason: string) {
  return dataOf(
    await call(() =>
      api.POST("/api/purchasing/requests/{id}/cancel-order/", { params: { path: { id } }, body: { reason } }),
    ),
  );
}

export async function receivePurchase(id: number, body: Reception) {
  return dataOf(
    await call(() => api.POST("/api/purchasing/requests/{id}/receive/", { params: { path: { id } }, body })),
  );
}

/** The rest of the parts will not come: the order is delivered with those that arrived (decision D-023). */
export async function closeOrder(id: number, reason: string) {
  return dataOf(
    await call(() =>
      api.POST("/api/purchasing/requests/{id}/close-order/", { params: { path: { id } }, body: { reason } }),
    ),
  );
}

// --- Grouped orders (decision D-023) ---

export async function orderTogether(body: OrderBatchWrite) {
  return dataOf(await call(() => api.POST("/api/purchasing/order-batches/", { body })));
}

export async function receiveBatch(id: number, body: BatchReception) {
  return dataOf(
    await call(() => api.POST("/api/purchasing/order-batches/{id}/receive/", { params: { path: { id } }, body })),
  );
}

// --- Suppliers, parts, shipping addresses ---

export async function fetchSuppliers() {
  return dataOf(await call(() => api.GET("/api/purchasing/suppliers/")));
}

export async function createSupplier(body: SupplierWrite) {
  return dataOf(await call(() => api.POST("/api/purchasing/suppliers/", { body })));
}

export async function updateSupplier(id: number, body: SupplierChange) {
  return dataOf(await call(() => api.PATCH("/api/purchasing/suppliers/{id}/", { params: { path: { id } }, body })));
}

export async function fetchPart(id: number) {
  return dataOf(await call(() => api.GET("/api/purchasing/parts/{id}/", { params: { path: { id } } })));
}

export async function searchParts(search: string) {
  const page = dataOf(await call(() => api.GET("/api/purchasing/parts/", { params: { query: { search } } })));
  return page.results;
}

export async function fetchShippingAddresses() {
  return dataOf(await call(() => api.GET("/api/purchasing/shipping-addresses/")));
}
