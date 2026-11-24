import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import {
  addComment,
  addLink,
  decideBlocker,
  declareBlocker,
  deleteComment,
  deleteTask,
  fetchTask,
  resolveBlocker,
  reviseTask,
  startTask,
  submitTask,
  updateProgress,
  validateTask,
  type TaskDetail,
} from "@/features/work/api";
import { ApiError } from "@/lib/api/errors";
import { blocker, me, taskDetail } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { TaskView } from "./task-view";

const router = { replace: vi.fn() };

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "7" }),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchTask: vi.fn(),
  deleteTask: vi.fn(),
  addComment: vi.fn(),
  deleteComment: vi.fn(),
  addLink: vi.fn(),
  startTask: vi.fn(),
  submitTask: vi.fn(),
  validateTask: vi.fn(),
  reviseTask: vi.fn(),
  declareBlocker: vi.fn(),
  decideBlocker: vi.fn(),
  resolveBlocker: vi.fn(),
  updateProgress: vi.fn(),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));
vi.mock("@/features/stock/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/stock/api")>()),
  fetchJournal: vi.fn(async () => []),
}));

const LINA = { id: 1, first_name: "Lina", last_name: "Demo" };
const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };

const pack = taskDetail(7, "Modéliser le pack batterie en CAO", {
  status: "in_progress",
  priority: "high",
  due_date: "2026-10-22",
  description: "Laisser de la place pour le refroidissement.",
  subsystem: { id: 2, name: "HV Battery & BMS" },
  lifecycle_step: { id: 2, step_order: 2, name: "Conception CAD" },
  assignees: [
    { member: RAYAN, is_primary: true },
    { member: LINA, is_primary: false },
  ],
  subtasks: [
    { id: 8, title: "Boîtier et fixations", status: "planned", priority: null, due_date: null, assignees: [] },
  ],
  comments: [
    {
      id: 30,
      author: RAYAN,
      content: "Les cellules arrivent lundi.",
      created_at: "2026-10-17T15:00:00Z",
      can_delete: false,
    },
    { id: 31, author: LINA, content: "Merci !", created_at: "2026-10-17T16:00:00Z", can_delete: true },
  ],
});

function show(task: TaskDetail = pack) {
  vi.mocked(fetchTask).mockResolvedValue(task);
  return renderWithProviders(<TaskView />);
}

/** The block with the task itself (title, status, actions, details). */
async function summary() {
  return (await screen.findByRole("heading", { level: 1 })).closest("section")!;
}

function comments() {
  return screen.getByRole("heading", { name: /^Commentaires/ }).closest("section")!;
}

const RIGHTS = pack.permissions;
const ESTIMATED = { points: 3, start_date: "2026-10-19", due_date: "2026-10-30" } as const;

