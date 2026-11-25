import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { fetchDependencies, fetchDependencyProposals, fetchWorkMe, manualRelease } from "../api";
import { DependenciesPage } from "./dependencies-page";
import { link, workMe } from "./hub-fixtures";

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  fetchWorkMe: vi.fn(),
  fetchDependencies: vi.fn(),
  fetchDependencyProposals: vi.fn(),
  manualRelease: vi.fn(),
  cancelDependency: vi.fn(),
  decideDependencyProposal: vi.fn(),
}));

describe("DependenciesPage", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchMembers).mockResolvedValue([]);
    vi.mocked(fetchOrgUnits).mockResolvedValue([]);
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe({ is_head: true, headed_department_ids: [10] }));
    vi.mocked(fetchDependencies).mockResolvedValue([link(5)]);
    vi.mocked(fetchDependencyProposals).mockResolvedValue([]);
    vi.mocked(manualRelease).mockResolvedValue(link(5, { state: "released", manually_released: true }));
  });

  it("shows prerequisite → dependent with the type, the condition and the states", async () => {
    renderWithProviders(<DependenciesPage />);
    const card = (await screen.findByText("D-1 · Modéliser le boîtier")).closest("li")!;
    expect(within(card).getByText("D-2 · Câbler le BMS").closest("a")).toHaveAttribute(
      "href",
      "/fr/work/deliverables/2",
    );
    expect(within(card).getByText("Prérequis obligatoire")).toBeInTheDocument();
    expect(within(card).getByText("Prérequis validé")).toBeInTheDocument();
    expect(within(card).getByText("Lien actif")).toBeInTheDocument();
  });

  it("releases manually only with a reason and after a confirmation that it is permanent", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DependenciesPage />);
    await user.click(await screen.findByRole("button", { name: "Lever manuellement" }));
    const next = screen.getByRole("button", { name: "Continuer" });
    expect(next).toBeDisabled();
    await user.type(screen.getByLabelText("Motif (obligatoire)"), "Le prototype suffit pour avancer");
    await user.click(next);
    // A confirmation first: nothing is sent yet.
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("ne pourra pas être révoquée");
    expect(manualRelease).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmer la levée définitive" }));
    await waitFor(() => expect(manualRelease).toHaveBeenCalledWith(5, "Le prototype suffit pour avancer"));
  });
});
