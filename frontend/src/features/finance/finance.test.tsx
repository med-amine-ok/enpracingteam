import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { clubToday } from "@/lib/dates";
import { member, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  changeBudget,
  changeExpense,
  createBudget,
  createExpense,
  createSponsor,
  fetchBudget,
  fetchBudgets,
  fetchExpenses,
  fetchFinanceSummary,
  fetchSponsors,
  fetchSponsorSummary,
  recordInvoice,
  type Budget,
  type BudgetDetail,
  type Expense,
  type FinanceSummary,
  type Sponsorship,
} from "./api";
import { BudgetView } from "./budget-view";
import { BudgetsPage } from "./budgets-page";
import { ExpensesPage } from "./expenses-page";
import { NewExpense } from "./new-expense";
import { PurchaseFinance } from "./purchase-finance";
import { SponsorsPage } from "./sponsors-page";

const router = { push: vi.fn() };
const address = { search: new URLSearchParams() };

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "2" }),
  useSearchParams: () => address.search,
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/features/members/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members/api")>()),
  fetchMembers: vi.fn(),
  fetchOrgUnits: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchFinanceSummary: vi.fn(),
  fetchBudgets: vi.fn(),
  fetchBudget: vi.fn(),
  createBudget: vi.fn(),
  changeBudget: vi.fn(),
  fetchExpenses: vi.fn(),
  createExpense: vi.fn(),
  changeExpense: vi.fn(),
  deleteExpense: vi.fn(),
  recordInvoice: vi.fn(),
  fetchSponsors: vi.fn(),
  fetchSponsorSummary: vi.fn(),
  createSponsor: vi.fn(),
  changeSponsor: vi.fn(),
  deleteSponsor: vi.fn(),
}));

const FS = unit(1, "Équipe FS", { type: "fs_team" });
const ELEC = unit(2, "Électronique", { type: "fs_department", parent: 1 });
const AERO = unit(3, "Aérodynamique", { type: "fs_department", parent: 1 });
const OFFICE = unit(4, "Bureau des projets");

