import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSeasons, useWorkMe } from "@/features/workflow/queries";
import { ApiError } from "@/lib/api/errors";
import { downloadFile } from "@/lib/csv";
import { renderWithProviders } from "@/test/render";
import {
  createFormulaVersion,
  fetchFormulaVersions,
  fetchRunRankings,
  fetchRuns,
  fetchQualityInputs,
  fetchScoringDashboard,
  fetchValidationIssues,
  publishRun,
  saveQualityInput,
  type FormulaVersion,
  type QualityInputRow,
  type Run,
  type RunRankings,
} from "./api";
import { FormulasPage } from "./formulas";
import { RunDetailPage } from "./run-detail";
import { RunsPage } from "./runs";
import { ScoringDashboardPage } from "./scoring-dashboard";
import { ScoringDataPage } from "./scoring-data";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchScoringDashboard: vi.fn(),
  fetchRuns: vi.fn(),
  fetchRunRankings: vi.fn(),
  publishRun: vi.fn(),
  startRun: vi.fn(),
  fetchFormulaVersions: vi.fn(),
  createFormulaVersion: vi.fn(),
  setCurrentFormula: vi.fn(),
  fetchValidationIssues: vi.fn(),
  fetchQualityInputs: vi.fn(),
  saveQualityInput: vi.fn(),
}));
vi.mock("@/features/workflow/queries", () => ({ useWorkMe: vi.fn(), useSeasons: vi.fn() }));
vi.mock("@/lib/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csv")>()),
  downloadFile: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "7" }),
  useSearchParams: () => new URLSearchParams(""),
}));

const SEASON = { id: 1, year: 2026, label: "2026/2027", is_active: true };
const ADMIN = { id: 9, first_name: "Amina", last_name: "Admin" };

function me(scoring?: { admin: boolean; config: boolean; publish: boolean }) {
  vi.mocked(useWorkMe).mockReturnValue({
    data: { is_head: false, headed_department_ids: null, is_club_admin: false, scoring, current_season: SEASON },
    isError: false,
  } as unknown as ReturnType<typeof useWorkMe>);
}

function run(id: number, overrides: Partial<Run> = {}): Run {
  return {
    id,
    season: 1,
    season_label: "2026/2027",
    formula_version: "v1",
    triggered_by: ADMIN,
    triggered_at: "2026-11-20T10:00:00Z",
    completed_at: "2026-11-20T10:01:00Z",
    status: "completed",
    records_processed: 12,
    warnings_count: 1,
    errors_count: 0,
    issues: [{ deliverable: 4, code: "D-4", title: "Faisceau", level: "warning", message: "Mark missing." }],
    notes: "",
    is_published: false,
    published_at: null,
    published_by: null,
    ...overrides,
  };
}

const FORMULA: FormulaVersion = {
  id: 1,
  created_by: ADMIN,
  code: "v1",
  description: "Initial",
  penalty_minor: "0.020",
  penalty_moderate: "0.050",
  penalty_major: "0.100",
  penalty_critical: "0.150",
  escalation_base: "0.250",
  penalty_round_cap: "0.300",
  revision_cap: "0.600",
  tf_early: "1.100",
  tf_on_time: "1.000",
  tf_late_25: "0.800",
  tf_late_50: "0.500",
  tf_late_over50: "0.200",
  tf_no_submit: "0.000",
  weight_effort: "0.350",
  weight_complexity: "0.300",
  weight_uncertainty: "0.200",
  weight_responsibility: "0.150",
  is_current: true,
  created_at: "2026-09-01T08:00:00Z",
};

const RANKINGS: RunRankings = {
  run: run(7),
  members: [
    { member_id: 2, name: "Rayan Demo", total: "4.500", deliverables: 3, rank: 1 },
    { member_id: 5, name: "Nour Demo", total: "2.250", deliverables: 2, rank: 2 },
    { member_id: 6, name: "Sami Test", total: "0.800", deliverables: 1, rank: 3 },
  ],
  departments: [{ department_id: 3, name: "Electronics", total: "7.550", member_count: 3, rank: 1 }],
};

