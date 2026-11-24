import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers } from "@/features/members/api";
import { me, member } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  createContribution,
  fetchContributions,
  fetchMemberMonth,
  fetchMonthTable,
  fetchMyRanking,
  fetchRankingRights,
  publishMonth,
  rejectContribution,
  saveAssessment,
  validateContribution,
  type Contribution,
  type MemberMonth,
  type MonthTable,
  type Score,
} from "./api";
import { ContributionsPage } from "./contributions";
import { MemberRanking } from "./member-ranking";
import { MyRanking } from "./my-ranking";
import { monthKey, previousMonth } from "./ranking-parts";
import { TeamRanking } from "./team-ranking";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "2" }),
  useSearchParams: () => new URLSearchParams("month=2026-09"),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchRankingRights: vi.fn(),
  fetchMyRanking: vi.fn(),
  fetchMonthTable: vi.fn(),
  publishMonth: vi.fn(),
  fetchMemberMonth: vi.fn(),
  saveAssessment: vi.fn(),
  fetchContributions: vi.fn(),
  createContribution: vi.fn(),
  validateContribution: vi.fn(),
  rejectContribution: vi.fn(),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));

const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const ELECTRONICS = { id: 3, code: null, name: "Electronics", type: "fs_department" as const };

function score(overrides: Partial<Score> = {}): Score {
  return {
    month: "2026-09",
    delivery: 92.8,
    performance: 89.7,
    load: 100,
    presence: 75,
    reliability: 65,
    team: 69.4,
    final: 83.3,
    provisional: true,
    ranking_score: 86.2,
    category: "A",
    rank: null,
    details: {
      tasks: [{ id: 7, title: "Modéliser le pack", points: 3, quality: 5, timing: 1.1, not_delivered: false }],
      delivered_points: 5.6,
      reference_load: 1.9,
      weeks_in_progress: 4,
      weeks_updated: 2,
      update_rate: 50,
      communication_mark: 4,
      communication_cap: 4,
      late_blockers: 1,
      contribution_points: 3,
      workshop: { mark: 4, score: 80 },
      events: { mark: null, score: null, na: "Aucun événement" },
      logistics_mark: 3,
      effort_mark: null,
    },
    ...overrides,
  };
}

function contribution(id: number, overrides: Partial<Contribution> = {}): Contribution {
  return {
    id,
    member: RAYAN,
    points: 2,
    description: "Aide sur la CFD de l'aéro",
    occurred_on: "2026-10-05",
    proposed_by: RAYAN,
    status: "proposed",
    decided_by: null,
    decided_at: null,
    decision_note: "",
    created_at: "2026-10-05T10:00:00Z",
    permissions: { decide: false },
    ...overrides,
  };
}

function memberMonth(overrides: Partial<MemberMonth> = {}): MemberMonth {
  return {
    member: RAYAN,
    department: ELECTRONICS,
    month: "2026-09",
    published: false,
    score: score(),
    assessment: null,
    contributions: [contribution(4, { status: "validated" })],
    permissions: { assess: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMe).mockResolvedValue(me()); // Lina, id 1
  vi.mocked(fetchRankingRights).mockResolvedValue({ team: false, publish: false });
  vi.mocked(fetchMembers).mockResolvedValue([member(2, "Rayan", "Demo"), member(3, "Yacine", "Demo")]);
});

