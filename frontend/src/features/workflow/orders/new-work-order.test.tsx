import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { createWorkOrder, fetchSeasons, fetchWorkMe, fetchWorkProjects } from "@/features/workflow/api";
import { me, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { workMe, workOrderDetail } from "./test-fixtures";
import { NewWorkOrder } from "./work-order-form";

const replace = vi.fn();

vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => ({ replace, back: vi.fn() }),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));
vi.mock("@/features/workflow/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/workflow/api")>()),
  fetchWorkMe: vi.fn(),
  fetchSeasons: vi.fn(),
  fetchWorkProjects: vi.fn(),
  createWorkOrder: vi.fn(),
}));

describe("NewWorkOrder", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchMembers).mockResolvedValue([]);
    vi.mocked(fetchOrgUnits).mockResolvedValue([
      unit(10, "Mécanique", { type: "fs_department" }),
      unit(11, "Électronique", { type: "fs_department" }),
      unit(1, "Bureau", { type: "governing_body" }),
    ]);
    vi.mocked(fetchSeasons).mockResolvedValue([{ id: 3, year: 2027, label: "Saison 2027", is_active: true }]);
    vi.mocked(fetchWorkProjects).mockResolvedValue([]);
    vi.mocked(createWorkOrder).mockReset().mockResolvedValue(workOrderDetail(42, "Aéro arrière"));
  });

  it("submits a proposal when the viewer does not head the department", async () => {
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe({ is_head: true, headed_department_ids: [11] }));
    const user = userEvent.setup();
    renderWithProviders(<NewWorkOrder />);
    const department = await screen.findByLabelText("Département", {}, { timeout: 5000 });
    expect(screen.queryByRole("option", { name: "Bureau" })).not.toBeInTheDocument();
    await user.selectOptions(department, "10");
    expect(screen.getByText(/ce sera une proposition/)).toBeInTheDocument();
    expect(screen.getByLabelText("Saison")).toHaveValue("3");
    await user.type(screen.getByLabelText("Titre"), "Aéro arrière");
    await user.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    expect(createWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({ season: 3, department: 10, title: "Aéro arrière", submit: true }),
      true,
    );
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/work/orders/42"));
  });

  it("can keep the proposal as a draft", async () => {
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe());
    const user = userEvent.setup();
    renderWithProviders(<NewWorkOrder />);
    await user.selectOptions(await screen.findByLabelText("Département"), "10");
    await user.type(screen.getByLabelText("Titre"), "Aéro arrière");
    await user.click(screen.getByRole("button", { name: "Enregistrer en brouillon" }));
    expect(createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({ submit: false }), true);
  });

  it("creates an official Work Order in a department the viewer heads", async () => {
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe({ is_head: true, headed_department_ids: [10] }));
    const user = userEvent.setup();
    renderWithProviders(<NewWorkOrder />);
    await user.selectOptions(await screen.findByLabelText("Département"), "10");
    expect(screen.getByText(/l’ordre de travail sera officiel/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer en brouillon" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Titre"), "Châssis");
    await user.click(screen.getByRole("button", { name: "Créer" }));
    expect(createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({ department: 10, submit: true }), false);
  });
});
