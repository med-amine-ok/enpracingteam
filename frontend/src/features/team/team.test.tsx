import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import {
  downloadReport,
  fetchDashboard,
  fetchMonthlyReport,
  fetchReportingRights,
  fetchWeeklyReport,
  type Dashboard,
  type MonthlyReport,
  type WeeklyReport,
} from "./api";
import { ReportsPage } from "./reports-page";
import { TeamDashboard } from "./team-dashboard";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchReportingRights: vi.fn(),
  fetchDashboard: vi.fn(),
  fetchWeeklyReport: vi.fn(),
  fetchMonthlyReport: vi.fn(),
  downloadReport: vi.fn(),
}));

const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const KARIM = { id: 3, first_name: "Karim", last_name: "Demo" };
const indicator = (
  value: number | null,
  status: "green" | "orange" | "red" | "neutral",
  total: number | null = null,
) => ({
  value,
  total,
  status,
});

const DASHBOARD: Dashboard = {
  scope: "team",
  generated_at: "2026-10-22T08:00:00Z",
  overall: "red",
  indicators: {
    active_members: indicator(11, "neutral"),
    inactive_members: indicator(2, "orange", 11),
    attendance_rate: indicator(75, "orange"),
    completion_rate: indicator(50, "red"),
    overdue_tasks: indicator(3, "orange"),
    blocked_tasks: indicator(1, "orange"),
    critical_tasks: indicator(4, "neutral"),
    members_without_objectives: indicator(1, "green", 11),
    unresolved_blockers: indicator(2, "orange"),
  },
  warnings: [
    {
      kind: "critical_blocked",
      severity: "red",
      member: null,
      task: { id: 7, title: "Câbler le BMS" },
      department: null,
      count: null,
      days: null,
    },
    { kind: "member_overdue", severity: "orange", member: RAYAN, task: null, department: null, count: 2, days: null },
    { kind: "member_inactive", severity: "red", member: KARIM, task: null, department: null, count: null, days: null },
  ],
  departments: [
    {
      unit: { id: 3, name: "Electronics", type: "fs_department" },
      members: 4,
      validated: 2,
      in_progress: 6,
      overdue: 2,
      critical: 3,
      blockers: 1,
      attendance_rate: 75,
      status: "orange",
    },
  ],
  members: [
    {
      member: RAYAN,
      status: "at_risk",
      last_activity: "2026-10-20T10:00:00Z",
      units: ["Electronics"],
      overdue: 2,
      open_tasks: 3,
      open_points: 9,
    },
    {
      member: KARIM,
      status: "inactive",
      last_activity: null,
      units: ["Powertrain"],
      overdue: 0,
      open_tasks: 1,
      open_points: 2,
    },
    {
      member: { id: 1, first_name: "Lina", last_name: "Demo" },
      status: "active",
      last_activity: "2026-10-22T07:00:00Z",
      units: ["Electronics"],
      overdue: 0,
      open_tasks: 2,
      open_points: 5,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchReportingRights).mockResolvedValue({ dashboard: true, reports: true });
  vi.mocked(fetchDashboard).mockResolvedValue(DASHBOARD);
});

describe("TeamDashboard", () => {
  it("shows the indicators with their colour, the warnings, the departments and the members to follow", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamDashboard />);
    const attendance = await screen.findByRole("group", { name: "Taux de présence (30 j)" });
    expect(attendance).toHaveTextContent("75 %");
    expect(attendance).toHaveTextContent("Attention requise");
    expect(screen.getByRole("group", { name: "Inactifs ou à risque" })).toHaveTextContent("2 / 11");
    expect(screen.getByRole("group", { name: "Tâches réalisées (30 j)" })).toHaveTextContent("Critique");
    expect(screen.getByText("État général :").parentElement).toHaveTextContent("Critique");

    expect(screen.getByRole("link", { name: "Tâche critique bloquée : Câbler le BMS." })).toHaveAttribute(
      "href",
      "/fr/tasks/7",
    );
    expect(screen.getByText("Rayan Demo a 2 tâches en retard.")).toBeInTheDocument();
    expect(screen.getByText("Karim Demo : aucune activité enregistrée dans l'ERP.")).toBeInTheDocument();

    const electronics = screen.getByRole("row", { name: /Electronics/ });
    expect(within(electronics).getByText("75 %")).toBeInTheDocument();

    const members = screen.getByRole("heading", { name: "Membres (3)" }).closest("section")!;
    expect(within(members).queryByText("Lina Demo")).not.toBeInTheDocument(); // active, nothing overdue
    expect(within(members).getByText("Karim Demo").closest("li")).toHaveTextContent("Inactif");
    await user.click(within(members).getByRole("button", { name: "Tous" }));
    expect(within(members).getByText("Lina Demo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rapports" })).toHaveAttribute("href", "/fr/team/reports");
  });

  it("is for the Board, the Team Manager, the Bureau's positions and the leaders", async () => {
    vi.mocked(fetchReportingRights).mockResolvedValue({ dashboard: false, reports: false });
    renderWithProviders(<TeamDashboard />);
    expect(
      await screen.findByText(
        "Le tableau de bord est réservé au Board, au Team Manager, aux postes du Bureau et aux chefs d'unité.",
      ),
    ).toBeInTheDocument();
    expect(fetchDashboard).not.toHaveBeenCalled();
  });
});