describe("MyRanking", () => {
  it("shows the month's score, how each part was made, and the published months", async () => {
    vi.mocked(fetchMyRanking).mockResolvedValue({
      month: "2026-10",
      published: false,
      score: score({ month: "2026-10" }),
      history: [
        {
          month: "2026-09",
          delivery: 80,
          presence: 100,
          reliability: 70,
          team: 60,
          final: 78.5,
          provisional: false,
          ranking_score: 78.5,
          category: "B",
          rank: 3,
          published_at: "2026-10-03T09:00:00Z",
        },
      ],
    });
    renderWithProviders(<MyRanking />);
    expect(await screen.findByText("83,3 / 100")).toBeInTheDocument();
    expect(screen.getByText("A — Excellent")).toBeInTheDocument();
    expect(screen.getAllByText("Provisoire").length).toBeGreaterThan(0);
    expect(screen.getByText(/ne déclenche jamais de sanction automatique/)).toBeInTheDocument();
    const delivery = screen.getByText("Livraison").closest("li")!;
    expect(within(delivery).getByText("92,8")).toBeInTheDocument();
    expect(within(delivery).getByText("Charge : 100 (référence : 1,9 points)")).toBeInTheDocument();
    const reliability = screen.getByText("Fiabilité").closest("li")!;
    expect(within(reliability).getByText("Mises à jour : 2 semaines sur 4")).toBeInTheDocument();
    expect(
      within(reliability).getByText("Communication : 4/5 (plafonnée à 4 : 1 blocage déclaré en retard)"),
    ).toBeInTheDocument();
    const team = screen.getByText("Contribution à l'équipe").closest("li")!;
    expect(within(team).getByText("Événements : N/A (Aucun événement)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Modéliser le pack" })).toHaveAttribute("href", "/fr/tasks/7");
    const published = screen.getByText("Rang : 3").closest("li")!;
    expect(within(published).getByText("septembre 2026")).toBeInTheDocument();
    expect(within(published).getByText("B — Très bien")).toBeInTheDocument();
    expect(fetchMyRanking).toHaveBeenCalledWith(undefined); // the current month
    expect(screen.queryByRole("link", { name: "Équipe" })).not.toBeInTheDocument();
  });
});

describe("TeamRanking", () => {
  const table = (overrides: Partial<MonthTable> = {}): MonthTable => ({
    month: previousMonth(monthKey(new Date())),
    published_at: null,
    published_by: null,
    rows: [
      {
        member: RAYAN,
        department: ELECTRONICS,
        delivery: 92.8,
        presence: 75,
        reliability: 65,
        team: 69.4,
        final: 83.3,
        provisional: true,
        ranking_score: 86.2,
        category: "A",
        rank: 1,
      },
    ],
    permissions: { publish: true },
    ...overrides,
  });

  it("shows the members of the month and lets the Team Manager publish it", async () => {
    vi.mocked(fetchRankingRights).mockResolvedValue({ team: true, publish: true });
    const done = table({
      published_at: "2026-10-02T09:00:00Z",
      published_by: { id: 1, first_name: "Lina", last_name: "Demo" },
    });
    vi.mocked(fetchMonthTable).mockResolvedValueOnce(table()).mockResolvedValue(done);
    vi.mocked(publishMonth).mockResolvedValue(done);
    const user = userEvent.setup();
    renderWithProviders(<TeamRanking />);
    const last = previousMonth(monthKey(new Date()));
    const row = (await screen.findByRole("link", { name: "Rayan Demo" })).closest("tr")!;
    expect(within(row).getByRole("link", { name: "Rayan Demo" })).toHaveAttribute(
      "href",
      `/fr/ranking/members/2?month=${last}`,
    );
    expect(within(row).getByText("83,3")).toBeInTheDocument();
    expect(within(row).getByText("A — Excellent")).toBeInTheDocument();
    expect(screen.getByText("Pas encore publié : les notes sont provisoires.")).toBeInTheDocument();
    expect(fetchMonthTable).toHaveBeenCalledWith(last);
    await user.click(screen.getByRole("button", { name: "Publier le classement" }));
    await user.click(screen.getByRole("button", { name: "Confirmer la publication" }));
    await waitFor(() => expect(publishMonth).toHaveBeenCalledWith(last));
    expect(await screen.findByText(/Publié le .* par Lina Demo/)).toBeInTheDocument();
  });

  it("shows no publish button to a department head", async () => {
    vi.mocked(fetchRankingRights).mockResolvedValue({ team: true, publish: false });
    vi.mocked(fetchMonthTable).mockResolvedValue(table({ permissions: { publish: false } }));
    renderWithProviders(<TeamRanking />);
    expect(await screen.findByRole("link", { name: "Rayan Demo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publier le classement" })).not.toBeInTheDocument();
  });
});

