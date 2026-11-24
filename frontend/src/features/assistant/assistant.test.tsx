import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import {
  addSource,
  askAssistant,
  deleteSource,
  fetchAssistantRights,
  fetchConversation,
  fetchConversations,
  fetchSources,
  rereadSource,
  type Answer,
  type ConversationDetail,
  type Source,
} from "./api";
import { AssistantPage } from "./assistant-page";
import { AssistantSourcesPage } from "./sources-page";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchAssistantRights: vi.fn(),
  fetchConversations: vi.fn(),
  fetchConversation: vi.fn(),
  deleteConversation: vi.fn(),
  askAssistant: vi.fn(),
  fetchSources: vi.fn(),
  addSource: vi.fn(),
  rereadSource: vi.fn(),
  deleteSource: vi.fn(),
}));

const NADIA = { id: 4, first_name: "Nadia", last_name: "Demo" };
const QUESTION = "Combien d'avertissements avant l'exclusion ?";

const ANSWER: Answer = {
  conversation: { id: 3, title: QUESTION, created_at: "2026-10-22T10:00:00Z", updated_at: "2026-10-22T10:00:00Z" },
  question: { id: 10, role: "user", content: QUESTION, citations: [], created_at: "2026-10-22T10:00:00Z" },
  answer: {
    id: 11,
    role: "assistant",
    content: "Au troisième avertissement de la saison, le membre est exclu [1].",
    citations: [{ number: 1, source: 2, title: "Charte de l'équipe", season: 2026, page: 22 }],
    created_at: "2026-10-22T10:00:05Z",
  },
};

function source(id: number, overrides: Partial<Source> = {}): Source {
  return {
    id,
    title: "Rules book FS 2027",
    season: 2026,
    file_name: "rules-2027.pdf",
    size: 2_000_000,
    status: "ready",
    error: "",
    pages: 120,
    passages: 340,
    uploaded_by: NADIA,
    created_at: "2026-10-22T09:00:00Z",
    read_at: "2026-10-22T09:05:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAssistantRights).mockResolvedValue({ manage_sources: false, ready: true });
  vi.mocked(fetchConversations).mockResolvedValue([]);
});

describe("AssistantPage", () => {
  it("asks a question and shows the answer with its sources", async () => {
    vi.mocked(askAssistant).mockResolvedValue(ANSWER);
    const detail: ConversationDetail = { ...ANSWER.conversation, messages: [ANSWER.question, ANSWER.answer] };
    vi.mocked(fetchConversation).mockResolvedValue(detail);
    const user = userEvent.setup();
    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText("Aucune conversation pour l'instant.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sources" })).not.toBeInTheDocument(); // the Bureau's only
    await user.type(screen.getByLabelText("Votre question"), QUESTION);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(askAssistant).toHaveBeenCalledWith(QUESTION, null));
    expect(await screen.findByText(/Au troisième avertissement de la saison/)).toBeInTheDocument();
    const sources = screen.getByRole("list", { name: "Sources de la réponse" });
    expect(within(sources).getByText("[1] Charte de l'équipe, saison 2026-2027, page 22")).toBeInTheDocument();
    expect(fetchConversation).toHaveBeenCalledWith(3);
  });

  it("goes on with an earlier conversation", async () => {
    vi.mocked(fetchConversations).mockResolvedValue([ANSWER.conversation]);
    vi.mocked(fetchConversation).mockResolvedValue({
      ...ANSWER.conversation,
      messages: [ANSWER.question, ANSWER.answer],
    });
    vi.mocked(askAssistant).mockResolvedValue({
      ...ANSWER,
      question: { ...ANSWER.question, id: 12, content: "Et qui confirme ?" },
      answer: { ...ANSWER.answer, id: 13, content: "Le Bureau confirme l'exclusion [1]." },
    });
    const user = userEvent.setup();
    renderWithProviders(<AssistantPage />);
    await user.click(await screen.findByRole("button", { name: QUESTION }));
    expect(await screen.findByText(/Au troisième avertissement/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Votre question"), "Et qui confirme ?{Enter}");
    await waitFor(() => expect(askAssistant).toHaveBeenCalledWith("Et qui confirme ?", 3));
    expect(await screen.findByText(/Le Bureau confirme l'exclusion/)).toBeInTheDocument();
  });

  it("keeps the question and says so when the assistant cannot be reached", async () => {
    vi.mocked(askAssistant).mockRejectedValue(
      new ApiError(503, "L'assistant n'est pas joignable : lancez Ollama sur le serveur."),
    );
    const user = userEvent.setup();
    renderWithProviders(<AssistantPage />);
    await user.type(await screen.findByLabelText("Votre question"), "Freins ?");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText(/lancez Ollama sur le serveur/)).toBeInTheDocument();
    expect(screen.getByLabelText("Votre question")).toHaveValue("Freins ?");
  });

  it("says when no document was given yet", async () => {
    vi.mocked(fetchAssistantRights).mockResolvedValue({ manage_sources: false, ready: false });
    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText(/L'assistant n'a pas encore de documents/)).toBeInTheDocument();
  });
});