function budget(orgUnit: typeof FS, overrides: Partial<Budget> = {}): Budget {
  return {
    id: orgUnit.id,
    org_unit: { id: orgUnit.id, code: null, name: orgUnit.name, type: orgUnit.type },
    parent_unit_id: orgUnit.parent ?? null,
    fiscal_year: "2026-2027",
    allocated_amount: "200000.00",
    spent: "0.00",
    committed: "0.00",
    remaining: "200000.00",
    spent_percent: 0,
    is_over: false,
    will_exceed: false,
    notes: "",
    updated_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

const FS_BUDGET = budget(FS, { allocated_amount: "900000.00", spent: "225000.00", remaining: "675000.00" });
const ELEC_BUDGET = budget(ELEC, { allocated_amount: "250000.00", spent: "233750.00", remaining: "16250.00" });
const AERO_BUDGET = budget(AERO, {
  allocated_amount: "100000.00",
  spent: "120000.00",
  remaining: "-20000.00",
  is_over: true,
  will_exceed: true,
});

function summary(overrides: Partial<FinanceSummary> = {}): FinanceSummary {
  return {
    fiscal_year: "2026-2027",
    can_manage: false,
    can_see_all: false,
    can_see_budgets: true,
    can_see_sponsors: false,
    can_manage_sponsors: false,
    budgets: 3,
    over_budget: 0,
    to_impute: null,
    ...overrides,
  };
}

const MEHDI = { id: 9, first_name: "Mehdi", last_name: "Demo" };

function expense(id: number, overrides: Partial<Expense> = {}): Expense {
  return {
    id,
    budget: {
      id: 2,
      org_unit: { id: 2, code: null, name: "Électronique", type: "fs_department" },
      fiscal_year: "2026-2027",
    },
    fiscal_year: "2026-2027",
    amount: "2000.00",
    category: "purchase",
    description: "",
    recorded_at: "2026-10-15",
    recorded_by: MEHDI,
    purchase_request_id: 7,
    part: "Connecteurs haute tension",
    supplier: "Fournisseur Exemple",
    invoice: null,
    suggested_unit: null,
    created_at: "2026-10-15T10:00:00Z",
    ...overrides,
  };
}

const TAXI = expense(3, {
  amount: "300.00",
  category: "transport",
  description: "Taxi vers l'atelier",
  purchase_request_id: null,
  part: null,
  supplier: null,
  recorded_at: "2026-10-17",
});

beforeEach(() => {
  address.search = new URLSearchParams();
  router.push.mockReset();
  vi.mocked(fetchFinanceSummary).mockReset().mockResolvedValue(summary());
  vi.mocked(fetchOrgUnits).mockResolvedValue([FS, ELEC, AERO, OFFICE]);
  vi.mocked(fetchBudgets).mockReset().mockResolvedValue([ELEC_BUDGET, FS_BUDGET, AERO_BUDGET]);
});

describe("BudgetsPage", () => {
  it("shows each budget under the unit above, with what is spent and left, the exceeded ones marked", async () => {
    renderWithProviders(<BudgetsPage />);
    const rows = await screen.findAllByRole("link", { name: /Équipe FS|Électronique|Aérodynamique/ });
    expect(rows.map((row) => row.textContent)).toEqual(["Équipe FS", "Aérodynamique", "Électronique"]);
    expect(fetchBudgets).toHaveBeenCalledWith("2026-2027");
    expect(screen.getByRole("link", { name: "Équipe FS" })).toHaveAttribute("href", "/fr/finance/budgets/1");
    const fs = screen.getByRole("link", { name: "Équipe FS" }).closest("li")!;
    expect(fs).toHaveTextContent("225 000 DA dépensés sur 900 000 DA");
    expect(fs).toHaveTextContent("reste 675 000 DA");
    expect(within(fs).getByRole("meter")).toHaveAccessibleName("Part du budget dépensée");
    const aero = screen.getByRole("link", { name: "Aérodynamique" }).closest("li")!;
    expect(aero).toHaveTextContent("Dépassé");
    expect(aero).toHaveTextContent("reste -20 000 DA");
    expect(screen.getByText("Alloué").nextSibling).toHaveTextContent("1 250 000 DA");
    expect(screen.queryByRole("button", { name: "Nouveau budget" })).not.toBeInTheDocument();
  });

  it("explains who sees the budgets to the other members", async () => {
    vi.mocked(fetchFinanceSummary).mockResolvedValue(summary({ can_see_budgets: false, budgets: 0 }));
    renderWithProviders(<BudgetsPage />);
    expect(await screen.findByText("Les budgets ne sont pas visibles pour toi")).toBeInTheDocument();
    expect(fetchBudgets).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Voir les sponsors" })).not.toBeInTheDocument();
  });

  it("shows another year", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BudgetsPage />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Année budgétaire" }), "2025-2026");
    await waitFor(() => expect(fetchBudgets).toHaveBeenLastCalledWith("2025-2026"));
  });

  it("lets the treasurer create the budget of a unit that has none", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFinanceSummary).mockResolvedValue(summary({ can_manage: true, can_see_all: true, to_impute: 2 }));
    vi.mocked(createBudget).mockResolvedValue({} as BudgetDetail);
    renderWithProviders(<BudgetsPage />);
    expect(await screen.findByRole("link", { name: "2 dépenses à imputer" })).toHaveAttribute(
      "href",
      "/fr/finance/expenses?view=to_impute",
    );
    await user.click(screen.getByRole("button", { name: "Nouveau budget" }));
    const unitSelect = screen.getByRole("combobox", { name: "Unité" });
    expect(
      within(unitSelect)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Choisir une unité", "Bureau des projets"]);
    await user.selectOptions(unitSelect, "4");
    await user.type(screen.getByRole("spinbutton", { name: "Montant alloué (DA)" }), "50000");
    await user.type(screen.getByRole("textbox", { name: "Notes" }), "Voté en AG");
    await user.click(screen.getByRole("button", { name: "Créer le budget" }));
    expect(createBudget).toHaveBeenCalledWith({
      org_unit: 4,
      fiscal_year: "2026-2027",
      allocated_amount: "50000",
      notes: "Voté en AG",
    });
  });
});

