import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import {
  cancelMilestone,
  completeMilestone,
  fetchDeliverable,
  fetchDeliverableActivity,
  fetchWorkMe,
  reviewSubmission,
  updateDeliverableProgress,
  type Deliverable,
  type DeliverableDetail,
  type Milestone,
  type Submission,
} from "@/features/workflow/api";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { DeliverableView } from "./deliverable-view";
import { DeliverableTable } from "./deliverables-list";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "5" }),
}));
vi.mock("@/features/workflow/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/workflow/api")>()),
  fetchDeliverable: vi.fn(),
  fetchDeliverableActivity: vi.fn(),
  fetchWorkMe: vi.fn(),
  updateDeliverableProgress: vi.fn(),
  completeMilestone: vi.fn(),
  cancelMilestone: vi.fn(),
  reviewSubmission: vi.fn(),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));

const LINA = { id: 1, first_name: "Lina", last_name: "Demo" };
const NOBODY = { id: 0, first_name: "", last_name: "" };

const NO_RIGHTS: DeliverableDetail["rights"] = {
  edit: false,
  decide: false,
  submit_proposal: false,
  assign: false,
  mark_ready: false,
  start: false,
  update_progress: false,
  manage_milestones: false,
  cancel_milestones: false,
  submit: false,
  review: false,
  cancel: false,
  reopen: false,
  add_dependency: false,
  propose_dependency: false,
  claim_relief: false,
  decide_relief: false,
  report_blocker: false,
  enter_quality: false,
};

function milestone(id: number, title: string, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    deliverable: 5,
    title,
    description: "",
    is_completed: false,
    completed_at: null,
    completed_by: NOBODY,
    is_cancelled: false,
    cancelled_at: null,
    created_by: LINA,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    referenced: false,
    ...overrides,
  };
}

function submission(id: number, number: number, overrides: Partial<Submission> = {}): Submission {
  return {
    id,
    submission_number: number,
    is_complete: true,
    is_first_complete: number === 1,
    submitted_by: LINA,
    submitted_at: "2026-11-20T10:00:00Z",
    submission_note: "",
    evidence: [{ url: "https://drive.example/cad", label: "CAO", link_type: "cad" }],
    review: null,
    ...overrides,
  };
}

function detail(overrides: Partial<DeliverableDetail> = {}, rights: Partial<DeliverableDetail["rights"]> = {}) {
  const value = {
    id: 5,
    code: "D-5",
    title: "Châssis tubulaire",
    work_order: {
      id: 3,
      code: "WO-3",
      title: "Structure",
      status: "active",
      department: { id: 1, name: "Mécanique" },
      project: { id: 1, name: "Voiture 2027" },
      season: 1,
    },
    status: "in_progress",
    dep_state: "no_blocking_dependencies",
    execution_state: "normal",
    progress: 40,
    progress_updated_at: "2026-11-10T08:00:00Z",
    start_date: "2026-11-01",
    original_deadline: "2026-12-15",
    effective_deadline: "2026-12-15",
    relief_days: 0,
    assignees: [LINA],
    proposal_status: null,
    proposed_by: NOBODY,
    allocated_points: null,
    created_at: "2026-11-01T08:00:00Z",
    description: "Souder le châssis.",
    acceptance_criteria: "Rigidité validée.",
    assignments: [],
    milestones: [],
    submissions: [],
    dependencies: { prerequisites: [], dependents: [] },
    blockers: [],
    relief: [],
    first_complete_submission_at: "",
    rights: { ...NO_RIGHTS, ...rights },
    proposal_decided_by: NOBODY,
    updated_at: "2026-11-10T08:00:00Z",
    ...overrides,
  };
  return value as unknown as DeliverableDetail;
}

function show(value: DeliverableDetail) {
  vi.mocked(fetchDeliverable).mockResolvedValue(value);
  return renderWithProviders(<DeliverableView />);
}