beforeEach(() => {
  vi.mocked(useSeasons).mockReturnValue({
    data: [SEASON, { id: 0, year: 2025, label: "2025/2026", is_active: false }],
  } as unknown as ReturnType<typeof useSeasons>);
  vi.mocked(fetchRuns).mockResolvedValue([
    run(7),
    run(6, { is_published: true, published_at: "2026-11-01T09:00:00Z" }),
  ]);
  vi.mocked(fetchRunRankings).mockResolvedValue(RANKINGS);
  vi.mocked(fetchFormulaVersions).mockResolvedValue([FORMULA]);
});

const RESTRICTED = /restreint|restricted|accès|access|autoris|authori|permission/i;

describe("access", () => {
  it("shows the generic not-found page to whoever has no scoring access, without asking the API", () => {
    me(undefined);
    renderWithProviders(<ScoringDashboardPage />);
    expect(screen.getByRole("heading", { name: "Page introuvable" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(RESTRICTED);
    expect(fetchScoringDashboard).not.toHaveBeenCalled();
  });

  it("turns a 404 from the API into the same generic not-found page", async () => {
    me({ admin: true, config: false, publish: false });
    vi.mocked(fetchScoringDashboard).mockRejectedValue(new ApiError(404, "Not found."));
    renderWithProviders(<ScoringDashboardPage />);
    expect(await screen.findByRole("heading", { name: "Page introuvable" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(RESTRICTED);
  });
});

describe("runs", () => {
  it("hides running and publishing from an admin without the publication right", async () => {
    me({ admin: true, config: true, publish: false });
    renderWithProviders(<RunsPage />);
    expect(await screen.findByRole("link", { name: "#7" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lancer un calcul/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publier/ })).not.toBeInTheDocument();
  });

  it("lets a publication admin publish a completed run after confirming", async () => {
    me({ admin: true, config: false, publish: true });
    vi.mocked(publishRun).mockResolvedValue(run(7, { is_published: true }));
    const user = userEvent.setup();
    renderWithProviders(<RunsPage />);
    expect(await screen.findByRole("link", { name: "#7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lancer un calcul/ })).toBeInTheDocument();
    // Run 6 is already published: only run 7 offers it.
    const publish = screen.getAllByRole("button", { name: /^Publier$/ });
    expect(publish).toHaveLength(1);
    await user.click(publish[0]);
    const dialog = screen.getByRole("dialog", { name: "Publier le calcul n° 7" });
    expect(publishRun).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la publication" }));
    await waitFor(() => expect(publishRun).toHaveBeenCalledWith(7, ""));
  });
});

describe("run form", () => {
  it("offers only the seasons from 2026–2027 on", async () => {
    me({ admin: true, config: true, publish: true });
    const user = userEvent.setup();
    renderWithProviders(<RunsPage />);
    await screen.findByRole("link", { name: "#7" });
    await user.click(screen.getByRole("button", { name: /Lancer un calcul/ }));
    const form = screen.getByRole("button", { name: "Lancer le calcul" }).closest("form") as HTMLElement;
    const options = within(within(form).getByLabelText("Saison")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Choisir une saison", "2026/2027"]);
    expect(within(form).getByText(/La notation commence avec la saison 2026–2027/)).toBeInTheDocument();
  });
});

describe("formulas", () => {
  it("shows the versions but no form to an admin without the configuration right", async () => {
    me({ admin: true, config: false, publish: true });
    renderWithProviders(<FormulasPage />);
    expect(await screen.findByTestId("formula-version")).toHaveTextContent("v1");
    expect(screen.queryByRole("button", { name: /Nouvelle version/ })).not.toBeInTheDocument();
  });

  it("prefills a new version from the current one and requires a reason", async () => {
    me({ admin: true, config: true, publish: false });
    vi.mocked(createFormulaVersion).mockResolvedValue({ ...FORMULA, id: 2, code: "v2", is_current: false });
    const user = userEvent.setup();
    renderWithProviders(<FormulasPage />);
    await user.click(await screen.findByRole("button", { name: /Nouvelle version/ }));
    const form = screen.getByRole("form", { name: "Nouvelle version de formule" });
    expect(within(form).getByLabelText("Effort")).toHaveValue(0.35);
    await user.type(within(form).getByLabelText("Code"), "v2");
    const create = within(form).getByRole("button", { name: "Créer la version" });
    expect(create).toBeDisabled();
    await user.type(within(form).getByLabelText("Motif"), "Calibration");
    expect(create).toBeEnabled();
    await user.click(create);
    await waitFor(() =>
      expect(createFormulaVersion).toHaveBeenCalledWith(
        expect.objectContaining({ code: "v2", reason: "Calibration", weight_effort: "0.350", is_current: false }),
      ),
    );
  });
});

describe("run detail", () => {
  it("sorts the members by total and exports what is shown", async () => {
    me({ admin: true, config: false, publish: false });
    const user = userEvent.setup();
    renderWithProviders(<RunDetailPage />);
    await screen.findByText("Rayan Demo");
    const names = () => screen.getAllByTestId("ranking-row").map((row) => within(row).getByRole("link").textContent);
    expect(names()).toEqual(["Rayan Demo", "Nour Demo", "Sami Test"]);
    // Total: highest first on the first click, then lowest first.
    await user.click(screen.getByRole("button", { name: "Total" }));
    expect(names()).toEqual(["Rayan Demo", "Nour Demo", "Sami Test"]);
    await user.click(screen.getByRole("button", { name: "Total" }));
    expect(names()).toEqual(["Sami Test", "Nour Demo", "Rayan Demo"]);
    await user.click(screen.getByRole("button", { name: "Rang" }));
    expect(names()).toEqual(["Rayan Demo", "Nour Demo", "Sami Test"]);
    expect(screen.getByRole("link", { name: "Nour Demo" })).toHaveAttribute("href", "/fr/scoring/members/5?run=7");

    await user.type(screen.getByLabelText("Rechercher un membre"), "demo");
    expect(names()).toEqual(["Rayan Demo", "Nour Demo"]);
    await user.click(screen.getByRole("button", { name: /Exporter en CSV/ }));
    const [name, text] = vi.mocked(downloadFile).mock.calls[0];
    expect(name).toBe("scoring-run-7.csv");
    expect(text).toContain("Rang;Membre;Total;Livrables");
    expect(text).toContain("1;Rayan Demo;4.500;3");
    expect(text).toContain("2;Nour Demo;2.250;2");
    expect(text).not.toContain("Sami Test");
  });

  it("shows the run's issues", async () => {
    me({ admin: true, config: false, publish: false });
    renderWithProviders(<RunDetailPage />);
    expect(await screen.findByText("Mark missing.")).toBeInTheDocument();
    expect(screen.getByText("D-4 — Faisceau")).toBeInTheDocument();
  });
});

const QUALITY: QualityInputRow = {
  deliverable: { id: 4, code: "D-4", title: "Faisceau", status: "validated", acceptance_criteria: "" },
  work_order: { id: 2, code: "WO-2", title: "Câblage" },
  department: { id: 3, name: "Electronics" },
  season: 1,
  members: [{ id: 2, first_name: "Rayan", last_name: "Demo" }],
  first_complete_submission_at: "2026-11-10T10:00:00Z",
  rounds: [],
  raw_quality: "4.0",
  data_status: "incomplete",
  note: "",
  last_modified_at: null,
  entered_by: null,
};

describe("ranking data", () => {
  it("lets an admin correct a quality mark, with a reason", async () => {
    me({ admin: true, config: true, publish: true });
    vi.mocked(fetchValidationIssues).mockResolvedValue([
      { kind: "quality_unconfirmed", deliverable: 4, code: "D-4", title: "Faisceau", department: "Electronics" },
    ]);
    vi.mocked(fetchQualityInputs).mockResolvedValue([QUALITY]);
    vi.mocked(saveQualityInput).mockResolvedValue({ ...QUALITY, raw_quality: "4.5", data_status: "complete" });
    const user = userEvent.setup();
    renderWithProviders(<ScoringDataPage />);
    expect(await screen.findByText("Note non confirmée")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Saisir ou corriger/ }));
    const form = screen.getByRole("form", { name: "Saisir ou corriger" });
    const mark = within(form).getByLabelText("Note de qualité (0–5)");
    await user.clear(mark);
    await user.type(mark, "4.5");
    await user.selectOptions(within(form).getByLabelText("État"), "complete");
    const save = within(form).getByRole("button", { name: "Enregistrer" });
    expect(save).toBeDisabled();
    await user.type(within(form).getByLabelText("Motif"), "Checked with the Head");
    await user.click(save);
    await waitFor(() =>
      expect(saveQualityInput).toHaveBeenCalledWith(4, {
        raw_quality: "4.5",
        data_status: "complete",
        note: "",
        reason: "Checked with the Head",
      }),
    );
  });
});
