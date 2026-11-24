import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  confirmExclusion,
  createReport,
  createWarning,
  dismissReport,
  fetchDisciplineRights,
  fetchExclusions,
  fetchReports,
  fetchStanding,
  fetchTargets,
  fetchWarning,
  fetchWarnings,
  recordCouncil,
  respondToWarning,
  type BreachReport,
  type Exclusion,
  type MemberWarning,
} from "./api";
import { ReportForm, WarningForm } from "./discipline-forms";
import { DisciplinePage } from "./discipline-page";
import { WarningView } from "./warning-view";

const router = { replace: vi.fn() };

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "7" }),
  useSearchParams: () => new URLSearchParams("member=2&report=5"),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchDisciplineRights: vi.fn(),
  fetchTargets: vi.fn(),
  fetchStanding: vi.fn(),
  fetchReports: vi.fn(),
  createReport: vi.fn(),
  dismissReport: vi.fn(),
  fetchWarnings: vi.fn(),
  fetchWarning: vi.fn(),
  createWarning: vi.fn(),
  respondToWarning: vi.fn(),
  recordCouncil: vi.fn(),
  fetchExclusions: vi.fn(),
  confirmExclusion: vi.fn(),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));

const LINA = { id: 1, first_name: "Lina", last_name: "Demo" };
const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const NADIA = { id: 4, first_name: "Nadia", last_name: "Demo" };
const NO_RIGHTS = { report: false, issue: false, sees_all: false, season: 2026, my_warnings: 0 };

function warning(id: number, overrides: Partial<MemberWarning> = {}): MemberWarning {
  return {
    id,
    member: LINA,
    level: 1,
    season: 2026,
    ground: "commitments",
    rule: "Art. 26 — Réunions",
    facts: "Trois séances manquées sans prévenir",
    expected: "Prévenir avant toute absence",
    project: { id: 1, name: "[DEMO] EV 2027" },
    report: null,
    issued_by: NADIA,
    issued_at: "2026-10-20T10:00:00Z",
    status: "active",
    member_response: "",
    responded_at: null,
    council: null,
    council_decision: "",
    council_decided_by: null,
    council_decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    cancel_reason: "",
    permissions: { respond: false, record_council: false, cancel: false },
    ...overrides,
  };
}

function report(id: number, overrides: Partial<BreachReport> = {}): BreachReport {
  return {
    id,
    member: RAYAN,
    ground: "work_not_done",
    facts: "Câblage non fait depuis trois semaines",
    reported_by: LINA,
    created_at: "2026-10-19T09:00:00Z",
    status: "open",
    handled_by: null,
    handled_at: null,
    handling_note: "",
    permissions: { handle: true },
    ...overrides,
  };
}

function exclusion(id: number, overrides: Partial<Exclusion> = {}): Exclusion {
  return {
    id,
    member: RAYAN,
    cause: "third_warning",
    warning: 9,
    serious_ground: "",
    facts: "",
    proposed_by: NADIA,
    proposed_at: "2026-10-21T09:00:00Z",
    status: "pending",
    decided_by: null,
    decided_at: null,
    decision_note: "",
    permissions: { decide: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMe).mockResolvedValue(me()); // Lina, id 1
  vi.mocked(fetchDisciplineRights).mockResolvedValue(NO_RIGHTS);
  vi.mocked(fetchWarnings).mockResolvedValue([]);
  vi.mocked(fetchReports).mockResolvedValue([]);
  vi.mocked(fetchExclusions).mockResolvedValue([]);
  vi.mocked(fetchTargets).mockResolvedValue([{ ...RAYAN, can_issue: true }]);
});

