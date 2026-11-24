import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOrgUnits } from "@/features/members/api";
import { fetchProjects } from "@/features/work/api";
import { project, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  createDocument,
  createLesson,
  downloadVersion,
  fetchDocument,
  fetchDocuments,
  fetchFolders,
  fetchLesson,
  fetchLessons,
  updateDocument,
  uploadVersion,
  type DocumentDetail,
  type DocumentVersion,
  type Folder,
  type Lesson,
} from "./api";
import { DocumentView } from "./document-view";
import { DocumentsPage } from "./documents-page";
import { FoldersPage } from "./folders-page";
import { LessonForm, LessonView, LessonsPage } from "./lessons";
import { NewDocument } from "./new-document";

const router = { replace: vi.fn() };
let search = "";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "4" }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchDocuments: vi.fn(),
  fetchFolders: vi.fn(),
  fetchDocument: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  uploadVersion: vi.fn(),
  downloadVersion: vi.fn(),
  fetchLessons: vi.fn(),
  fetchLesson: vi.fn(),
  createLesson: vi.fn(),
}));
vi.mock("@/features/members/api", () => ({ fetchOrgUnits: vi.fn(), fetchMembers: vi.fn() }));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchProjects: vi.fn(),
  fetchSubsystems: vi.fn().mockResolvedValue([]),
}));

const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const ELECTRONICS = { id: 3, code: null, name: "Electronics", type: "fs_department" } as const;
const FS_TEAM = { id: 1, code: null, name: "Formula Student Team", type: "fs_team" } as const;
const EV = { id: 1, name: "[DEMO] EV 2027" };

function version(id: number, number: number, overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    id,
    number,
    file_name: `faisceau-v${number}.pdf`,
    size: 2_500_000,
    content_type: "application/pdf",
    note: "",
    uploaded_by: RAYAN,
    uploaded_at: "2026-10-20T09:00:00Z",
    ...overrides,
  };
}

function detail(overrides: Partial<DocumentDetail> = {}): DocumentDetail {
  const first = version(10, 1);
  return {
    id: 4,
    title: "Faisceau du BMS",
    description: "Le câblage complet.",
    type: "technical_doc",
    category: "electronics",
    season: 2026,
    org_unit: ELECTRONICS,
    project: null,
    subsystem: null,
    uploaded_by: RAYAN,
    current_version: first,
    created_at: "2026-10-20T09:00:00Z",
    updated_at: "2026-10-21T09:00:00Z",
    permissions: { edit: false, delete: false },
    versions: [first],
    ...overrides,
  };
}

const FOLDERS: Folder[] = [
  { unit: ELECTRONICS, project: null, season: 2026, count: 2 },
  { unit: ELECTRONICS, project: null, season: 2025, count: 1 },
  { unit: ELECTRONICS, project: EV, season: 2026, count: 1 },
  { unit: FS_TEAM, project: EV, season: 2026, count: 1 },
  { unit: null, project: null, season: 2026, count: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
  vi.mocked(fetchOrgUnits).mockResolvedValue([unit(3, "Electronics")]);
  vi.mocked(fetchProjects).mockResolvedValue([project(1, "[DEMO] EV 2027")]);
  vi.mocked(fetchFolders).mockResolvedValue(FOLDERS);
});

describe("DocumentsPage", () => {
  it("lists the files with their season, and filters them by season", async () => {
    vi.mocked(fetchDocuments).mockResolvedValue([detail()]);
    const user = userEvent.setup();
    renderWithProviders(<DocumentsPage />);
    const row = (await screen.findByText("Faisceau du BMS")).closest("a")!;
    expect(row).toHaveAttribute("href", "/fr/documents/4");
    expect(within(row).getByText("Document technique")).toBeInTheDocument();
    expect(within(row).getByText("Électronique")).toBeInTheDocument();
    expect(within(row).getByText("Saison 2026-2027")).toBeInTheDocument();
    expect(row).toHaveTextContent("version 1 du 20 oct. 2026");
    expect(screen.queryByRole("button", { name: /À relire/ })).not.toBeInTheDocument(); // nothing is reviewed

    await screen.findByRole("option", { name: "2025-2026" });
    await user.selectOptions(screen.getByLabelText("Saison"), "2025");
    await waitFor(() => expect(fetchDocuments).toHaveBeenLastCalledWith({ season: 2025 }));
  });
});