beforeEach(() => {
  vi.mocked(fetchDeliverable).mockReset();
  vi.mocked(fetchDeliverableActivity).mockReset().mockResolvedValue([]);
  vi.mocked(fetchWorkMe).mockResolvedValue({
    is_head: false,
    headed_department_ids: null,
    is_club_admin: false,
    current_season: null,
  });
  vi.mocked(fetchMe).mockResolvedValue(me({ id: 1, first_name: "Lina", last_name: "Demo" }));
  vi.mocked(fetchMembers).mockResolvedValue([]);
  vi.mocked(fetchOrgUnits).mockResolvedValue([]);
  vi.mocked(updateDeliverableProgress).mockReset();
  vi.mocked(completeMilestone).mockReset();
  vi.mocked(cancelMilestone).mockReset();
  vi.mocked(reviewSubmission).mockReset();
});

describe("the progress slider", () => {
  it("shows an unsaved state while editing and saves only when asked", async () => {
    const value = detail({}, { update_progress: true });
    show(value);
    const slider = await screen.findByLabelText(/Nouvel avancement/);
    expect(screen.queryByText("Non enregistré")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer l’avancement/ })).toBeDisabled();

    fireEvent.change(slider, { target: { value: "65" } });
    expect(screen.getByText("Non enregistré")).toBeInTheDocument();
    expect(updateDeliverableProgress).not.toHaveBeenCalled();
    expect(screen.getByTestId("saved-progress")).toHaveTextContent("40 %");

    vi.mocked(updateDeliverableProgress).mockResolvedValue(detail({ progress: 65 }, { update_progress: true }));
    vi.mocked(fetchDeliverable).mockResolvedValue(
      detail({ progress: 65, progress_updated_at: "2026-11-25T09:00:00Z" }, { update_progress: true }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l’avancement/ }));

    expect(updateDeliverableProgress).toHaveBeenCalledWith(5, 65, "");
    await waitFor(() => expect(screen.getByTestId("saved-progress")).toHaveTextContent("65 %"));
    expect(screen.queryByText("Non enregistré")).not.toBeInTheDocument();
    expect(screen.getByText(/Avancement enregistré : 65 %/)).toBeInTheDocument();
  });

  it("is not changed by completing a milestone", async () => {
    const rights = { update_progress: true, manage_milestones: true };
    show(detail({ milestones: [milestone(11, "Gabarit de soudure")] }, rights));
    const box = await screen.findByRole("checkbox", { name: /Gabarit de soudure/ });
    expect(box).not.toBeChecked();

    vi.mocked(completeMilestone).mockResolvedValue(milestone(11, "Gabarit de soudure", { is_completed: true }));
    vi.mocked(fetchDeliverable).mockResolvedValue(
      detail({ milestones: [milestone(11, "Gabarit de soudure", { is_completed: true })] }, rights),
    );
    await userEvent.click(box);

    expect(completeMilestone).toHaveBeenCalledWith(11, true);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Gabarit de soudure/ })).toBeChecked());
    expect(updateDeliverableProgress).not.toHaveBeenCalled();
    expect(screen.getByTestId("saved-progress")).toHaveTextContent("40 %");
    expect(screen.getByLabelText(/Nouvel avancement/)).toHaveValue("40");
  });
});

describe("milestones", () => {
  it("cannot cancel or delete a milestone a dependency refers to, and say why", async () => {
    show(
      detail(
        {
          milestones: [milestone(12, "Plan validé", { referenced: true }), milestone(13, "Brouillon de plan")],
        },
        { manage_milestones: true, cancel_milestones: true },
      ),
    );
    const referenced = (await screen.findByText("Plan validé")).closest("li") as HTMLElement;
    expect(within(referenced).getByRole("button", { name: /Annuler le jalon/ })).toBeDisabled();
    expect(within(referenced).getByRole("button", { name: /Supprimer/ })).toBeDisabled();
    expect(within(referenced).getByText(/Une dépendance s’appuie sur ce jalon/)).toBeInTheDocument();

    const free = screen.getByText("Brouillon de plan").closest("li") as HTMLElement;
    expect(within(free).getByRole("button", { name: /Annuler le jalon/ })).toBeEnabled();
    expect(cancelMilestone).not.toHaveBeenCalled();
  });
});