describe("BudgetView", () => {
  const DETAIL: BudgetDetail = {
    ...ELEC_BUDGET,
    committed: "10000.00",
    remaining: "6250.00",
    notes: "Voté en AG",
    expenses: [expense(5), TAXI],
    committed_orders: [
      {
        purchase_request_id: 8,
        part: "Plaque aluminium",
        supplier: "Atelier Laser",
        ordered_at: "2026-10-08",
        total_dzd: "10000.00",
      },
    ],
    children: [],
    with_children: { allocated_amount: "250000.00", spent: "233750.00", committed: "10000.00", remaining: "6250.00" },
  };

  beforeEach(() => {
    vi.mocked(fetchBudget).mockReset().mockResolvedValue(DETAIL);
  });

  it("shows its figures, its orders in progress and its expenses", async () => {
    renderWithProviders(<BudgetView />);
    expect(await screen.findByRole("heading", { level: 1, name: "Électronique" })).toBeInTheDocument();
    expect(fetchBudget).toHaveBeenCalledWith(2);
    expect(screen.getByText("Année 2026-2027")).toBeInTheDocument();
    expect(screen.getByText("Voté en AG")).toBeInTheDocument();
    expect(screen.getByText("Engagé").nextSibling).toHaveTextContent("10 000 DA");
    expect(screen.getByRole("link", { name: "Plaque aluminium" })).toHaveAttribute("href", "/fr/purchasing/requests/8");
    const order = screen.getByRole("link", { name: "Connecteurs haute tension" }).closest("li")!;
    expect(order).toHaveTextContent("Achat");
    expect(order).toHaveTextContent("Fournisseur Exemple");
    expect(order).toHaveTextContent("2 000 DA");
    expect(screen.getByText("Taxi vers l'atelier").closest("li")).toHaveTextContent("Transport");
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
  });

  it("lets the treasurer change the allocated amount", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFinanceSummary).mockResolvedValue(summary({ can_manage: true, can_see_all: true }));
    vi.mocked(changeBudget).mockResolvedValue({ ...DETAIL, allocated_amount: "300000.00" });
    renderWithProviders(<BudgetView />);
    expect(await screen.findByRole("link", { name: "Nouvelle dépense" })).toHaveAttribute(
      "href",
      "/fr/finance/expenses/new?budget=2",
    );
    const [editBudget] = screen.getAllByRole("button", { name: "Modifier" });
    await user.click(editBudget);
    const amount = screen.getByRole("spinbutton", { name: "Montant alloué (DA)" });
    await user.clear(amount);
    await user.type(amount, "300000");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(changeBudget).toHaveBeenCalledWith(2, { allocated_amount: "300000", notes: "Voté en AG" });
  });
});

