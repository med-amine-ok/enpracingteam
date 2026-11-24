import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchProject,
  fetchSubsystems,
  fetchTasks,
  tickStep,
  updateProject,
  type ProjectDetail,
} from "@/features/work/api";
import { lifecycleStep, project, stepState, subsystem, task } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ProjectView } from "./project-view";

let search = "";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "1" }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchProject: vi.fn(),
  fetchTasks: vi.fn(),
  fetchSubsystems: vi.fn(),
  updateProject: vi.fn(),
  tickStep: vi.fn(),
}));

const ev: ProjectDetail = {
  ...project(1, "[DEMO] EV 2027", { tasks_total: 10, tasks_done: 3, tasks_blocked: 2, subsystems_count: 1 }),
  description: "Demo data: fictitious project.",
  team: [
    {
      id: 1,
      member: { id: 4, first_name: "Nour", last_name: "Demo" },
      role: "Ergonomie",
      start_date: null,
      end_date: null,
    },
  ],
};

const cad = lifecycleStep(2, "Conception CAD");
const battery = subsystem(2, "HV Battery & BMS", {
  steps: [stepState(lifecycleStep(1, "Étude & recherche"), { is_complete: true }), stepState(cad)],
});

describe("ProjectView", () => {
  beforeEach(() => {
    search = "";
    vi.mocked(fetchProject).mockReset().mockResolvedValue(ev);
    vi.mocked(fetchTasks)
      .mockReset()
      .mockResolvedValue([task(1, "Revue de conception")]);
    vi.mocked(fetchSubsystems).mockReset().mockResolvedValue([battery]);
  });

  it("shows the project, its progress and the board of its tasks", async () => {
    renderWithProviders(<ProjectView />);
    expect(await screen.findByRole("heading", { level: 1, name: "[DEMO] EV 2027" })).toBeInTheDocument();
    expect(screen.getByText("Chef de projet : Lina Demo")).toBeInTheDocument();
    expect(screen.getByText("2 sept. 2026 → 14 juin 2027")).toBeInTheDocument();
    expect(screen.getByText("3/10 tâches terminées")).toBeInTheDocument();
    expect(screen.getByText("2 bloquées")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Revue de conception" })).toBeInTheDocument();
    // Only the tasks: their subtasks are in each task's page.
    expect(fetchTasks).toHaveBeenCalledWith({ project: 1, parent: "none" });
    expect(screen.getByRole("link", { name: "Nouvelle tâche" })).toHaveAttribute("href", "/fr/tasks/new?project=1");
  });

  it("lets its manager change its status", async () => {
    vi.mocked(updateProject).mockResolvedValue({ ...ev, status: "on_hold" });
    renderWithProviders(<ProjectView />);
    await userEvent.setup().selectOptions(await screen.findByLabelText("Statut"), "on_hold");
    expect(updateProject).toHaveBeenCalledWith(1, { status: "on_hold" });
  });

  it("lets its manager set the prefix of its task references", async () => {
    vi.mocked(updateProject).mockResolvedValue({ ...ev, key: "EV27" });
    const user = userEvent.setup();
    renderWithProviders(<ProjectView />);
    const field = await screen.findByLabelText("Préfixe des références");
    // Without a prefix, the references use P and the project's number, as the API does.
    expect(field).toHaveAttribute("placeholder", "P1");
    expect(
      screen.getByText("2 à 10 majuscules ou chiffres ; les tâches seront numérotées P1-001, …"),
    ).toBeInTheDocument();
    await user.type(field, "ev27");
    expect(
      screen.getByText("2 à 10 majuscules ou chiffres ; les tâches seront numérotées EV27-001, …"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Préfixe enregistré.")).toBeInTheDocument();
    expect(updateProject).toHaveBeenCalledWith(1, { key: "EV27" });
  });

  it("offers only what the member may do", async () => {
    vi.mocked(fetchProject).mockResolvedValue({
      ...ev,
      permissions: { edit: false, create_task: false, estimate_tasks: false },
    });
    renderWithProviders(<ProjectView />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByLabelText("Statut")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Préfixe des références")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nouvelle tâche" })).not.toBeInTheDocument();
  });

  it("ticks a step of a subsystem's lifecycle", async () => {
    vi.mocked(tickStep).mockResolvedValue(battery);
    const user = userEvent.setup();
    renderWithProviders(<ProjectView />);
    await user.click(await screen.findByRole("tab", { name: "Sous-systèmes (1)" }));
    const card = (await screen.findByRole("heading", { name: "HV Battery & BMS" })).closest("article")!;
    // Each card's status list says whose status it is.
    expect(within(card).getByRole("combobox", { name: "Statut de « HV Battery & BMS »" })).toHaveValue("active");
    await user.click(within(card).getByRole("button", { name: "2. Conception CAD: À faire" }));
    await waitFor(() => expect(tickStep).toHaveBeenCalledWith(2, 2, true));
  });

  it("opens the subsystems tab from a link (a notification about a validation)", async () => {
    search = "tab=subsystems";
    renderWithProviders(<ProjectView />);
    expect(await screen.findByRole("tab", { name: "Sous-systèmes (1)" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "HV Battery & BMS" })).toBeInTheDocument();
  });

  it("shows the current team", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectView />);
    await user.click(await screen.findByRole("tab", { name: "Équipe" }));
    expect(await screen.findByText("Nour Demo")).toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys, the other way round in Arabic", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<ProjectView />);
    const tasks = await screen.findByRole("tab", { name: "Tâches" });
    expect(tasks).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Équipe" })).toHaveAttribute("tabindex", "-1");
    tasks.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Sous-systèmes (1)" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Sous-systèmes (1)" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Équipe" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Tâches" })).toHaveFocus();
    unmount();

    renderWithProviders(<ProjectView />, { locale: "ar" });
    const arabicTasks = await screen.findByRole("tab", { name: "المهام" });
    arabicTasks.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "الأنظمة الفرعية (1)" })).toHaveFocus();
  });
});
