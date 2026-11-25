import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { ApiError } from "@/lib/api/errors";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { fetchSeasons, fetchWorkMe } from "../api";
import { fetchQualityInputs, saveQualityInput, type QualityRow } from "./hub-api";
import { LINA, workMe } from "./hub-fixtures";
import { RankingDataPage } from "./ranking-data-page";

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  fetchWorkMe: vi.fn(),
  fetchSeasons: vi.fn(),
}));
vi.mock("./hub-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hub-api")>()),
  fetchQualityInputs: vi.fn(),
  saveQualityInput: vi.fn(),
  fetchQualityHistory: vi.fn(),
}));

function row(id: number, title: string, overrides: Partial<QualityRow> = {}): QualityRow {
  return {
    deliverable: { id, code: `D-${id}`, title, status: "validated", acceptance_criteria: "" },
    work_order: { id: 50, code: "WO-50", title: "Pack batterie" },
    department: { id: 10, name: "Powertrain" },
    season: 3,
    members: [LINA],
    first_complete_submission_at: "2026-11-02T09:00:00Z",
    rounds: [
      {
        number: 1,
        complete: true,
        submitted_at: "2026-11-02T09:00:00Z",
        decision: "validated",
        severity: null,
        attributable: null,
      },
    ],
    raw_quality: null,
    data_status: "incomplete",
    note: "",
    last_modified_at: null,
    entered_by: null,
    ...overrides,
  };
}

describe("RankingDataPage", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchMembers).mockResolvedValue([]);
    vi.mocked(fetchOrgUnits).mockResolvedValue([]);
    vi.mocked(fetchSeasons).mockResolvedValue([{ id: 3, year: 2026, label: "2026-2027" }]);
    // The ranking data belongs to the club admins (the viewer's `scoring` rights).
    vi.mocked(fetchWorkMe).mockResolvedValue(
      workMe({ is_club_admin: true, scoring: { admin: true, config: false, publish: false } }),
    );
  });

  it("saves a confirmed quality mark, and shows the unvalidated work as awaiting validation", async () => {
    vi.mocked(fetchQualityInputs).mockResolvedValue([
      row(1, "Modéliser le boîtier"),
      row(2, "Câbler le BMS", {
        deliverable: { id: 2, code: "D-2", title: "Câbler le BMS", status: "submitted", acceptance_criteria: "" },
      }),
    ]);
    vi.mocked(saveQualityInput).mockResolvedValue(
      row(1, "Modéliser le boîtier", { raw_quality: "4.5", data_status: "complete" }),
    );
    const user = userEvent.setup();
    renderWithProviders(<RankingDataPage />);
    await screen.findByText("D-1 · Modéliser le boîtier");
    expect(screen.getAllByText("En attente de validation").length).toBeGreaterThan(0);
    // Only the validated Deliverable has an entry form.
    expect(screen.getAllByLabelText("Note de qualité brute (0 à 5)")).toHaveLength(1);
    await user.type(screen.getByLabelText("Note de qualité brute (0 à 5)"), "4.5");
    await user.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() =>
      expect(saveQualityInput).toHaveBeenCalledWith(1, {
        raw_quality: "4.5",
        data_status: "complete",
        note: "",
        reason: "",
      }),
    );
    expect(await screen.findByText("Enregistré.")).toBeInTheDocument();
  });

  it("saves a draft as incomplete", async () => {
    vi.mocked(fetchQualityInputs).mockResolvedValue([row(1, "Modéliser le boîtier")]);
    vi.mocked(saveQualityInput).mockResolvedValue(row(1, "Modéliser le boîtier"));
    const user = userEvent.setup();
    renderWithProviders(<RankingDataPage />);
    await user.click(await screen.findByRole("button", { name: "Enregistrer le brouillon" }));
    await waitFor(() =>
      expect(saveQualityInput).toHaveBeenCalledWith(1, expect.objectContaining({ data_status: "incomplete" })),
    );
  });

  it("answers a plain not found when the API hides the page (a Head, a member)", async () => {
    vi.mocked(fetchWorkMe).mockResolvedValue(workMe({ is_head: true, headed_department_ids: [10] }));
    vi.mocked(fetchQualityInputs).mockRejectedValue(new ApiError(404, "Not found."));
    const { container } = renderWithProviders(<RankingDataPage />);
    expect(await screen.findByText("Élément introuvable : il a peut-être été supprimé.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/classement|ranking|qualité/i);
  });
});
