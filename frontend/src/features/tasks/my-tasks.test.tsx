import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTasks } from "@/features/work/api";
import { task } from "@/test/fixtures";
import { downloadFile } from "@/lib/csv";
import { renderWithProviders } from "@/test/render";
import { MyTasks } from "./my-tasks";

vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchTasks: vi.fn(),
}));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csv")>()),
  downloadFile: vi.fn(),
}));

const ELECTRONICS = { id: 3, code: "fs-electronics", name: "Electronics", type: "fs_department" } as const;
const MEDIA = { id: 4, code: "dept-media", name: "Media", type: "club_department" } as const;
const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const NOUR = { id: 5, first_name: "Nour", last_name: "Demo" };

function workOrders() {
  return [
    task(1, "Câbler le BMS", {
      unit: ELECTRONICS,
      status: "in_progress",
      progress: 40,
      health: "overdue",
      is_overdue: true,
      assignees: [{ member: RAYAN, is_primary: true }],
    }),
    task(2, "Tester l'isolation", {
      unit: ELECTRONICS,
      status: "validated",
      progress: 100,
      health: "done_on_time",
      assignees: [{ member: RAYAN, is_primary: true }],
    }),
    task(3, "Affiche du salon", {
      unit: MEDIA,
      progress: 0,
      health: "due_soon",
      due_date: "2026-10-30",
      assignees: [{ member: NOUR, is_primary: true }],
    }),
  ];
}

describe("MyTasks", () => {
  beforeEach(() => {
    vi.mocked(fetchTasks)
      .mockReset()
      .mockResolvedValue([
        task(1, "Revue de conception", { is_overdue: true, due_date: "2026-10-14" }),
        task(2, "Modéliser le pack", { status: "in_progress" }),
      ]);
  });

  it("shows the member's tasks across projects, and how many are late", async () => {
    renderWithProviders(<MyTasks />);
    expect(await screen.findByRole("link", { name: "Revue de conception" })).toBeInTheDocument();
    expect(fetchTasks).toHaveBeenCalledWith({ assignee: "me" });
    expect(screen.getAllByText("[DEMO] EV 2027")).toHaveLength(2); // the project of each card
    expect(screen.getByText("1 en retard")).toBeInTheDocument();
  });

  it("shows every task of the team on demand", async () => {
    renderWithProviders(<MyTasks />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Toutes les tâches" }));
    await waitFor(() => expect(fetchTasks).toHaveBeenLastCalledWith({}));
  });

  it("says when nothing is assigned to the member", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    renderWithProviders(<MyTasks />);
    expect(await screen.findByText("Aucune tâche ne vous est assignée.")).toBeInTheDocument();
  });

  it("shows the work orders by team, then a team's tasks in the list", async () => {
    vi.mocked(fetchTasks).mockResolvedValue(workOrders());
    const user = userEvent.setup();
    renderWithProviders(<MyTasks />);
    await screen.findByRole("link", { name: "Câbler le BMS" });
    await user.click(screen.getByRole("button", { name: "Équipes" }));
    const electronics = screen.getByRole("heading", { level: 3, name: "Electronics" }).closest("li")!;
    expect(within(electronics).getByText("Ferrari")).toBeInTheDocument(); // the Project's livery
    expect(
      within(electronics).getByRole("progressbar", { name: "Avancement de l'équipe Electronics" }),
    ).toHaveAttribute("aria-valuenow", "70");
    await user.click(within(electronics).getByRole("button", { name: "Voir les tâches de l'équipe Electronics" }));
    expect(screen.getByText("Tâches de l'équipe Electronics")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Câbler le BMS" })).toBeInTheDocument();
    expect(within(table).queryByRole("link", { name: "Affiche du salon" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retirer le filtre" }));
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Affiche du salon" })).toBeInTheDocument();
  });

  it("shows each person's load, then their tasks", async () => {
    vi.mocked(fetchTasks).mockResolvedValue(workOrders());
    const user = userEvent.setup();
    renderWithProviders(<MyTasks />);
    await screen.findByRole("link", { name: "Câbler le BMS" });
    await user.click(screen.getByRole("button", { name: "Personnes" }));
    const rayan = screen.getByRole("heading", { level: 3, name: "Rayan Demo" }).closest("li")!;
    expect(within(rayan).getByText("Avancement moyen : 70 %")).toBeInTheDocument();
    await user.click(within(rayan).getByRole("button", { name: "Voir les tâches de Rayan Demo" }));
    expect(screen.getByText("Tâches de Rayan Demo")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("link")).toHaveLength(2);
  });

  it("filters the report and exports it for a spreadsheet", async () => {
    vi.mocked(fetchTasks).mockResolvedValue(workOrders());
    const user = userEvent.setup();
    renderWithProviders(<MyTasks />);
    await screen.findByRole("link", { name: "Câbler le BMS" });
    await user.click(screen.getByRole("button", { name: "Rapport" }));
    expect(screen.getByText(/^3 tâches · 1 en retard · avancement moyen 47 %/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Équipe"), "4");
    expect(screen.getByText(/^1 tâche · 0 en retard/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exporter (CSV)" }));
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [name, text] = vi.mocked(downloadFile).mock.calls[0];
    expect(name).toMatch(/^ordres-de-travail-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(text).toContain("Référence;Titre;Équipe;Responsable;État;Avancement;Échéance;Santé;Priorité");
    expect(text).toContain("EV27-003;Affiche du salon;Media;Nour Demo;Prévue;0 %;2026-10-30;Échéance proche;");
    expect(text).not.toContain("Câbler le BMS");
  });
});