describe("TaskView", () => {
  beforeEach(() => {
    router.replace.mockReset();
    vi.mocked(fetchTask).mockReset();
    vi.mocked(deleteTask).mockReset().mockResolvedValue(undefined);
    vi.mocked(fetchMe).mockResolvedValue(me({ id: 1, first_name: "Lina", last_name: "Demo" }));
    vi.mocked(fetchMembers).mockResolvedValue([]);
    vi.mocked(fetchOrgUnits).mockResolvedValue([]);
    for (const call of [startTask, submitTask, validateTask, reviseTask]) {
      vi.mocked(call).mockReset().mockResolvedValue(pack);
    }
  });

  it("shows the task: its state, its place in the project, its people, subtasks and discussion", async () => {
    show();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Modéliser le pack batterie en CAO" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "[DEMO] EV 2027" })).toHaveAttribute("href", "/fr/projects/1");
    expect(screen.getByText("Laisser de la place pour le refroidissement.")).toBeInTheDocument();
    expect(screen.getByText("HV Battery & BMS")).toBeInTheDocument();
    expect(screen.getByText("2. Conception CAD")).toBeInTheDocument();
    expect(
      within(await summary())
        .getByText("Rayan Demo")
        .closest("li"),
    ).toHaveTextContent("Principale");
    expect(screen.getByRole("link", { name: "Boîtier et fixations" })).toHaveAttribute("href", "/fr/tasks/8");
    expect(within(comments()).getByText("Les cellules arrivent lundi.")).toBeInTheDocument();
    // Only one's own comments can be deleted.
    expect(within(comments()).getAllByRole("button", { name: "Supprimer" })).toHaveLength(1);
  });

  it("shows the work order: its reference, its health and how far it is", async () => {
    show({ ...pack, progress: 40, health: "at_risk", current_phase: "Modélisation", next_step: "Revue" });
    const top = await summary();
    expect(within(top).getByText("EV27-007")).toBeInTheDocument();
    expect(within(top).getByText("À risque")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Avancement" }).closest("section")!;
    expect(within(card).getByText("40 %")).toBeInTheDocument();
    expect(within(card).getByText("Modélisation")).toBeInTheDocument();
    expect(within(card).getByText("Revue")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Enregistrer l'avancement" })).not.toBeInTheDocument();
  });

  it("lets its people update its progress, its phase and its next step", async () => {
    const mine = { ...pack, permissions: { ...RIGHTS, update_progress: true } };
    vi.mocked(updateProgress).mockResolvedValue({ ...mine, progress: 60 });
    show(mine);
    const user = userEvent.setup();
    const card = (await screen.findByRole("heading", { name: "Avancement" })).closest("section")!;
    const slider = within(card).getByRole("slider", { name: /Avancement/ });
    fireEvent.change(slider, { target: { value: "10" } });
    await user.type(within(card).getByLabelText("Phase en cours"), "Assemblage");
    await user.type(within(card).getByLabelText("Prochaine étape"), "Essais");
    await user.click(within(card).getByRole("button", { name: "Enregistrer l'avancement" }));
    expect(await within(card).findByText("Avancement enregistré.")).toBeInTheDocument();
    expect(updateProgress).toHaveBeenCalledWith(7, { progress: 10, current_phase: "Assemblage", next_step: "Essais" });
  });

  it("follows the subtasks without a slider when the task has some", async () => {
    show({ ...pack, progress_mode: "automatic", progress: 50, permissions: { ...RIGHTS, update_progress: true } });
    const card = (await screen.findByRole("heading", { name: "Avancement" })).closest("section")!;
    expect(within(card).getByText("Calculé à partir des sous-tâches validées")).toBeInTheDocument();
    expect(within(card).queryByRole("slider")).not.toBeInTheDocument();
  });

  it("lists the links of the task, opened safely in a new tab", async () => {
    const added = { added_by: RAYAN, created_at: "2026-10-17T10:00:00Z" };
    show({
      ...pack,
      links: [
        {
          id: 1,
          url: "https://example.com/demo/cad/battery-pack",
          label: "Maquette CAO (démo)",
          link_type: "cad",
          ...added,
        },
        { id: 2, url: "javascript:alert(1)", label: "Piège", link_type: "other", ...added },
      ],
    });
    const link = await screen.findByRole("link", { name: "Maquette CAO (démo)" });
    expect(link).toHaveAttribute("href", "https://example.com/demo/cad/battery-pack");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.closest("li")).toHaveTextContent("CAO");
    // Not a web address: shown as text, never as a link that would run code.
    expect(screen.getByText("Piège")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Piège" })).not.toBeInTheDocument();
  });

  it("shows no links block to someone who may not add any when the task has none", async () => {
    show({ ...pack, assignees: [], permissions: { ...RIGHTS, edit: false } });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("heading", { name: "Liens" })).not.toBeInTheDocument();
  });

  it("adds a link, for the people of the task", async () => {
    vi.mocked(addLink).mockResolvedValue({
      id: 3,
      url: "https://example.com/demo/report",
      label: "",
      link_type: "report",
      added_by: LINA,
      created_at: "2026-10-20T10:00:00Z",
    });
    const user = userEvent.setup();
    show({ ...pack, permissions: { ...RIGHTS, edit: false } }); // Lina is assigned to it
    await user.click(await screen.findByRole("button", { name: "Ajouter un lien" }));
    await user.type(screen.getByLabelText("Adresse du lien"), "https://example.com/demo/report");
    await user.selectOptions(screen.getByLabelText("Type"), "report");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await waitFor(() =>
      expect(addLink).toHaveBeenCalledWith(7, {
        url: "https://example.com/demo/report",
        label: "",
        link_type: "report",
      }),
    );
  });

  it("shows its points, dates and expected deliverable", async () => {
    show({
      ...pack,
      ...ESTIMATED,
      initial_due_date: "2026-10-27",
      deliverable: "Une maquette CAO complète",
      success_criteria: "Le pack tient dans le châssis",
    });
    const task = await summary();
    expect(within(task).getByText("3 pts")).toBeInTheDocument();
    expect(within(task).getByText("3 · Complexe")).toBeInTheDocument();
    expect(within(task).getByText("19 oct. 2026")).toBeInTheDocument();
    expect(within(task).getByText("Échéance d'origine : 27 oct. 2026")).toBeInTheDocument();
    expect(within(task).getByText("Une maquette CAO complète")).toBeInTheDocument();
    expect(within(task).getByText("Le pack tient dans le châssis")).toBeInTheDocument();
  });

  it("starts a planned task once a leader has set its points and dates", async () => {
    const user = userEvent.setup();
    show({ ...pack, status: "planned", permissions: { ...RIGHTS, start: true } });
    expect(
      await screen.findByText(
        "Un chef d'unité ou le chef de projet doit d'abord fixer les points, la date de début et l'échéance.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Commencer le travail" })).not.toBeInTheDocument();

    show({ ...pack, ...ESTIMATED, status: "planned", permissions: { ...RIGHTS, start: true } });
    await user.click(await screen.findByRole("button", { name: "Commencer le travail" }));
    await waitFor(() => expect(startTask).toHaveBeenCalledWith(7));
  });

  it("submits what was delivered with its proof, a link required while the task has none", async () => {
    const user = userEvent.setup();
    show({ ...pack, permissions: { ...RIGHTS, submit: true } });
    await user.click(await screen.findByRole("button", { name: "Soumettre" }));
    await user.type(screen.getByLabelText("Livrable rendu"), "La maquette du pack");
    const send = screen.getByRole("button", { name: "Soumettre pour validation" });
    expect(send).toBeDisabled(); // no link yet
    await user.type(screen.getByLabelText("Adresse du lien"), "https://example.com/demo/cad");
    await user.click(send);
    await waitFor(() =>
      expect(submitTask).toHaveBeenCalledWith(7, {
        actual_deliverable: "La maquette du pack",
        evidence_url: "https://example.com/demo/cad",
        evidence_label: "",
        evidence_type: "other",
      }),
    );
  });

  it("lets a leader validate a submitted task with its quality mark, or send it back", async () => {
    const user = userEvent.setup();
    show({
      ...pack,
      status: "submitted",
      actual_deliverable: "La maquette",
      permissions: { ...RIGHTS, validate: true },
    });
    await user.click(await screen.findByRole("button", { name: "Valider" }));
    const confirm = screen.getByRole("button", { name: "Valider avec cette note" });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "4 · Bon" }));
    await user.click(confirm);
    await waitFor(() => expect(validateTask).toHaveBeenCalledWith(7, 4));

    await user.click(await screen.findByRole("button", { name: "À reprendre" }));
    await user.type(screen.getByLabelText("Ce qu'il faut reprendre"), "Ajouter les fixations");
    await user.click(screen.getByRole("button", { name: "Renvoyer" }));
    await waitFor(() => expect(reviseTask).toHaveBeenCalledWith(7, "Ajouter les fixations"));
  });

  it("says what to rework, and that a submitted task awaits a leader", async () => {
    show({
      ...pack,
      status: "needs_revision",
      events: [
        {
          id: 1,
          kind: "revision",
          actor: LINA,
          data: { comment: "Ajouter les fixations" },
          created_at: "2026-10-18T09:00:00Z",
        },
      ],
    });
    expect(await screen.findByText("À reprendre : « Ajouter les fixations »")).toBeInTheDocument();

    show({ ...pack, status: "submitted" });
    expect(
      await screen.findByText("Soumise : elle attend la validation d'un chef et sa note de qualité."),
    ).toBeInTheDocument();
  });

  it("declares a blocker", async () => {
    vi.mocked(declareBlocker).mockResolvedValue(blocker(40, "Pas de sertisseuse"));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: "Déclarer un blocage" }));
    await user.type(screen.getByLabelText("Ce qui bloque"), "Pas de sertisseuse");
    await user.selectOptions(screen.getByLabelText("Gravité"), "high");
    await user.click(screen.getByRole("button", { name: "Déclarer" }));
    await waitFor(() =>
      expect(declareBlocker).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ description: "Pas de sertisseuse", severity: "high", origin: "technical" }),
      ),
    );
  });

  it("lets a leader validate or reject a blocker, and its people solve it", async () => {
    const open = blocker(40, "Pas de sertisseuse", { is_late: true, permissions: { decide: true, resolve: true } });
    vi.mocked(decideBlocker).mockResolvedValue(open);
    vi.mocked(resolveBlocker).mockResolvedValue(open);
    const user = userEvent.setup();
    show({ ...pack, is_blocked: true, blockers: [open] });
    const blockers = await screen.findByRole("heading", { level: 2, name: "Blocages (1)" });
    expect(within(blockers.closest("section")!).getByText("Déclaré en retard")).toBeInTheDocument();
    expect(within(await summary()).getByText("Bloquée")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Valider le blocage" }));
    await waitFor(() => expect(decideBlocker).toHaveBeenCalledWith(7, 40, true, undefined));

    await user.click(screen.getByRole("button", { name: "Rejeter" }));
    await user.type(screen.getByLabelText("Pourquoi il est rejeté"), "La sertisseuse du club est disponible");
    await user.click(screen.getByRole("button", { name: "Rejeter" }));
    await waitFor(() =>
      expect(decideBlocker).toHaveBeenCalledWith(7, 40, false, "La sertisseuse du club est disponible"),
    );

    await user.click(await screen.findByRole("button", { name: "Marquer comme résolu" }));
    await user.type(screen.getByLabelText("Comment il a été résolu"), "Prêtée par l'atelier");
    await user.click(screen.getByRole("button", { name: "Résolu" }));
    await waitFor(() => expect(resolveBlocker).toHaveBeenCalledWith(7, 40, "Prêtée par l'atelier"));
  });

  it("shows its history, newest first", async () => {
    show({
      ...pack,
      events: [
        { id: 1, kind: "created", actor: LINA, data: {}, created_at: "2026-10-17T09:00:00Z" },
        {
          id: 2,
          kind: "estimated",
          actor: LINA,
          data: { points: "3", start_date: "2026-10-19", due_date: "2026-10-30" },
          created_at: "2026-10-17T09:05:00Z",
        },
        {
          id: 3,
          kind: "deadline_moved",
          actor: RAYAN,
          data: { before: "2026-10-30", after: "2026-11-02", days: 3 },
          created_at: "2026-10-20T10:00:00Z",
        },
      ],
    });
    const history = (await screen.findByRole("heading", { level: 2, name: "Historique" })).closest("section")!;
    const items = within(history).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByText(/^(Créée|Points et dates fixés|Échéance repoussée)$/).textContent),
    ).toEqual(["Échéance repoussée", "Points et dates fixés", "Créée"]);
    expect(within(items[0]).getByText("Du 30 oct. 2026 au 2 nov. 2026 (+3 j)")).toBeInTheDocument();
    expect(within(items[1]).getByText("3 pts · début 19 oct. 2026 · échéance 30 oct. 2026")).toBeInTheDocument();
  });

  it("deletes the task only after confirmation, warns about its subtasks, and does not load it again", async () => {
    const user = userEvent.setup();
    show();
    const task = await summary();
    await user.click(within(task).getByRole("button", { name: "Supprimer" }));
    expect(deleteTask).not.toHaveBeenCalled();
    expect(within(task).getByText("Sa sous-tâche sera aussi supprimée.")).toBeInTheDocument();

    await user.click(within(task).getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/projects/1"));
    expect(deleteTask).toHaveBeenCalledWith(7);
    // Loading the deleted task again would only show an error while the project page opens.
    expect(fetchTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("posts a comment, and deletes one only after confirmation", async () => {
    vi.mocked(addComment).mockResolvedValue(pack.comments[1]);
    vi.mocked(deleteComment).mockResolvedValue(undefined);
    const user = userEvent.setup();
    show();
    await user.type(await screen.findByLabelText("Ajouter un commentaire"), "  Reçu, merci.  ");
    await user.click(screen.getByRole("button", { name: "Publier" }));
    await waitFor(() => expect(addComment).toHaveBeenCalledWith(7, "Reçu, merci."));
    await waitFor(() => expect(screen.getByLabelText("Ajouter un commentaire")).toHaveValue(""));

    await user.click(within(comments()).getByRole("button", { name: "Supprimer" }));
    await user.click(within(comments()).getByRole("button", { name: "Annuler" }));
    expect(deleteComment).not.toHaveBeenCalled();

    await user.click(within(comments()).getByRole("button", { name: "Supprimer" }));
    await user.click(within(comments()).getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith(7, 31));
  });

  it("names the parent of a subtask, and goes back to it", async () => {
    const user = userEvent.setup();
    show(
      taskDetail(9, "Boîtier et fixations", {
        parent: { id: 7, title: "Modéliser le pack batterie en CAO" },
        parent_id: 7,
      }),
    );
    const parentLinks = await screen.findAllByRole("link", { name: "Modéliser le pack batterie en CAO" });
    expect(parentLinks.map((link) => link.getAttribute("href"))).toEqual(["/fr/tasks/7", "/fr/tasks/7"]);
    expect(screen.getByText(/Sous-tâche de/)).toHaveTextContent("Sous-tâche de « Modéliser le pack batterie en CAO »");
    expect(screen.queryByRole("link", { name: "Ajouter une sous-tâche" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tasks/7"));
  });

  it("says plainly when the task does not exist", async () => {
    vi.mocked(fetchTask).mockRejectedValue(new ApiError(404, "Aucun objet Task ne correspond à cette requête."));
    renderWithProviders(<TaskView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Élément introuvable : il a peut-être été supprimé.");
  });
});
