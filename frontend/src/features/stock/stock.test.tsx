import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMembers } from "@/features/members/api";
import { fetchTasks } from "@/features/work/api";
import { ApiError } from "@/lib/api/errors";
import { member, stockItem, stockMovement, task } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  addToStock,
  changeStockLine,
  countStock,
  createStockLine,
  fetchJournal,
  fetchStock,
  fetchStockItem,
  fetchStockSummary,
  takeFromStock,
  type StockItemDetail,
  type StockSummary,
} from "./api";
import { JournalPage, TaskStock } from "./journal-page";
import { NewStockLine } from "./new-stock-line";
import { StockItemView } from "./stock-item-view";
import { StockPage } from "./stock-page";

const router = { push: vi.fn() };

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "1" }),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/features/members/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members/api")>()),
  fetchMembers: vi.fn(),
}));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchTasks: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchStock: vi.fn(),
  fetchStockItem: vi.fn(),
  fetchStockSummary: vi.fn(),
  fetchJournal: vi.fn(),
  createStockLine: vi.fn(),
  changeStockLine: vi.fn(),
  takeFromStock: vi.fn(),
  addToStock: vi.fn(),
  countStock: vi.fn(),
}));

const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const BOLTS = stockItem(1, "Vis M8 × 30");
const SHRINK = stockItem(2, "Gaine thermorétractable 6 mm", {
  part: { ...BOLTS.part, id: 202, name: "Gaine thermorétractable 6 mm", category: "low_voltage", reference: "" },
  location: "Armoire électronique",
  quantity_available: 2,
  min_threshold: 2,
  is_low: true,
});
const EMPTY = stockItem(3, "Câble silicone 2,5 mm²", {
  quantity_available: 0,
  min_threshold: 2,
  is_low: true,
  location: "",
});

function summary(overrides: Partial<StockSummary> = {}): StockSummary {
  return { lines: 3, low: 2, can_manage: false, ...overrides };
}

