import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMembers } from "@/features/members/api";
import { createTask, fetchLifecycleSteps, fetchProject, fetchSubsystems, updateTask } from "@/features/work/api";
import { ApiError } from "@/lib/api/errors";
import { lifecycleStep, member, project, subsystem, taskDetail } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { TaskForm } from "./task-form";

vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn() }));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  fetchSubsystems: vi.fn(),
  fetchLifecycleSteps: vi.fn(),
  fetchProject: vi.fn(),
}));

const ines = member(11, "Ines", "Demo");
const adam = member(12, "Adam", "Demo");
const former = member(13, "Ancien", "Demo", { status: "alumni" });

const created = taskDetail(40, "Câbler le BMS");
const NO_ESTIMATE = { edit: false, create_task: true, estimate_tasks: false };

/** A date field: the browser's own date picker, filled with the date as the API writes it. */
function setDate(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("TaskForm", () => {
  beforeEach(() => {
    vi.mocked(fetchMembers).mockResolvedValue([ines, adam, former]);
    vi.mocked(fetchProject).mockResolvedValue({ ...project(1, "[DEMO] EV 2027"), team: [] });
    vi.mocked(fetchSubsystems).mockResolvedValue([
      subsystem(2, "HV Battery & BMS", { permissions: { edit: true, validate: true, estimate_tasks: true } }),
      subsystem(3, "Motor & Inverter"),
    ]);
    vi.mocked(fetchLifecycleSteps).mockResolvedValue([
      lifecycleStep(1, "Étude & recherche"),
      lifecycleStep(2, "Conception CAD"),
      lifecycleStep(3, "Simulation"),
    ]);
    vi.mocked(createTask).mockReset().mockResolvedValue(created);
    vi.mocked(updateTask).mockReset().mockResolvedValue(created);
  });

  it("creates a task with its subsystem, its step, its points and dates, and its people", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Titre"), "  Câbler le BMS  ");
    await user.selectOptions(screen.getByLabelText("Priorité"), "high");
    await user.selectOptions(await screen.findByLabelText("Sous-système"), "2");
    await user.selectOptions(await screen.findByLabelText("Étape du cycle de vie"), "3");
    await user.type(screen.getByLabelText("Livrable attendu"), "Le faisceau du BMS");
    // The member leads this subsystem: the points and dates are theirs to set.
    await user.selectOptions(screen.getByLabelText("Points"), "3");
    setDate("Date de début", "2026-10-21");
    setDate("Échéance", "2026-10-30");

    const search = screen.getByLabelText("Ajouter une personne");
    await user.type(search, "demo");
    expect(screen.queryByRole("button", { name: "Ajouter Ancien Demo" })).not.toBeInTheDocument(); // alumni
    await user.click(await screen.findByRole("button", { name: "Ajouter Ines Demo" }));
    await user.click(screen.getByRole("button", { name: "Ajouter Adam Demo" }));
    // The first person added is the main one, until another is chosen.
    expect(screen.getByRole("radio", { name: "Principale : Ines Demo" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Principale : Adam Demo" }));

    await user.click(screen.getByRole("button", { name: "Créer la tâche" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(createTask).toHaveBeenCalledWith({
      title: "Câbler le BMS",
      description: "",
      priority: "high",
      deliverable: "Le faisceau du BMS",
      success_criteria: "",
      points: 3,
      start_date: "2026-10-21",
      due_date: "2026-10-30",
      subsystem_id: 2,
      lifecycle_step_id: 3,
      assignee_ids: [11, 12],
      primary_assignee_id: 12,
      project_id: 1,
      parent_id: null,
    });
  });

  it("offers only the steps of the project's car", async () => {
    vi.mocked(fetchLifecycleSteps).mockResolvedValue([
      lifecycleStep(1, "Étude & recherche"),
      lifecycleStep(2, "Banc moteur thermique", { applies_to_ev: false }),
      lifecycleStep(3, "Essais du pack HT", { applies_to_ic: false }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} onSaved={vi.fn()} />); // the EV project
    await user.selectOptions(await screen.findByLabelText("Sous-système"), "2");
    const steps = await screen.findByLabelText("Étape du cycle de vie");
    const offered = within(steps)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(offered).toEqual(["Aucune étape", "1. Étude & recherche", "3. Essais du pack HT"]);
  });

  it("starts a subtask in the subsystem and step of its parent", async () => {
    const parent = taskDetail(7, "Modéliser le pack", {
      subsystem: { id: 2, name: "HV Battery & BMS" },
      lifecycle_step: { id: 2, step_order: 2, name: "Conception CAD" },
    });
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} parent={parent} onSaved={vi.fn()} />);
    expect(await screen.findByLabelText("Sous-système")).toHaveValue("2");
    expect(await screen.findByLabelText("Étape du cycle de vie")).toHaveValue("2");

    await user.type(screen.getByLabelText("Titre"), "Boîtier");
    await user.click(screen.getByRole("button", { name: "Créer la tâche" }));
    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ parent_id: 7, subsystem_id: 2, lifecycle_step_id: 2, title: "Boîtier" }),
      ),
    );
  });

  it("forgets the step when the subsystem is taken away", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText("Titre"), "Câbler le BMS");
    await user.selectOptions(await screen.findByLabelText("Sous-système"), "2");
    await user.selectOptions(await screen.findByLabelText("Étape du cycle de vie"), "3");
    await user.selectOptions(screen.getByLabelText("Sous-système"), "");
    expect(screen.queryByLabelText("Étape du cycle de vie")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Créer la tâche" }));
    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ subsystem_id: null, lifecycle_step_id: null })),
    );
  });

  it("leaves the points and dates to a leader when the member does not lead the work", async () => {
    vi.mocked(fetchProject).mockResolvedValue({
      ...project(1, "[DEMO] EV 2027", { permissions: NO_ESTIMATE }),
      team: [],
    });
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText("Titre"), "Câbler le BMS");
    expect(
      await screen.findByText(
        "Fixés par un chef d'unité ou le chef de projet, jamais par une personne assignée à la tâche.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Points")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Créer la tâche" }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(vi.mocked(createTask).mock.calls[0][0]).not.toHaveProperty("points");
    expect(vi.mocked(createTask).mock.calls[0][0]).not.toHaveProperty("due_date");
  });

  it("changes a task; its points and dates only before work starts", async () => {
    const task = taskDetail(40, "Câbler le BMS", {
      status: "in_progress",
      priority: "low",
      due_date: "2026-10-30",
      subsystem: { id: 2, name: "HV Battery & BMS" },
      lifecycle_step: { id: 2, step_order: 2, name: "Conception CAD" },
      assignees: [{ member: { id: 11, first_name: "Ines", last_name: "Demo" }, is_primary: true }],
    });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} task={task} onSaved={onSaved} />);
    expect(screen.getByLabelText("Titre")).toHaveValue("Câbler le BMS");
    expect(screen.queryByLabelText("Statut")).not.toBeInTheDocument(); // it moves through its steps
    expect(
      screen.getByText("Verrouillés depuis le début du travail : seul un blocage validé repousse l'échéance."),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Critères de réussite"), "Continuité vérifiée");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateTask).toHaveBeenCalledWith(
      40,
      expect.objectContaining({
        priority: "low",
        success_criteria: "Continuité vérifiée",
        assignee_ids: [11],
        primary_assignee_id: 11,
      }),
    );
    expect(vi.mocked(updateTask).mock.calls[0][1]).not.toHaveProperty("due_date");
    // Its step, unchanged, is not sent again: the API would refuse one that no longer applies.
    expect(vi.mocked(updateTask).mock.calls[0][1]).not.toHaveProperty("lifecycle_step_id");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("sends the step of a task when it is changed", async () => {
    const task = taskDetail(40, "Câbler le BMS", {
      subsystem: { id: 2, name: "HV Battery & BMS" },
      lifecycle_step: { id: 2, step_order: 2, name: "Conception CAD" },
    });
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} task={task} onSaved={vi.fn()} />);
    await screen.findByRole("option", { name: /Simulation/ });
    await user.selectOptions(screen.getByLabelText("Étape du cycle de vie"), "3");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(40, expect.objectContaining({ lifecycle_step_id: 3 })));
  });

  it("lets a leader set the points and dates of a planned task", async () => {
    const task = taskDetail(40, "Câbler le BMS", {
      permissions: { ...taskDetail(0, "").permissions, estimate: true },
    });
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} task={task} onSaved={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Points"), "5");
    setDate("Date de début", "2026-10-21");
    setDate("Échéance", "2026-11-04");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(
        40,
        expect.objectContaining({ points: 5, start_date: "2026-10-21", due_date: "2026-11-04" }),
      ),
    );
  });

  it("shows why the API refused", async () => {
    vi.mocked(createTask).mockRejectedValue(
      new ApiError(400, "Le sous-système doit appartenir au même projet que la tâche."),
    );
    const user = userEvent.setup();
    renderWithProviders(<TaskForm projectId={1} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText("Titre"), "Câbler le BMS");
    await user.click(screen.getByRole("button", { name: "Créer la tâche" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le sous-système doit appartenir au même projet que la tâche.",
    );
  });
});