describe("ReportsPage", () => {
  const weekly: WeeklyReport = {
    kind: "weekly",
    title: "Rapport hebdomadaire de l'équipe",
    language: "fr",
    start: "2026-10-15",
    end: "2026-10-22",
    generated_at: "2026-10-22T08:00:00Z",
    overall: "orange",
    indicators: DASHBOARD.indicators,
    achievements: [
      {
        id: 1,
        title: "Choisir les cellules",
        project: "[DEMO] EV 2027",
        department: "Electronics",
        points: 3,
        quality_mark: 4,
        due_date: "2026-10-18",
        people: ["Rayan Demo"],
      },
    ],
    delayed: [],
    critical_blockers: [],
    attention: [DASHBOARD.members[0]],
    departments: DASHBOARD.departments,
    workload: [],
    risks: [DASHBOARD.warnings[0]],
    priorities: [],
  };
  const monthly: MonthlyReport = {
    kind: "monthly",
    title: "Monthly performance report",
    language: "en",
    month: "2026-09",
    start: "2026-09-01",
    end: "2026-09-30",
    generated_at: "2026-10-22T08:00:00Z",
    members: [
      {
        member: RAYAN,
        units: ["Electronics"],
        status: "active",
        validated: 2,
        delivered_points: 4.8,
        presence: 87.5,
        open_tasks: 1,
      },
    ],
    departments: [],
    trends: [],
    major_blockers: [],
    projects: [],
    risks: [],
  };

  it("previews the weekly report and downloads it as PDF or Excel", async () => {
    vi.mocked(fetchWeeklyReport).mockResolvedValue(weekly);
    vi.mocked(downloadReport).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<ReportsPage />);
    expect(await screen.findByText("Rapport hebdomadaire de l'équipe")).toBeInTheDocument();
    expect(screen.getByText("Choisir les cellules · [DEMO] EV 2027")).toBeInTheDocument();
    expect(screen.getByText("Tâche critique bloquée : Câbler le BMS.")).toBeInTheDocument();
    expect(fetchWeeklyReport).toHaveBeenCalledWith("fr");

    await user.click(screen.getByRole("button", { name: "Télécharger le PDF" }));
    await waitFor(() =>
      expect(downloadReport).toHaveBeenCalledWith(
        "weekly",
        { lang: "fr", file: "pdf", month: undefined },
        expect.stringMatching(/^rapport-hebdomadaire-\d{4}-\d{2}-\d{2}$/),
      ),
    );
  });

  it("shows the monthly report of a chosen month, in English", async () => {
    vi.mocked(fetchWeeklyReport).mockResolvedValue(weekly);
    vi.mocked(fetchMonthlyReport).mockResolvedValue(monthly);
    vi.mocked(downloadReport).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<ReportsPage />);
    await user.click(await screen.findByRole("button", { name: "Mensuel" }));
    await user.selectOptions(screen.getByLabelText("Langue du rapport"), "en");
    const month = screen.getByLabelText("Mois");
    await user.clear(month);
    await user.type(month, "2026-09");
    await waitFor(() => expect(fetchMonthlyReport).toHaveBeenLastCalledWith("2026-09", "en"));
    expect(await screen.findByText("Monthly performance report")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Rayan Demo/ })).toHaveTextContent("87,5 %");

    await user.click(screen.getByRole("button", { name: "Télécharger l'Excel" }));
    await waitFor(() =>
      expect(downloadReport).toHaveBeenCalledWith(
        "monthly",
        { lang: "en", file: "xlsx", month: "2026-09" },
        "rapport-mensuel-2026-09",
      ),
    );
  });

  it("is for the Board, the Team Manager and the Bureau's positions", async () => {
    vi.mocked(fetchReportingRights).mockResolvedValue({ dashboard: true, reports: false });
    renderWithProviders(<ReportsPage />);
    expect(
      await screen.findByText(
        "Les rapports de l'équipe sont réservés au Board, au Team Manager et aux postes du Bureau.",
      ),
    ).toBeInTheDocument();
    expect(fetchWeeklyReport).not.toHaveBeenCalled();
  });
});
