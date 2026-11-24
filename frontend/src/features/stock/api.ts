import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type StockItem = Schemas["StockItem"];
export type StockItemDetail = Schemas["StockItemDetail"];
export type StockMovement = Schemas["StockMovement"];
export type StockMovementType = Schemas["StockMovementTypeEnum"];
export type StockSummary = Schemas["StockSummary"];
export type StockLineCreate = Schemas["StockItemCreateRequest"];
export type StockLineChange = Schemas["PatchedStockItemChangeRequest"];
export type Take = Schemas["StockTakeRequest"];
export type Add = Schemas["StockAddRequest"];
export type Count = Schemas["StockCountRequest"];
export type StockFilters = Omit<NonNullable<operations["inventory_items_list"]["parameters"]["query"]>, "page">;
export type JournalFilters = Omit<NonNullable<operations["inventory_movements_list"]["parameters"]["query"]>, "page">;

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

export function fetchStock(query: StockFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/inventory/items/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchStockItem(id: number) {
  return dataOf(await call(() => api.GET("/api/inventory/items/{id}/", { params: { path: { id } } })));
}

export async function fetchStockSummary() {
  return dataOf(await call(() => api.GET("/api/inventory/items/summary/")));
}

export async function createStockLine(body: StockLineCreate) {
  return dataOf(await call(() => api.POST("/api/inventory/items/", { body })));
}

export async function changeStockLine(id: number, body: StockLineChange) {
  return dataOf(await call(() => api.PATCH("/api/inventory/items/{id}/", { params: { path: { id } }, body })));
}

export async function takeFromStock(id: number, body: Take) {
  return dataOf(await call(() => api.POST("/api/inventory/items/{id}/take/", { params: { path: { id } }, body })));
}

export async function addToStock(id: number, body: Add) {
  return dataOf(await call(() => api.POST("/api/inventory/items/{id}/add/", { params: { path: { id } }, body })));
}

export async function countStock(id: number, body: Count) {
  return dataOf(await call(() => api.POST("/api/inventory/items/{id}/count/", { params: { path: { id } }, body })));
}

/** The latest movements (one page: the 50 newest) matching `query`. */
export async function fetchJournal(query: JournalFilters = {}) {
  const page = dataOf(await call(() => api.GET("/api/inventory/movements/", { params: { query } })));
  return page.results;
}
