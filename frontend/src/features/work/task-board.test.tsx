import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { task } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { fetchTasks, startTask, type Task, type TaskDetail } from "./api";
import { useTasks, workKeys } from "./queries";
import { TaskBoard, useStartTask } from "./task-board";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchTasks: vi.fn(),
  startTask: vi.fn(),
}));

const RIGHTS = task(0, "").permissions;
const ESTIMATED = { points: 2, start_date: "2026-10-19", due_date: "2026-10-30" } as const;

const review = task(1, "Revue de conception", {
  ...ESTIMATED,
  priority: "high",
  due_date: "2026-10-14",
  is_overdue: true,
  subtasks_total: 2,
  subtasks_done: 1,
  comments_count: 2,
  permissions: { ...RIGHTS, start: true },
});
const pack = task(2, "Modéliser le pack", {
  ...ESTIMATED,
  status: "in_progress",
  subsystem: { id: 2, name: "HV Battery & BMS" },
  permissions: { ...RIGHTS, submit: true },
});
const cells = task(3, "Choisir les cellules", {
  status: "validated",
  quality_mark: 4,
  permissions: { ...RIGHTS, edit: false, delete: false, declare_blocker: false },
});
const poster = task(4, "Affiche de la journée", {
  ...ESTIMATED,
  status: "submitted",
  permissions: { ...RIGHTS, validate: true },
});
// Planned, counted in the ranking, but no leader has set its points and dates yet.
const unestimated = task(5, "Câbler le BMS", { permissions: { ...RIGHTS, start: true } });

function column(name: string) {
  return screen.getByRole("region", { name });
}

function drag(title: string, to: string) {
  const card = screen.getByRole("link", { name: title }).closest("article")!;
  fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
  fireEvent.dragOver(column(to));
  fireEvent.drop(column(to));
}

