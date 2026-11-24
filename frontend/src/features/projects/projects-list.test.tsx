import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProjectCreating, fetchProjects } from "@/features/work/api";
import { project } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ProjectsList } from "./projects-list";

vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchProjects: vi.fn(),
  fetchProjectCreating: vi.fn(),
}));

const ev = project(1, "[DEMO] EV 2027", { tasks_total: 10, tasks_done: 3, tasks_blocked: 2, subsystems_count: 6 });
const ic = project(2, "[DEMO] IC 2027", { category: "ic", status: "planned", project_manager: null });

describe("ProjectsList", () => {
  beforeEach(() => {
    vi.mocked(fetchProjects).mockReset().mockResolvedValue([ev, ic]);
    vi.mocked(fetchProjectCreating).mockResolvedValue({ can_create: false });
  });

  it("offers a new project to the Board and the Team Manager only (decision D-025)", async () => {
    const { unmount } = renderWithProviders(<ProjectsList />);
    await screen.findByRole("link", { name: /\[DEMO\] EV 2027/ });
    expect(screen.queryByRole("link", { name: "Nouveau projet" })).not.toBeInTheDocument();
    unmount();
    vi.mocked(fetchProjectCreating).mockResolvedValue({ can_create: true });
    renderWithProviders(<ProjectsList />);
    expect(await screen.findByRole("link", { name: "Nouveau projet" })).toHaveAttribute("href", "/fr/projects/new");
  });

  it("shows each project with its progress", async () => {
    renderWithProviders(<ProjectsList />);
    const card = await screen.findByRole("link", { name: /\[DEMO\] EV 2027/ });
    expect(card).toHaveAttribute("href", "/fr/projects/1");
    expect(within(card).getByText("3/10 tâches terminées")).toBeInTheDocument();
    expect(within(card).getByText("2 bloquées")).toBeInTheDocument();
    expect(within(card).getByText("6 sous-systèmes")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30");
    // A project may have no manager yet.
    expect(
      within(screen.getByRole("link", { name: /\[DEMO\] IC 2027/ })).getByText("Sans chef de projet"),
    ).toBeInTheDocument();
  });

  it("shows my projects, or the projects in one state", async () => {
    vi.mocked(fetchProjects).mockResolvedValue([
      { ...ev, health: "at_risk" },
      { ...ic, health: "planning" },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);
    const card = await screen.findByRole("link", { name: /\[DEMO\] EV 2027/ });
    expect(within(card).getByText("À risque")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mes projets" }));
    await waitFor(() => expect(fetchProjects).toHaveBeenLastCalledWith({ mine: true }));
    const states = screen.getByRole("group", { name: "État des projets" });
    await user.click(within(states).getByRole("button", { name: "En préparation" }));
    expect(screen.queryByRole("link", { name: /\[DEMO\] EV 2027/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\[DEMO\] IC 2027/ })).toBeInTheDocument();
    expect(within(states).getByRole("button", { name: "En préparation" })).toHaveAttribute("aria-pressed", "true");
  });

  it("draws the roadmap: each project between its dates, with its progress, and the ones without dates", async () => {
    vi.mocked(fetchProjects).mockResolvedValue([ev, { ...ic, start_date: null, end_date: null }]);
    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);
    await screen.findByRole("link", { name: /\[DEMO\] EV 2027/ });
    await user.click(screen.getByRole("button", { name: "Feuille de route" }));
    expect(
      screen.getByRole("img", {
        name: "[DEMO] EV 2027 : du 2 sept. 2026 au 14 juin 2027, 30 % des tâches validées",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "[DEMO] EV 2027" })).toHaveAttribute("href", "/fr/projects/1");
    expect(screen.getByText("Sans dates (absents de la frise) : [DEMO] IC 2027")).toBeInTheDocument();
  });

  it("says when there is no project", async () => {
    vi.mocked(fetchProjects).mockResolvedValue([]);
    renderWithProviders(<ProjectsList />);
    expect(await screen.findByText("Aucun projet.")).toBeInTheDocument();
  });
});