describe("ExpensesPage", () => {
  beforeEach(() => {
    vi.mocked(fetchExpenses)
      .mockReset()
      .mockResolvedValue([TAXI, expense(5)]);
  });

  it("lists the expenses of the year, filtered by kind and category", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExpensesPage />);
    expect(await screen.findByText("2 dépenses · 2 300 DA")).toBeInTheDocument();
    expect(fetchExpenses).toHaveBeenCalledWith({ year: "2026-2027" });
    expect(screen.getByRole("link", { name: "Connecteurs haute tension" })).toHaveAttribute(
      "href",
      "/fr/purchasing/requests/7",
    );
    expect(screen.getAllByRole("link", { name: "Électronique 2026-2027" })[0]).toHaveAttribute(
      "href",
      "/fr/finance/budgets/2",
    );
    await user.click(screen.getByRole("button", { name: "Saisies à la main" }));
    await waitFor(() => expect(fetchExpenses).toHaveBeenLastCalledWith({ year: "2026-2027", source: "manual" }));
    await user.click(screen.getByRole("button", { name: "Toutes" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie" }), "transport");
    await waitFor(() => expect(fetchExpenses).toHaveBeenLastCalledWith({ year: "2026-2027", category: "transport" }));
    expect(screen.queryByRole("button", { name: /^À imputer/ })).not.toBeInTheDocument();
  });

  it("lets the treasurer impute an expense waiting for a budget, and note an invoice", async () => {
    const user = userEvent.setup();
    address.search = new URLSearchParams("view=to_impute");
    vi.mocked(fetchFinanceSummary).mockResolvedValue(summary({ can_manage: true, can_see_all: true, to_impute: 1 }));
    const waiting = expense(6, {
      budget: null,
      suggested_unit: { id: 4, code: null, name: "Bureau des projets", type: "club_department" },
    });
    vi.mocked(fetchExpenses).mockResolvedValue([waiting]);
    vi.mocked(changeExpense).mockResolvedValue({ ...waiting, budget: expense(1).budget });
    vi.mocked(recordInvoice).mockResolvedValue(waiting);
    renderWithProviders(<ExpensesPage />);
    expect(await screen.findByRole("button", { name: "À imputer (1)" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchExpenses).toHaveBeenCalledWith({ to_impute: true });
    const row = (await screen.findByRole("link", { name: "Connecteurs haute tension" })).closest("li")!;
    expect(row).toHaveTextContent("À imputer");

    await user.click(within(row).getByRole("button", { name: "Imputer" }));
    expect(screen.getByText("Unité de la demande : Bureau des projets.")).toBeInTheDocument();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Budget" }), "1");
    await user.click(within(row).getByRole("button", { name: "Imputer" }));
    expect(changeExpense).toHaveBeenCalledWith(6, { budget: 1 });

    await user.click(await within(row).findByRole("button", { name: "Noter la facture" }));
    await user.type(screen.getByRole("textbox", { name: "Référence" }), "F-2026-118");
    expect(screen.getByRole("spinbutton", { name: "Montant (DA)" })).toHaveValue(2000);
    await user.type(screen.getByLabelText("Date de la facture"), "2026-10-16");
    await user.click(within(row).getByRole("button", { name: "Noter la facture" }));
    expect(recordInvoice).toHaveBeenCalledWith(6, {
      reference: "F-2026-118",
      total_amount: "2000",
      issued_at: "2026-10-16",
    });
  });
});

describe("NewExpense", () => {
  it("records an expense with its reason, then opens its budget", async () => {
    const user = userEvent.setup();
    address.search = new URLSearchParams("budget=1");
    vi.mocked(fetchFinanceSummary).mockResolvedValue(summary({ can_manage: true, can_see_all: true }));
    vi.mocked(fetchBudget).mockResolvedValue({
      ...FS_BUDGET,
      expenses: [],
      committed_orders: [],
      children: [],
      with_children: { allocated_amount: "0", spent: "0", committed: "0", remaining: "0" },
    });
    vi.mocked(createExpense).mockResolvedValue(expense(10, { budget: { ...expense(1).budget!, id: 1 } }));
    renderWithProviders(<NewExpense />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Budget" })).toHaveValue("1"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie" }), "transport");
    await user.type(screen.getByRole("spinbutton", { name: "Montant (DA)" }), "35000");
    await user.type(screen.getByRole("textbox", { name: "Motif" }), "Transport de la voiture");
    await user.click(screen.getByRole("button", { name: "Enregistrer la dépense" }));
    expect(createExpense).toHaveBeenCalledWith({
      budget: 1,
      category: "transport",
      amount: "35000",
      recorded_at: clubToday(new Date()),
      description: "Transport de la voiture",
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/finance/budgets/1"));
  });

  it("tells the others that only the treasurer and the admins enter expenses", async () => {
    renderWithProviders(<NewExpense />);
    expect(await screen.findByText("Seuls le trésorier et les admins saisissent les dépenses.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer la dépense" })).not.toBeInTheDocument();
  });
});

describe("SponsorsPage", () => {
  const STEEL: Sponsorship = {
    id: 1,
    sponsor_name: "Aciéries Exemple",
    status: "confirmed",
    amount: "300000.00",
    in_kind_description: "",
    contact_name: null,
    contact_email: null,
    managed_by: MEHDI,
    notes: "Convention signée.",
    confirmed_at: "2026-10-05",
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-10-05T10:00:00Z",
  };
  const PAINT: Sponsorship = {
    ...STEEL,
    id: 2,
    sponsor_name: "Peintures Exemple",
    status: "negotiating",
    amount: null,
    in_kind_description: "Peinture de la carrosserie",
    notes: "",
    confirmed_at: null,
  };

  beforeEach(() => {
    vi.mocked(fetchSponsors).mockReset().mockResolvedValue([STEEL, PAINT]);
    vi.mocked(fetchSponsorSummary).mockResolvedValue({
      fiscal_year: "2026-2027",
      by_status: { prospect: 0, contacted: 0, negotiating: 1, confirmed: 1, declined: 0 },
      confirmed_total: "300000.00",
      can_manage: false,
    });
    vi.mocked(fetchMembers).mockResolvedValue([member(9, "Mehdi", "Demo")]);
  });

  it("shows the sponsors stage by stage and the total confirmed this year, without the contacts", async () => {
    vi.mocked(fetchFinanceSummary).mockResolvedValue(summary({ can_see_sponsors: true }));
    renderWithProviders(<SponsorsPage />);
    const confirmed = await screen.findByRole("region", { name: /Confirmé/ });
    expect(within(confirmed).getByText("Aciéries Exemple")).toBeInTheDocument();
    expect(within(confirmed).getByText("300 000 DA")).toBeInTheDocument();
    expect(within(confirmed).getByText("Suivi par Mehdi Demo")).toBeInTheDocument();
    const negotiating = screen.getByRole("region", { name: /En négociation/ });
    expect(negotiating).toHaveTextContent("En nature : Peinture de la carrosserie");
    expect(screen.getByText(/Confirmés en 2026-2027/)).toHaveTextContent("300 000 DA");
    expect(screen.getByText(/Les contacts sont réservés aux Opérations/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nouveau sponsor" })).not.toBeInTheDocument();
  });

  it("lets Operations add a sponsor", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFinanceSummary).mockResolvedValue(
      summary({ can_see_sponsors: true, can_manage_sponsors: true, can_see_budgets: false }),
    );
    vi.mocked(createSponsor).mockResolvedValue(PAINT);
    renderWithProviders(<SponsorsPage />);
    await user.click(await screen.findByRole("button", { name: "Nouveau sponsor" }));
    await user.type(screen.getByRole("textbox", { name: "Nom du sponsor" }), "Pneus Exemple");
    await user.selectOptions(screen.getByRole("combobox", { name: "Étape" }), "contacted");
    await user.type(screen.getByRole("textbox", { name: "Contribution en nature" }), "Pneus slicks");
    await user.click(screen.getByRole("button", { name: "Ajouter le sponsor" }));
    expect(createSponsor).toHaveBeenCalledWith({
      sponsor_name: "Pneus Exemple",
      status: "contacted",
      amount: null,
      in_kind_description: "Pneus slicks",
      contact_name: "",
      contact_email: "",
      notes: "",
    });
  });

  it("tells the members who may not see them who follows the sponsors", async () => {
    renderWithProviders(<SponsorsPage />);
    expect(
      await screen.findByText(
        "Les sponsors sont suivis par les Opérations ; le bureau et le trésorier les voient aussi.",
      ),
    ).toBeInTheDocument();
    expect(fetchSponsors).not.toHaveBeenCalled();
  });
});

describe("PurchaseFinance", () => {
  it("shows the expense of a delivered order to those who see its budget", async () => {
    vi.mocked(fetchExpenses)
      .mockReset()
      .mockResolvedValue([expense(5)]);
    renderWithProviders(<PurchaseFinance purchaseId={7} />);
    expect(await screen.findByText("La dépense que cette commande est devenue à sa livraison.")).toBeInTheDocument();
    expect(fetchExpenses).toHaveBeenCalledWith({ purchase_request: 7 });
    expect(screen.getByRole("link", { name: "Électronique 2026-2027" })).toHaveAttribute(
      "href",
      "/fr/finance/budgets/2",
    );
  });

  it("shows nothing to the members who see no budget", async () => {
    vi.mocked(fetchFinanceSummary).mockResolvedValue(summary({ can_see_budgets: false }));
    vi.mocked(fetchExpenses).mockReset();
    const { container } = renderWithProviders(<PurchaseFinance purchaseId={7} />);
    await waitFor(() => expect(fetchFinanceSummary).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(fetchExpenses).not.toHaveBeenCalled();
  });
});