describe("DisciplinePage", () => {
  it("shows a member the rules and their own warnings only", async () => {
    vi.mocked(fetchWarnings).mockResolvedValue([warning(7)]);
    renderWithProviders(<DisciplinePage />);
    expect(await screen.findByRole("link", { name: /Avertissement n° 1/ })).toHaveAttribute(
      "href",
      "/fr/discipline/warnings/7",
    );
    expect(screen.getByText(/Le compteur repart à zéro à chaque saison/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Signaler un manquement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Donner un avertissement" })).not.toBeInTheDocument();
    expect(fetchReports).not.toHaveBeenCalled();
  });

  it("lets a project manager give a warning from a report, or dismiss it saying why", async () => {
    vi.mocked(fetchDisciplineRights).mockResolvedValue({ ...NO_RIGHTS, report: true, issue: true });
    vi.mocked(fetchReports).mockResolvedValue([report(5)]);
    vi.mocked(dismissReport).mockResolvedValue(report(5, { status: "dismissed" }));
    const user = userEvent.setup();
    renderWithProviders(<DisciplinePage />);
    const row = (await screen.findByText("Câblage non fait depuis trois semaines")).closest("li")!;
    expect(within(row).getByRole("link", { name: "Donner un avertissement" })).toHaveAttribute(
      "href",
      "/fr/discipline/new?member=2&report=5",
    );
    expect(screen.getByRole("link", { name: "Signaler un manquement" })).toHaveAttribute(
      "href",
      "/fr/discipline/report",
    );
    await user.click(within(row).getByRole("button", { name: "Classer sans suite" }));
    await user.type(within(row).getByLabelText("Pourquoi le classer sans suite"), "Un blocage validé");
    await user.click(within(row).getByRole("button", { name: "Classer le signalement" }));
    await waitFor(() => expect(dismissReport).toHaveBeenCalledWith(5, "Un blocage validé"));
  });

  it("lets the Bureau confirm an exclusion, after a warning about the account", async () => {
    vi.mocked(fetchDisciplineRights).mockResolvedValue({ ...NO_RIGHTS, report: true, issue: true, sees_all: true });
    vi.mocked(fetchExclusions).mockResolvedValue([exclusion(3)]);
    vi.mocked(confirmExclusion).mockResolvedValue(exclusion(3, { status: "confirmed" }));
    const user = userEvent.setup();
    renderWithProviders(<DisciplinePage />);
    const row = (await screen.findByText("Troisième avertissement (art. 27.6)")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Confirmer l'exclusion" }));
    expect(within(row).getByText(/désactive le compte de Rayan Demo/)).toBeInTheDocument();
    expect(confirmExclusion).not.toHaveBeenCalled();
    await user.click(within(row).getByRole("button", { name: "Oui, exclure" }));
    await waitFor(() => expect(confirmExclusion).toHaveBeenCalledWith(3));
  });
});

describe("ReportForm", () => {
  it("reports a breach of a member the viewer follows", async () => {
    vi.mocked(createReport).mockResolvedValue(report(6));
    const user = userEvent.setup();
    renderWithProviders(<ReportForm />);
    await screen.findByRole("option", { name: "Rayan Demo" });
    await user.selectOptions(screen.getByLabelText("Membre"), "2");
    await user.selectOptions(screen.getByLabelText("Motif"), "communication");
    await user.type(screen.getByLabelText("Les faits"), "Aucune nouvelle depuis deux semaines");
    await user.click(screen.getByRole("button", { name: "Envoyer le signalement" }));
    await waitFor(() =>
      expect(createReport).toHaveBeenCalledWith({
        member_id: 2,
        ground: "communication",
        facts: "Aucune nouvelle depuis deux semaines",
      }),
    );
    expect(router.replace).toHaveBeenCalledWith("/discipline");
  });
});

describe("WarningForm", () => {
  it("gives a second warning with the date of its council", async () => {
    vi.mocked(fetchStanding).mockResolvedValue({
      member: RAYAN,
      season: 2026,
      active_warnings: 1,
      next_level: 2,
      can_report: true,
      can_issue: true,
    });
    vi.mocked(createWarning).mockResolvedValue(warning(8, { level: 2 }));
    const user = userEvent.setup();
    renderWithProviders(<WarningForm />);
    expect(await screen.findByText("Ce sera l'avertissement n° 2 de la saison.")).toBeInTheDocument();
    expect(fetchStanding).toHaveBeenCalledWith(2);
    await user.type(screen.getByLabelText("Les faits"), "Câblage non fait");
    const give = screen.getByRole("button", { name: "Donner l'avertissement" });
    expect(give).toBeDisabled(); // the council's date first
    await user.type(screen.getByLabelText("Début du conseil"), "2026-10-27T18:00");
    await user.type(screen.getByLabelText("Fin du conseil"), "2026-10-27T19:00");
    await user.type(screen.getByLabelText("Lieu"), "Salle du club");
    await user.click(give);
    await waitFor(() =>
      expect(createWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          member_id: 2,
          report_id: 5,
          facts: "Câblage non fait",
          council_starts_at: new Date("2026-10-27T18:00").toISOString(),
          council_ends_at: new Date("2026-10-27T19:00").toISOString(),
          council_location: "Salle du club",
        }),
      ),
    );
    expect(router.replace).toHaveBeenCalledWith("/discipline/warnings/8");
  });
});

describe("WarningView", () => {
  it("lets the member give their version", async () => {
    vi.mocked(fetchWarning).mockResolvedValue(
      warning(7, { permissions: { respond: true, record_council: false, cancel: false } }),
    );
    vi.mocked(respondToWarning).mockResolvedValue(warning(7, { member_response: "J'étais en examen" }));
    const user = userEvent.setup();
    renderWithProviders(<WarningView />);
    expect(await screen.findByRole("heading", { level: 1, name: "Lina Demo" })).toBeInTheDocument();
    expect(screen.getByText("Prévenir avant toute absence")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Votre version des faits"), "J'étais en examen");
    await user.click(screen.getByRole("button", { name: "Enregistrer ma réponse" }));
    await waitFor(() => expect(respondToWarning).toHaveBeenCalledWith(7, "J'étais en examen"));
  });

  it("shows the council session of a second warning and lets the Bureau record its decision", async () => {
    vi.mocked(fetchWarning).mockResolvedValue(
      warning(7, {
        level: 2,
        council: { id: 12, starts_at: "2026-10-27T17:00:00Z", location: "Salle du club" },
        permissions: { respond: false, record_council: true, cancel: true },
      }),
    );
    vi.mocked(recordCouncil).mockResolvedValue(warning(7, { council_decision: "Binôme pendant un mois" }));
    const user = userEvent.setup();
    renderWithProviders(<WarningView />);
    expect(await screen.findByRole("link", { name: "Ouvrir la séance" })).toHaveAttribute("href", "/fr/meetings/12");
    await user.type(screen.getByLabelText("Mesures correctives ou sanction décidées"), "Binôme pendant un mois");
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => expect(recordCouncil).toHaveBeenCalledWith(7, "Binôme pendant un mois"));
    expect(screen.getByRole("button", { name: "Annuler l'avertissement" })).toBeInTheDocument();
  });
});