describe("TaskBoard", () => {
  it("shows one column per step, each with its cards and their count", () => {
    renderWithProviders(<TaskBoard tasks={[review, pack, cells, poster]} onStart={vi.fn()} />);
    const planned = column("Prévue");
    expect(within(planned).getByRole("link", { name: "Revue de conception" })).toHaveAttribute("href", "/fr/tasks/1");
    expect(within(planned).getByText("Haute")).toBeInTheDocument();
    expect(within(planned).getByText("2 pts")).toBeInTheDocument();
    expect(within(planned).getByText("En retard · 14 oct.")).toBeInTheDocument();
    expect(within(planned).getByText("1/2 sous-tâches")).toBeInTheDocument();
    expect(within(planned).getByText("2 commentaires")).toBeInTheDocument();
    expect(within(column("En cours")).getByText("HV Battery & BMS")).toBeInTheDocument();
    expect(within(column("Soumise")).getByRole("link", { name: "Affiche de la journée" })).toBeInTheDocument();
    expect(within(column("Validée")).getByText("Qualité 4/5")).toBeInTheDocument();
    expect(within(column("À reprendre")).queryByRole("article")).not.toBeInTheDocument();
    expect(within(column("À reprendre")).getByText("0")).toBeInTheDocument();
  });

  it("shows each card's reference, and how far a task in progress is", () => {
    renderWithProviders(
      <TaskBoard tasks={[task(3, "Câbler le BMS", { status: "in_progress", progress: 35 })]} onStart={vi.fn()} />,
    );
    expect(screen.getByText("EV27-003")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Avancement de « Câbler le BMS »" })).toHaveAttribute(
      "aria-valuenow",
      "35",
    );
  });

  it("marks a task with a blocker not resolved yet", () => {
    renderWithProviders(<TaskBoard tasks={[{ ...pack, is_blocked: true }]} onStart={vi.fn()} />);
    expect(within(column("En cours")).getByText("Bloquée")).toBeInTheDocument();
  });

  it("starts a planned card with its button", async () => {
    const onStart = vi.fn();
    renderWithProviders(<TaskBoard tasks={[review]} onStart={onStart} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Commencer « Revue de conception »" }));
    expect(onStart).toHaveBeenCalledWith(review);
  });

  it("starts a planned card dragged to “in progress”, and moves no card anywhere else", () => {
    const onStart = vi.fn();
    renderWithProviders(<TaskBoard tasks={[review, pack]} onStart={onStart} />);
    drag("Revue de conception", "Validée");
    drag("Modéliser le pack", "Soumise");
    expect(onStart).not.toHaveBeenCalled();
    drag("Revue de conception", "En cours");
    expect(onStart).toHaveBeenCalledWith(review);
  });

  it("waits for a leader's points and dates before a task can start", () => {
    renderWithProviders(<TaskBoard tasks={[unestimated]} onStart={vi.fn()} />);
    expect(screen.getByText("Points et dates à fixer")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Câbler le BMS" }).closest("article")).toHaveAttribute(
      "draggable",
      "false",
    );
  });

  it("starts the tasks of before the points without them", () => {
    renderWithProviders(<TaskBoard tasks={[{ ...unestimated, scored: false }]} onStart={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Commencer « Câbler le BMS »" })).toBeInTheDocument();
  });

  it("leads to the task's page to submit or validate it", () => {
    renderWithProviders(<TaskBoard tasks={[pack, poster]} onStart={vi.fn()} />);
    // Named by what they do, described by the task: a search for the task finds its title only.
    const submit = screen.getByRole("link", { name: "Soumettre" });
    expect(submit).toHaveAttribute("href", "/fr/tasks/2");
    expect(submit).toHaveAccessibleDescription("Modéliser le pack");
    const validate = screen.getByRole("link", { name: "Valider" });
    expect(validate).toHaveAttribute("href", "/fr/tasks/4");
    expect(validate).toHaveAccessibleDescription("Affiche de la journée");
    expect(screen.getAllByRole("link", { name: /Modéliser le pack/ })).toHaveLength(1);
  });

  it("offers nothing to do with a task the member may not move", () => {
    renderWithProviders(<TaskBoard tasks={[cells]} onStart={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choisir les cellules" }).closest("article")).toHaveAttribute(
      "draggable",
      "false",
    );
  });

  it("shows the project of each task on boards that mix projects", () => {
    renderWithProviders(<TaskBoard tasks={[pack]} onStart={vi.fn()} showProject />);
    expect(screen.getByText("[DEMO] EV 2027")).toBeInTheDocument();
    expect(screen.getByText("HV Battery & BMS")).toBeInTheDocument();
  });
});

/** The board of a project, as the project page shows it. */
function ProjectBoard() {
  const filters = { project: 1, parent: "none" } as const;
  const tasks = useTasks(filters);
  const start = useStartTask(workKeys.tasks(filters));
  return tasks.data ? <TaskBoard tasks={tasks.data} onStart={(item) => start.mutate(item)} /> : null;
}

describe("useStartTask", () => {
  beforeEach(() => {
    vi.mocked(fetchTasks).mockReset().mockResolvedValue([review]);
    vi.mocked(startTask).mockReset();
  });

  it("moves the card at once, before the API answers", async () => {
    let answer: (task: TaskDetail) => void = () => {};
    vi.mocked(startTask).mockReturnValue(new Promise((resolve) => (answer = resolve as typeof answer)));
    renderWithProviders(<ProjectBoard />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Commencer « Revue de conception »" }));
    expect(within(column("En cours")).getByRole("link", { name: "Revue de conception" })).toBeInTheDocument();
    expect(startTask).toHaveBeenCalledWith(1);

    const started: Task = { ...review, status: "in_progress", permissions: { ...RIGHTS, submit: true } };
    vi.mocked(fetchTasks).mockResolvedValue([started]);
    answer(started as TaskDetail);
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(2)); // the board is checked against the API
    expect(within(column("En cours")).getByRole("link", { name: "Revue de conception" })).toBeInTheDocument();
  });

  it("puts the card back when the API refuses to start it", async () => {
    vi.mocked(startTask).mockRejectedValue(new ApiError(403, "Seules les personnes de cette tâche la commencent."));
    renderWithProviders(<ProjectBoard />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Commencer « Revue de conception »" }));
    await waitFor(() =>
      expect(within(column("Prévue")).getByRole("link", { name: "Revue de conception" })).toBeInTheDocument(),
    );
    expect(within(column("En cours")).queryByRole("link")).not.toBeInTheDocument();
  });
});