describe("StockPage", () => {
  beforeEach(() => {
    vi.mocked(fetchStock).mockReset().mockResolvedValue([SHRINK, EMPTY, BOLTS]);
    vi.mocked(fetchStockSummary).mockResolvedValue(summary());
  });

  it("shows each line: the part, its place, how many are left, low and empty ones marked", async () => {
    renderWithProviders(<StockPage />);
    const bolts = (await screen.findByRole("link", { name: "Vis M8 × 30" })).closest("li")!;
    expect(screen.getByRole("link", { name: "Vis M8 × 30" })).toHaveAttribute("href", "/fr/stock/1");
    expect(bolts).toHaveTextContent("Atelier · ISO 4017");
    expect(bolts).toHaveTextContent("Atelier — bac A3");
    expect(bolts).toHaveTextContent("20");
    expect(bolts).toHaveTextContent("seuil 5");
    expect(within(bolts).queryByText("Bas")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gaine thermorétractable 6 mm" }).closest("li")).toHaveTextContent("Bas");
    const empty = screen.getByRole("link", { name: "Câble silicone 2,5 mm²" }).closest("li")!;
    expect(empty).toHaveTextContent("Épuisé");
    expect(empty).toHaveTextContent("Emplacement non précisé");
    expect(screen.queryByRole("link", { name: "Nouvelle ligne" })).not.toBeInTheDocument();
  });

  it("shows the low lines only, searches without accents and filters by category", async () => {
    const user = userEvent.setup();
    renderWithProviders(<StockPage />);
    await user.click(await screen.findByRole("button", { name: "Sous le seuil (2)" }));
    expect(fetchStock).toHaveBeenLastCalledWith({ low: true });
    await user.click(screen.getByRole("button", { name: "Toutes (3)" }));
    expect(fetchStock).toHaveBeenLastCalledWith({});
    await user.type(screen.getByRole("searchbox", { name: "Rechercher" }), "gaine thermo");
    await waitFor(() => expect(screen.queryByRole("link", { name: "Vis M8 × 30" })).not.toBeInTheDocument());
    await user.clear(screen.getByRole("searchbox", { name: "Rechercher" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie" }), "workshop");
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Gaine thermorétractable 6 mm" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Vis M8 × 30" })).toBeInTheDocument();
  });

  it("offers a new line to the stock managers", async () => {
    vi.mocked(fetchStockSummary).mockResolvedValue(summary({ can_manage: true }));
    renderWithProviders(<StockPage />);
    expect(await screen.findByRole("link", { name: "Nouvelle ligne" })).toHaveAttribute("href", "/fr/stock/new");
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute("href", "/fr/stock/movements");
  });
});

describe("StockItemView", () => {
  function show(item: StockItemDetail, manage: boolean) {
    vi.mocked(fetchStockItem).mockResolvedValue(item);
    vi.mocked(fetchStockSummary).mockResolvedValue(summary({ can_manage: manage }));
    return renderWithProviders(<StockItemView />);
  }

  async function header() {
    return (await screen.findByRole("heading", { level: 1 })).closest("section")!;
  }

  beforeEach(() => {
    vi.mocked(fetchMembers).mockResolvedValue([member(2, "Rayan", "Demo")]);
    vi.mocked(fetchTasks).mockResolvedValue([task(7, "Câbler le BMS")]);
  });

  it("shows how many are left and the history, and lets every member ask for a purchase", async () => {
    show(
      stockItem(1, "Vis M8 × 30", {
        quantity_available: 12,
        movements: [
          stockMovement(3, {
            movement_type: "out",
            quantity: 8,
            change: -8,
            handed_to: RAYAN,
            task: { id: 7, title: "Câbler le BMS" },
            notes: "Pour le boîtier",
          }),
          stockMovement(2, { movement_type: "adjustment", quantity: -1, change: -1, notes: "Une vis abîmée" }),
          stockMovement(1, { purchase_request_id: 5 }),
        ],
      }),
      false,
    );
    const block = await header();
    expect(block).toHaveTextContent("12");
    expect(block).toHaveTextContent("seuil 5");
    expect(within(block).getByRole("link", { name: "Demander l'achat" })).toHaveAttribute(
      "href",
      "/fr/purchasing/requests/new?part=201",
    );
    // Not a manager (once the rights are known): how to get a part, and no button.
    await waitFor(() => expect(block).toHaveTextContent("demandez-la à un gestionnaire du stock"));
    expect(within(block).queryByRole("button")).not.toBeInTheDocument();
    const history = screen.getByRole("heading", { name: "Historique" }).closest("section")!;
    const items = within(history).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("-8 sortie enregistrée par Mehdi Demo · remise à Rayan Demo");
    expect(within(items[0]).getByRole("link", { name: "Câbler le BMS" })).toHaveAttribute("href", "/fr/tasks/7");
    expect(items[0]).toHaveTextContent("« Pour le boîtier »");
    expect(items[1]).toHaveTextContent("-1 inventaire par Mehdi Demo");
    expect(items[2]).toHaveTextContent("+20 entrée enregistrée par Mehdi Demo");
    expect(within(items[2]).getByRole("link", { name: "Voir la demande d'achat" })).toHaveAttribute(
      "href",
      "/fr/purchasing/requests/5",
    );
  });

  it("lets a manager take parts out, for a task, handed to a member", async () => {
    const user = userEvent.setup();
    vi.mocked(takeFromStock).mockResolvedValue(stockItem(1, "Vis M8 × 30", { quantity_available: 12 }));
    show(BOLTS, true);
    await user.click(await within(await header()).findByRole("button", { name: "Sortir des pièces" }));
    const quantity = screen.getByRole("spinbutton", { name: "Quantité (disponible : 20)" });
    await user.clear(quantity);
    await user.type(quantity, "21");
    expect(screen.getByRole("button", { name: "Enregistrer la sortie" })).toBeDisabled();
    expect(screen.getByText("Entre 1 et 20 pièces.")).toBeInTheDocument();
    await user.clear(quantity);
    await user.type(quantity, "8");
    await screen.findByRole("option", { name: "Rayan Demo" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Remise à" }), "2");
    await user.type(screen.getByRole("searchbox", { name: "Tâche (facultatif)" }), "bms");
    await user.click(await screen.findByRole("button", { name: /Câbler le BMS/ }));
    expect(fetchTasks).toHaveBeenLastCalledWith({ search: "bms" });
    await user.type(screen.getByRole("textbox", { name: "Remarques (facultatif)" }), "Pour le boîtier");
    await user.click(screen.getByRole("button", { name: "Enregistrer la sortie" }));
    expect(takeFromStock).toHaveBeenCalledWith(1, {
      quantity: 8,
      task_id: 7,
      handed_to_id: 2,
      notes: "Pour le boîtier",
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Enregistrer la sortie" })).not.toBeInTheDocument(),
    );
  });

  it("asks why for an entry and a count, and shows the difference before counting", async () => {
    const user = userEvent.setup();
    vi.mocked(addToStock).mockResolvedValue(BOLTS);
    vi.mocked(countStock).mockRejectedValue(new ApiError(400, "Le comptage correspond au stock : rien à ajuster."));
    show(BOLTS, true);
    await user.click(await within(await header()).findByRole("button", { name: "Entrée" }));
    await user.type(screen.getByRole("spinbutton", { name: "Quantité" }), "10");
    expect(screen.getByRole("button", { name: "Enregistrer l'entrée" })).toBeDisabled(); // no reason yet
    await user.type(screen.getByRole("textbox", { name: "D'où viennent les pièces ?" }), "Don d'un sponsor");
    await user.click(screen.getByRole("button", { name: "Enregistrer l'entrée" }));
    expect(addToStock).toHaveBeenCalledWith(1, { quantity: 10, notes: "Don d'un sponsor" });

    await user.click(await screen.findByRole("button", { name: "Inventaire" }));
    await user.type(screen.getByRole("spinbutton", { name: "Quantité comptée" }), "17");
    expect(screen.getByText("Écart : -3")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Pourquoi cet écart ?" }), "3 perdues");
    await user.click(screen.getByRole("button", { name: "Enregistrer l'inventaire" }));
    expect(countStock).toHaveBeenCalledWith(1, { counted: 17, notes: "3 perdues" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Le comptage correspond au stock");
  });

  it("lets a manager change the place and the threshold", async () => {
    const user = userEvent.setup();
    vi.mocked(changeStockLine).mockResolvedValue(BOLTS);
    show(BOLTS, true);
    await user.click(await within(await header()).findByRole("button", { name: "Modifier" }));
    await user.clear(screen.getByRole("textbox", { name: "Emplacement" }));
    await user.type(screen.getByRole("textbox", { name: "Emplacement" }), "Atelier — bac B1");
    await user.clear(screen.getByRole("spinbutton", { name: "Seuil d'alerte" }));
    await user.type(screen.getByRole("spinbutton", { name: "Seuil d'alerte" }), "8");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(changeStockLine).toHaveBeenCalledWith(1, { location: "Atelier — bac B1", min_threshold: 8 });
  });

  it("cannot take from an empty line", async () => {
    show(EMPTY, true);
    expect(await within(await header()).findByRole("button", { name: "Sortir des pièces" })).toBeDisabled();
  });
});

describe("JournalPage and TaskStock", () => {
  beforeEach(() => {
    vi.mocked(fetchJournal)
      .mockReset()
      .mockResolvedValue([
        stockMovement(3, { movement_type: "out", quantity: 8, change: -8, handed_to: RAYAN }),
        stockMovement(1),
      ]);
  });

  it("lists the latest movements with their part, by kind or the viewer's own", async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalPage />);
    expect(await screen.findAllByRole("link", { name: "Vis M8 × 30" })).toHaveLength(2);
    expect(fetchJournal).toHaveBeenLastCalledWith({});
    await user.click(screen.getByRole("button", { name: "Sorties" }));
    expect(fetchJournal).toHaveBeenLastCalledWith({ type: "out" });
    await user.click(screen.getByRole("button", { name: "Les miens" }));
    expect(fetchJournal).toHaveBeenLastCalledWith({ type: "out", mine: true });
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute("aria-current", "page");
  });

  it("shows on a task's page what was taken for it, and nothing when there is none", async () => {
    const { unmount } = renderWithProviders(<TaskStock taskId={7} />);
    expect(await screen.findByRole("heading", { name: "Pièces sorties du stock" })).toBeInTheDocument();
    expect(fetchJournal).toHaveBeenLastCalledWith({ task: 7, type: "out" });
    unmount();
    vi.mocked(fetchJournal).mockResolvedValue([]);
    renderWithProviders(<TaskStock taskId={8} />);
    await waitFor(() => expect(fetchJournal).toHaveBeenLastCalledWith({ task: 8, type: "out" }));
    expect(screen.queryByRole("heading", { name: "Pièces sorties du stock" })).not.toBeInTheDocument();
  });

  it("does not repeat the task on the task's own page", async () => {
    vi.mocked(fetchJournal).mockResolvedValue([
      stockMovement(3, { movement_type: "out", quantity: 8, change: -8, task: { id: 7, title: "Câbler le BMS" } }),
    ]);
    renderWithProviders(<TaskStock taskId={7} />);
    const card = (await screen.findByRole("heading", { name: "Pièces sorties du stock" })).closest("section")!;
    expect(within(card).getByRole("link", { name: "Vis M8 × 30" })).toHaveAttribute("href", "/fr/stock/1");
    expect(card).not.toHaveTextContent("Pour la tâche");
  });
});

describe("NewStockLine", () => {
  it("creates a line for a new part with the stock already there", async () => {
    const user = userEvent.setup();
    vi.mocked(createStockLine).mockResolvedValue(stockItem(4, "Colliers de serrage"));
    renderWithProviders(<NewStockLine />);
    await user.click(screen.getByRole("button", { name: "Nouvelle pièce" }));
    await user.type(screen.getByRole("textbox", { name: "Nom de la pièce" }), "Colliers de serrage");
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie" }), "workshop");
    await user.type(screen.getByRole("textbox", { name: "Emplacement" }), "Atelier — bac A1");
    await user.clear(screen.getByRole("spinbutton", { name: "Seuil d'alerte" }));
    await user.type(screen.getByRole("spinbutton", { name: "Seuil d'alerte" }), "20");
    await user.clear(screen.getByRole("spinbutton", { name: "Quantité déjà en stock" }));
    await user.type(screen.getByRole("spinbutton", { name: "Quantité déjà en stock" }), "100");
    await user.click(screen.getByRole("button", { name: "Créer la ligne" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/stock/4"));
    expect(createStockLine).toHaveBeenCalledWith({
      new_part: { name: "Colliers de serrage", category: "workshop", reference: "" },
      location: "Atelier — bac A1",
      min_threshold: 20,
      initial_quantity: 100,
      notes: "",
    });
  });

  it("says what is missing", async () => {
    const user = userEvent.setup();
    vi.mocked(createStockLine).mockClear();
    renderWithProviders(<NewStockLine />);
    await user.click(screen.getByRole("button", { name: "Créer la ligne" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez une pièce déjà connue");
    expect(createStockLine).not.toHaveBeenCalled();
  });
});
