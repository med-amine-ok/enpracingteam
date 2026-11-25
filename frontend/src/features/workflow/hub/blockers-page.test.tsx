import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { fetchBlockers, fetchWorkMe, resolveBlocker } from "../api";
import { BlockersPage } from "./blockers-page";
import { blocker, workMe } from "./hub-fixtures";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams("mine=1"),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  fetchWorkMe: vi.fn(),
  fetchBlockers: vi.fn(),
  reportBlocker: vi.fn(),
  updateBlocker: vi.fn(),
  resolveBlocker: vi.fn(),
  cancelBlocker: vi.fn(),
  validateBlockerImpact: vi.fn(),
  searchWork: vi.fn(),
}));

describe("BlockersPage", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchMembers).mockResolvedValue([]);
    vi.mocked(fetchOrgUnits).mockResolvedValue([]);
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe());
    vi.mocked(fetchBlockers).mockResolvedValue([blocker(8)]);
    vi.mocked(resolveBlocker).mockResolvedValue(blocker(8, { status: "resolved" }));
  });

  it("reads ?mine=1 and shows the blocker with its affected work", async () => {
    renderWithProviders(<BlockersPage />);
    expect(await screen.findByText("Le fournisseur n’a pas livré les cellules.")).toBeInTheDocument();
    expect(fetchBlockers).toHaveBeenCalledWith({ mine: 1 });
    expect(screen.getByLabelText("Seulement ceux qui me concernent")).toBeChecked();
    expect(screen.getByText("D-1 · Modéliser le boîtier").closest("a")).toHaveAttribute(
      "href",
      "/fr/work/deliverables/1",
    );
  });

  it("resolves only with a note, saying a resolved blocker is not reopened", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BlockersPage />);
    await user.click(await screen.findByRole("button", { name: "Résoudre" }));
    expect(screen.getByText(/n’est pas rouvert/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Marquer comme résolu" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Note de résolution (obligatoire)"), "Cellules reçues");
    await user.click(confirm);
    await waitFor(() => expect(resolveBlocker).toHaveBeenCalledWith(8, "Cellules reçues"));
  });
});
