import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMembers } from "@/features/members/api";
import { fetchLifecycleSteps, fetchProject, fetchProjects, fetchSubsystems, fetchTask } from "@/features/work/api";
import { lifecycleStep, project, subsystem, taskDetail } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { NewTask } from "./new-task";

let search = "";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => ({ replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn() }));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchProjects: vi.fn(),
  fetchProject: vi.fn(),
  fetchTask: vi.fn(),
  fetchSubsystems: vi.fn(),
  fetchLifecycleSteps: vi.fn(),
}));

describe("NewTask", () => {
  beforeEach(() => {
    vi.mocked(fetchMembers).mockResolvedValue([]);
    // The form reads its project (its rights, the steps of its car).
    vi.mocked(fetchProject).mockResolvedValue({ ...project(1, "[DEMO] EV 2027"), team: [] });
    vi.mocked(fetchSubsystems).mockResolvedValue([subsystem(2, "HV Battery & BMS"), subsystem(3, "Motor & Inverter")]);
    vi.mocked(fetchLifecycleSteps).mockResolvedValue([
      lifecycleStep(1, "Étude & recherche"),
      lifecycleStep(2, "Conception CAD"),
    ]);
    vi.mocked(fetchProjects)
      .mockReset()
      .mockResolvedValue([
        project(1, "[DEMO] EV 2027"),
        project(2, "[DEMO] IC 2027", { permissions: { edit: false, create_task: false, estimate_tasks: false } }),
      ]);
  });

  it("asks for the project when none is given, among those where the member may create tasks", async () => {
    search = "";
    const user = userEvent.setup();
    renderWithProviders(<NewTask />);
    const choice = await screen.findByLabelText("Projet");
    expect(screen.getByRole("option", { name: "[DEMO] EV 2027" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "[DEMO] IC 2027" })).not.toBeInTheDocument();
    await user.selectOptions(choice, "1");
    expect(await screen.findByLabelText("Titre")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour au projet" })).toHaveAttribute("href", "/fr/projects/1");
  });

  it("starts a subtask from its parent: same project, subsystem and step, and a way back to it", async () => {
    search = "project=1&parent=7";
    vi.mocked(fetchTask).mockResolvedValue(
      taskDetail(7, "Modéliser le pack", {
        subsystem: { id: 2, name: "HV Battery & BMS" },
        lifecycle_step: { id: 2, step_order: 2, name: "Conception CAD" },
      }),
    );
    renderWithProviders(<NewTask />);
    expect(await screen.findByRole("heading", { name: "Nouvelle sous-tâche" })).toBeInTheDocument();
    expect(await screen.findByText("Elle fera partie de « Modéliser le pack ».")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Modéliser le pack" })).toHaveAttribute("href", "/fr/tasks/7");
    expect(await screen.findByLabelText("Sous-système")).toHaveValue("2");
    expect(await screen.findByLabelText("Étape du cycle de vie")).toHaveValue("2");
    expect(fetchTask).toHaveBeenCalledWith(7);
  });
});
