import { api } from "@/lib/api/client";
import { dataOf, ensureOk, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

type Schemas = components["schemas"];

export type Budget = Schemas["Budget"];
export type BudgetDetail = Schemas["BudgetDetail"];
export type BudgetCreate = Schemas["BudgetWriteRequest"];
export type BudgetChange = Schemas["PatchedBudgetChangeRequest"];
export type Expense = Schemas["Expense"];
export type ExpenseCategory = Schemas["ExpenseCategoryEnum"];
export type ExpenseCreate = Schemas["ExpenseWriteRequest"];
export type ExpenseChange = Schemas["PatchedExpenseWriteRequest"];
export type InvoiceCreate = Schemas["InvoiceWriteRequest"];
export type FinanceSummary = Schemas["FinanceSummary"];
export type Sponsorship = Schemas["Sponsorship"];
export type SponsorshipStatus = Schemas["SponsorshipStatusEnum"];
export type SponsorshipWrite = Schemas["SponsorshipWriteRequest"];
export type SponsorshipChange = Schemas["PatchedSponsorshipWriteRequest"];
export type SponsorshipSummary = Schemas["SponsorshipSummary"];
export type ExpenseFilters = Omit<NonNullable<operations["finance_expenses_list"]["parameters"]["query"]>, "page">;

/** The kinds of expenses entered by hand (a purchase becomes an expense when its order is delivered). */
export const MANUAL_CATEGORIES: ExpenseCategory[] = [
  "registration",
  "transport",
  "accommodation",
  "communication",
  "tooling",
  "other",
];
export const SPONSOR_STAGES: SponsorshipStatus[] = ["prospect", "contacted", "negotiating", "confirmed", "declined"];

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

export async function fetchFinanceSummary(year?: string) {
  return dataOf(await call(() => api.GET("/api/finance/summary/", { params: { query: year ? { year } : {} } })));
}

export function fetchBudgets(year: string) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/finance/budgets/", { params: { query: { year, page } } }))),
  );
}

export async function fetchBudget(id: number) {
  return dataOf(await call(() => api.GET("/api/finance/budgets/{id}/", { params: { path: { id } } })));
}

export async function createBudget(body: BudgetCreate) {
  return dataOf(await call(() => api.POST("/api/finance/budgets/", { body })));
}

export async function changeBudget(id: number, body: BudgetChange) {
  return dataOf(await call(() => api.PATCH("/api/finance/budgets/{id}/", { params: { path: { id } }, body })));
}

export function fetchExpenses(query: ExpenseFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/finance/expenses/", { params: { query: { ...query, page } } }))),
  );
}

export async function createExpense(body: ExpenseCreate) {
  return dataOf(await call(() => api.POST("/api/finance/expenses/", { body })));
}

export async function changeExpense(id: number, body: ExpenseChange) {
  return dataOf(await call(() => api.PATCH("/api/finance/expenses/{id}/", { params: { path: { id } }, body })));
}

export async function deleteExpense(id: number) {
  ensureOk(await call(() => api.DELETE("/api/finance/expenses/{id}/", { params: { path: { id } } })));
}

export async function recordInvoice(id: number, body: InvoiceCreate) {
  return dataOf(await call(() => api.POST("/api/finance/expenses/{id}/invoice/", { params: { path: { id } }, body })));
}

export function fetchSponsors() {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/finance/sponsorships/", { params: { query: { page } } }))),
  );
}

export async function fetchSponsorSummary(year?: string) {
  return dataOf(
    await call(() => api.GET("/api/finance/sponsorships/summary/", { params: { query: year ? { year } : {} } })),
  );
}

export async function createSponsor(body: SponsorshipWrite) {
  return dataOf(await call(() => api.POST("/api/finance/sponsorships/", { body })));
}

export async function changeSponsor(id: number, body: SponsorshipChange) {
  return dataOf(await call(() => api.PATCH("/api/finance/sponsorships/{id}/", { params: { path: { id } }, body })));
}

export async function deleteSponsor(id: number) {
  ensureOk(await call(() => api.DELETE("/api/finance/sponsorships/{id}/", { params: { path: { id } } })));
}