describe("the review form", () => {
  it("needs a severity and issues for a revision, and a reason when not attributable", async () => {
    show(detail({ status: "submitted", submissions: [submission(21, 1)] }, { review: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Demander une révision" }));
    const send = () =>
      screen
        .getAllByRole("button", { name: "Demander une révision" })
        .find((button) => button.getAttribute("type") === "submit") as HTMLElement;
    expect(send()).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Gravité de la révision"), "major");
    expect(send()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Problèmes constatés"), { target: { value: "Soudures non conformes" } });
    expect(send()).toBeEnabled();

    await userEvent.click(screen.getByLabelText("Imputable aux membres affectés"));
    expect(send()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Pourquoi la révision/), { target: { value: "Critères changés" } });
    expect(send()).toBeEnabled();

    vi.mocked(reviewSubmission).mockResolvedValue(undefined);
    await userEvent.click(send());
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Demander une révision" }));
    expect(reviewSubmission).toHaveBeenCalledWith(21, {
      decision: "revision_requested",
      review_note: "",
      severity: "major",
      issues_summary: "Soudures non conformes",
      is_attributable: false,
      attribution_reason: "Critères changés",
    });
  }, 15_000);

  it("offers the quality mark only to a club admin, and sends it only from them", async () => {
    show(detail({ status: "submitted", submissions: [submission(21, 1)] }, { review: true, enter_quality: true }));
    const mark = await screen.findByLabelText(/Note de qualité/);
    fireEvent.change(mark, { target: { value: "4.5" } });
    vi.mocked(reviewSubmission).mockResolvedValue(undefined);
    const validate = screen.getAllByRole("button", { name: "Valider" });
    await userEvent.click(validate.find((button) => button.getAttribute("type") === "submit") as HTMLElement);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Valider" }));
    expect(reviewSubmission).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ decision: "validated", raw_quality: "4.5" }),
    );
  }, 15_000);

  it("lets a Head who is not an admin validate without a quality mark", async () => {
    show(detail({ status: "submitted", submissions: [submission(21, 1)] }, { review: true, enter_quality: false }));
    await screen.findByText("Décision");
    expect(screen.queryByLabelText(/Note de qualité/)).not.toBeInTheDocument();
    vi.mocked(reviewSubmission).mockResolvedValue(undefined);
    const buttons = screen.getAllByRole("button", { name: "Valider" });
    await userEvent.click(buttons.find((button) => button.getAttribute("type") === "submit") as HTMLElement);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Valider" }));
    const body = vi.mocked(reviewSubmission).mock.calls[0][1];
    expect(body.decision).toBe("validated");
    expect(body).not.toHaveProperty("raw_quality");
  }, 15_000);

  it("shows no review form to a member", async () => {
    show(detail({ status: "submitted", submissions: [submission(21, 1)] }, { review: false }));
    await screen.findByText(/en attente de la revue/);
    expect(screen.queryByLabelText(/Note de qualité/)).not.toBeInTheDocument();
    expect(screen.queryByText("Décision")).not.toBeInTheDocument();
  });
});

describe("confidential figures", () => {
  it("hides the weight and points when the API does not send them", async () => {
    show(detail());
    await screen.findByText("Échéances");
    expect(screen.queryByText("Poids dans l’ordre de travail")).not.toBeInTheDocument();
    expect(screen.queryByText("Points alloués")).not.toBeInTheDocument();
  });

  it("shows the weight when present", async () => {
    show(detail({ weight: "40.000", progress: 30 }));
    expect(await screen.findByText("Poids dans l’ordre de travail")).toBeInTheDocument();
    expect(screen.getByText("40 %")).toBeInTheDocument();
  });

  it("gives the list no weight or points column when absent", () => {
    const row = detail() as unknown as Deliverable;
    renderWithProviders(<DeliverableTable deliverables={[row]} />);
    expect(screen.queryByRole("columnheader", { name: /Poids/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Points/ })).not.toBeInTheDocument();
  });
});
