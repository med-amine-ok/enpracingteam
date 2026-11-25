import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { fetchWorkDashboard, fetchWorkMe } from "../api";
import { dashboard, headPart, workMe } from "./hub-fixtures";
import { WorkDashboard } from "./work-dashboard";

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  fetchWorkMe: vi.fn(),
  fetchWorkDashboard: vi.fn(),
  searchWork: vi.fn(),
}));

describe("WorkDashboard", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe());
  });

  it("shows a member's work, without the Heads' part", async () => {
    vi.mocked(fetchWorkDashboard).mockResolvedValue(dashboard(null));
    renderWithProviders(<WorkDashboard />);
    const item = (await screen.findAllByText("D-1 · Modéliser le boîtier"))[0].closest("a")!;
    expect(item).toHaveAttribute("href", "/fr/work/deliverables/1");
    expect(screen.getByText("Mon travail du jour")).toBeInTheDocument();
    expect(screen.getByText("Blocages ouverts").closest("a")).toHaveAttribute("href", "/fr/work/blockers?mine=1");
    expect(screen.getByText("Proposer un ordre de travail").closest("a")).toHaveAttribute(
      "href",
      "/fr/work/orders/new",
    );
    expect(screen.queryByRole("heading", { name: "Mes départements" })).not.toBeInTheDocument();
  });

  it("never words ranking, scores, points or formulas for a member", async () => {
    vi.mocked(fetchWorkDashboard).mockResolvedValue(dashboard(null));
    const { container } = renderWithProviders(<WorkDashboard />);
    await screen.findByText("Mon travail du jour");
    expect(container.textContent).not.toMatch(/classement|ranking|score|points?\b|formule|formula/i);
  });

  it("adds the Heads' decisions and risks when the API sends them", async () => {
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe({ is_head: true, headed_department_ids: [10] }));
    vi.mocked(fetchWorkDashboard).mockResolvedValue(dashboard(headPart()));
    renderWithProviders(<WorkDashboard />);
    expect(await screen.findByRole("heading", { name: "Mes départements" })).toBeInTheDocument();
    expect(screen.getByText("Propositions à décider").closest("a")).toHaveAttribute("href", "/fr/work/proposals");
    expect(screen.getByText("D-7 · Valider le schéma HV")).toBeInTheDocument();
    expect(screen.getByText("Lina Demo")).toBeInTheDocument();
  });
});
