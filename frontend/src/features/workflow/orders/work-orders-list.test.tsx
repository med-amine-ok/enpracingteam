import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchSeasons, fetchWorkMe, fetchWorkOrders } from "@/features/workflow/api";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { workMe, workOrder } from "./test-fixtures";
import { WorkOrdersList } from "./work-orders-list";

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/workflow/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/workflow/api")>()),
  fetchWorkMe: vi.fn(),
  fetchSeasons: vi.fn(),
  fetchWorkOrders: vi.fn(),
}));

describe("WorkOrdersList", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe());
    vi.mocked(fetchSeasons).mockResolvedValue([{ id: 3, year: 2027, label: "Saison 2027", is_active: true }]);
  });

  it("reads the current season's Work Orders and shows no budget column when the field is absent", async () => {
    vi.mocked(fetchWorkOrders).mockResolvedValue([workOrder(1, "Châssis tubulaire")]);
    renderWithProviders(<WorkOrdersList />);
    // The first render of the file is slow (the module graph loads): a longer wait.
    expect(await screen.findByRole("link", { name: "Châssis tubulaire" }, { timeout: 5000 })).toHaveAttribute(
      "href",
      "/fr/work/orders/1",
    );
    expect(fetchWorkOrders).toHaveBeenCalledWith({ season: 3 });
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toContain("Livrables actifs");
    expect(headers).not.toContain("Budget de points");
    expect(screen.queryByText(/budget/i)).not.toBeInTheDocument();
  });

  it("shows the budget column to whoever receives the field", async () => {
    vi.mocked(fetchWorkOrders).mockResolvedValue([
      workOrder(1, "Châssis tubulaire", { budget_tier: 4 }),
      workOrder(2, "Faisceau BT", { budget_tier: null }),
    ]);
    renderWithProviders(<WorkOrdersList />);
    expect(await screen.findByRole("columnheader", { name: "Budget de points" })).toBeInTheDocument();
    const row = screen.getByRole("link", { name: "Châssis tubulaire" }).closest("tr") as HTMLElement;
    expect(within(row).getByText("4")).toBeInTheDocument();
    const unset = screen.getByRole("link", { name: "Faisceau BT" }).closest("tr") as HTMLElement;
    expect(within(unset).getByText("Non défini")).toBeInTheDocument();
  });
});