describe("AssistantSourcesPage", () => {
  it("names the pages left out of a source read", async () => {
    vi.mocked(fetchAssistantRights).mockResolvedValue({ manage_sources: true, ready: true });
    const warning = "Ces pages n'ont pas pu être lues : 7, 12. Leur texte n'est pas dans l'assistant.";
    vi.mocked(fetchSources).mockResolvedValue([source(1, { error: warning })]);
    renderWithProviders(<AssistantSourcesPage />);
    const row = (await screen.findByText("Rules book FS 2027")).closest("li")!;
    expect(within(row).getByText("Prête")).toBeInTheDocument();
    expect(within(row).getByText(warning)).toBeInTheDocument();
  });

  it("lets the Bureau drop a file, follow its reading, read it again and remove it", async () => {
    vi.mocked(fetchAssistantRights).mockResolvedValue({ manage_sources: true, ready: true });
    vi.mocked(fetchSources).mockResolvedValue([
      source(1),
      source(2, { title: "Charte (scan)", status: "failed", error: "Ce PDF ne peut pas être ouvert.", pages: 0 }),
    ]);
    vi.mocked(addSource).mockResolvedValue(source(3, { status: "reading" }));
    vi.mocked(rereadSource).mockResolvedValue(source(2, { status: "reading" }));
    vi.mocked(deleteSource).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<AssistantSourcesPage />);

    const ready = (await screen.findByText("Rules book FS 2027")).closest("li")!;
    expect(within(ready).getByText("Prête")).toBeInTheDocument();
    expect(ready).toHaveTextContent("120 pages, 340 passages");
    const failed = screen.getByText("Charte (scan)").closest("li")!;
    expect(within(failed).getByText("Ce PDF ne peut pas être ouvert.")).toBeInTheDocument();
    await user.click(within(failed).getByRole("button", { name: "Relire" }));
    await waitFor(() => expect(rereadSource).toHaveBeenCalledWith(2));

    await user.type(screen.getByLabelText("Titre"), "Règlement de la compétition");
    const file = new File(["%PDF-1.4"], "reglement.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Fichier"), file);
    await user.click(screen.getByRole("button", { name: "Déposer et lire" }));
    await waitFor(() =>
      expect(addSource).toHaveBeenCalledWith(expect.objectContaining({ title: "Règlement de la compétition", file })),
    );

    await user.click(within(ready).getByRole("button", { name: "Supprimer" }));
    expect(deleteSource).not.toHaveBeenCalled();
    await user.click(within(ready).getByRole("button", { name: "Oui, supprimer" }));
    await waitFor(() => expect(deleteSource).toHaveBeenCalledWith(1));
  });

  it("is closed to the other members", async () => {
    renderWithProviders(<AssistantSourcesPage />);
    expect(await screen.findByText("Seul le Bureau exécutif gère les sources de l'assistant.")).toBeInTheDocument();
    expect(fetchSources).not.toHaveBeenCalled();
  });
});