describe("MemberRanking", () => {
  it("lets the department head give the marks, with the reason of an N/A", async () => {
    vi.mocked(fetchMemberMonth).mockResolvedValue(memberMonth());
    vi.mocked(saveAssessment).mockResolvedValue(memberMonth());
    const user = userEvent.setup();
    renderWithProviders(<MemberRanking />);
    expect(await screen.findByRole("heading", { level: 1, name: "Rayan Demo" })).toBeInTheDocument();
    expect(fetchMemberMonth).toHaveBeenCalledWith(2, "2026-09");
    await user.selectOptions(screen.getByLabelText("Communication de l'avancement et des blocages"), "4");
    await user.selectOptions(screen.getByLabelText("Contribution à l'atelier"), "na");
    const save = screen.getByRole("button", { name: "Enregistrer l'évaluation" });
    expect(save).toBeDisabled(); // the reason of the N/A first
    await user.type(screen.getByLabelText("Pourquoi N/A (Atelier)"), "Rôle à distance");
    await user.selectOptions(screen.getByLabelText("Aide logistique (bonus)"), "3");
    await user.click(save);
    await waitFor(() =>
      expect(saveAssessment).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          month: "2026-09",
          communication_mark: 4,
          workshop_mark: null,
          workshop_na_reason: "Rôle à distance",
          events_mark: null,
          logistics_mark: 3,
          effort_mark: null,
        }),
      ),
    );
    expect(await screen.findByText("Évaluation enregistrée.")).toBeInTheDocument();
    expect(screen.getByText("Aide sur la CFD de l'aéro")).toBeInTheDocument();
  });
});

describe("ContributionsPage", () => {
  it("proposes points for a member who helped", async () => {
    vi.mocked(fetchContributions).mockResolvedValue([]);
    vi.mocked(createContribution).mockResolvedValue(contribution(5));
    const user = userEvent.setup();
    renderWithProviders(<ContributionsPage />);
    expect(await screen.findByText("Aucun point de contribution.")).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Pour qui"), "2");
    await user.selectOptions(screen.getByLabelText("Points"), "2");
    await user.type(screen.getByLabelText("Ce qui a été fait"), "Aide pour régler le BMS");
    await user.click(screen.getByRole("button", { name: "Proposer" }));
    await waitFor(() =>
      expect(createContribution).toHaveBeenCalledWith(
        expect.objectContaining({ member_id: 2, points: 2, description: "Aide pour régler le BMS" }),
      ),
    );
  });

  it("lets the department head validate points, or refuse them saying why", async () => {
    vi.mocked(fetchContributions).mockResolvedValue([contribution(4, { permissions: { decide: true } })]);
    vi.mocked(validateContribution).mockResolvedValue(contribution(4, { status: "validated" }));
    vi.mocked(rejectContribution).mockResolvedValue(contribution(4, { status: "rejected" }));
    const user = userEvent.setup();
    renderWithProviders(<ContributionsPage />);
    const row = (await screen.findByText("2 points pour Rayan Demo, le 5 oct. 2026")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Refuser" }));
    await user.type(within(row).getByLabelText("Pourquoi ils sont refusés"), "Fait partie de sa tâche");
    await user.click(within(row).getByRole("button", { name: "Refuser les points" }));
    await waitFor(() => expect(rejectContribution).toHaveBeenCalledWith(4, "Fait partie de sa tâche"));
    await user.click(within(row).getByRole("button", { name: "Valider" }));
    await waitFor(() => expect(validateContribution).toHaveBeenCalledWith(4));
  });
});