describe("FoldersPage", () => {
  it("shows the departments, then a department's projects, adding up their files", async () => {
    const { unmount } = renderWithProviders(<FoldersPage />);
    const electronics = await screen.findByRole("link", { name: /Electronics/ });
    expect(electronics).toHaveAttribute("href", "/fr/documents/folders?unit=3");
    expect(electronics).toHaveTextContent("4 fichiers");
    expect(screen.getByRole("link", { name: /Toute l'équipe/ })).toHaveAttribute(
      "href",
      "/fr/documents/folders?unit=none",
    );
    unmount();

    search = "unit=3";
    renderWithProviders(<FoldersPage />);
    expect(await screen.findByRole("link", { name: /Aucun projet/ })).toHaveAttribute(
      "href",
      "/fr/documents/folders?unit=3&project=none",
    );
    expect(screen.getByRole("link", { name: /\[DEMO\] EV 2027/ })).toHaveTextContent("1 fichier");
    expect(screen.getByRole("link", { name: "Tous les dossiers" })).toHaveAttribute("href", "/fr/documents/folders");
  });

  it("lists a season's files, and adds a file in that folder", async () => {
    search = "unit=3&project=none&season=2026";
    vi.mocked(fetchDocuments).mockResolvedValue([detail()]);
    renderWithProviders(<FoldersPage />);
    expect(await screen.findByText("Faisceau du BMS")).toBeInTheDocument();
    expect(fetchDocuments).toHaveBeenCalledWith({ unit: "3", project: "none", season: 2026 });
    expect(screen.getByRole("link", { name: "Ajouter un fichier ici" })).toHaveAttribute(
      "href",
      "/fr/documents/new?unit=3&season=2026",
    );
    const path = screen.getByRole("navigation", { name: "Chemin du dossier" });
    expect(within(path).getByText("2026-2027").closest("span")).toHaveAttribute("aria-current", "page");
  });
});

describe("NewDocument", () => {
  it("uploads a file in the folder it was opened from, published at once", async () => {
    search = "unit=3&project=1&season=2025";
    vi.mocked(createDocument).mockResolvedValue(detail({ id: 9 }));
    const user = userEvent.setup();
    renderWithProviders(<NewDocument />);
    await user.type(screen.getByLabelText("Titre"), "Faisceau du BMS");
    await user.selectOptions(screen.getByLabelText("Catégorie"), "electronics");
    await screen.findByRole("option", { name: "Electronics" });
    expect(screen.getByLabelText("Unité")).toHaveValue("3");
    expect(screen.getByLabelText("Saison")).toHaveValue("2025");
    expect(screen.queryByText("Envoyer en relecture maintenant")).not.toBeInTheDocument();
    const file = new File(["%PDF-1.4"], "faisceau.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Fichier"), file);
    await user.click(screen.getByRole("button", { name: "Ajouter le document" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/documents/9"));
    expect(createDocument).toHaveBeenCalledWith({
      title: "Faisceau du BMS",
      description: "",
      type: "technical_doc",
      category: "electronics",
      org_unit_id: 3,
      project_id: 1,
      subsystem_id: null,
      season: 2025,
      file,
      note: "",
    });
  });
});

describe("DocumentView", () => {
  it("downloads the current version and shows its season", async () => {
    vi.mocked(fetchDocument).mockResolvedValue(detail());
    vi.mocked(downloadVersion).mockResolvedValue(undefined);
    renderWithProviders(<DocumentView />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Télécharger" }));
    await waitFor(() => expect(downloadVersion).toHaveBeenCalledWith(4, detail().current_version));
    expect(screen.getByText("2026-2027")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approuver" })).not.toBeInTheDocument();
  });

  it("lets its people upload a new version, current at once", async () => {
    vi.mocked(fetchDocument).mockResolvedValue(detail({ permissions: { edit: true, delete: false } }));
    vi.mocked(uploadVersion).mockResolvedValue(version(12, 2));
    const user = userEvent.setup();
    renderWithProviders(<DocumentView />);
    await user.click(await screen.findByRole("button", { name: "Nouvelle version" }));
    const file = new File(["%PDF-1.4"], "faisceau-v2.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Fichier"), file);
    await user.type(screen.getByLabelText("Ce qui change (facultatif)"), "Fusibles ajoutés");
    await user.click(screen.getByRole("button", { name: "Envoyer la version" }));
    await waitFor(() => expect(uploadVersion).toHaveBeenCalledWith(4, file, "Fusibles ajoutés"));
  });

  it("moves a document to another season", async () => {
    vi.mocked(fetchDocument).mockResolvedValue(detail({ permissions: { edit: true, delete: false } }));
    vi.mocked(updateDocument).mockResolvedValue(detail({ season: 2025 }));
    const user = userEvent.setup();
    renderWithProviders(<DocumentView />);
    await user.click(await screen.findByRole("button", { name: "Modifier" }));
    await user.selectOptions(screen.getByLabelText("Saison"), "2025");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(updateDocument).toHaveBeenCalledWith(4, expect.objectContaining({ season: 2025 })));
  });
});

describe("Lessons learned", () => {
  const lesson: Lesson = {
    id: 7,
    title: "Cellules arrivées en retard",
    problem: "Les cellules sont arrivées 3 semaines en retard.",
    context: "Commande en mars.",
    root_cause: "Un seul fournisseur.",
    solution: "Deux fournisseurs consultés.",
    result: "Livraison à temps.",
    next_time: "Commander 2 mois avant.",
    org_unit: { id: 3, code: null, name: "Electronics", type: "fs_department" },
    project: null,
    category: "electronics",
    author: RAYAN,
    created_at: "2026-10-21T09:00:00Z",
    updated_at: "2026-10-21T09:00:00Z",
    permissions: { edit: true, delete: false },
  };

  it("lists the lessons and opens one with its sections", async () => {
    vi.mocked(fetchLessons).mockResolvedValue([lesson]);
    vi.mocked(fetchLesson).mockResolvedValue(lesson);
    const { unmount } = renderWithProviders(<LessonsPage />);
    expect((await screen.findByText("Cellules arrivées en retard")).closest("a")).toHaveAttribute(
      "href",
      "/fr/documents/lessons/7",
    );
    unmount();
    renderWithProviders(<LessonView />);
    expect(await screen.findByRole("heading", { level: 1, name: "Cellules arrivées en retard" })).toBeInTheDocument();
    expect(screen.getByText("À faire autrement la prochaine fois").nextElementSibling).toHaveTextContent(
      "Commander 2 mois avant.",
    );
    expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  });

  it("lets any member write a lesson", async () => {
    vi.mocked(createLesson).mockResolvedValue(lesson);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<LessonForm onSaved={onSaved} />);
    await user.type(screen.getByLabelText("Titre"), "Cellules arrivées en retard");
    await user.type(screen.getByLabelText("Problème"), "3 semaines de retard");
    await user.type(screen.getByLabelText("À faire autrement la prochaine fois"), "Commander plus tôt");
    await user.click(screen.getByRole("button", { name: "Publier le retour" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(lesson));
    expect(createLesson).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Cellules arrivées en retard",
        problem: "3 semaines de retard",
        next_time: "Commander plus tôt",
        org_unit_id: null,
      }),
    );
  });
});
