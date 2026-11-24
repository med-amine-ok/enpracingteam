import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFinanceSummary, type FinanceSummary } from "@/features/finance/api";
import { ApiError } from "@/lib/api/errors";
import { clubToday } from "@/lib/dates";
import { purchaseDetail, purchaseOrder, supplier } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  approvePurchase,
  closeOrder,
  fetchPurchase,
  fetchShippingAddresses,
  fetchSuppliers,
  placeOrder,
  receiveBatch,
  receivePurchase,
  refusePurchase,
  type PurchaseRequestDetail,
} from "./api";
import { PurchaseView } from "./purchase-view";

const NO_FINANCE: FinanceSummary = {
  fiscal_year: "2026-2027",
  can_manage: false,
  can_see_all: false,
  can_see_budgets: false,
  can_see_sponsors: false,
  can_manage_sponsors: false,
  budgets: 0,
  over_budget: 0,
  to_impute: null,
};

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "7" }),
}));
// The finance card of a delivered purchase (features/finance/finance.test.tsx tests it): not shown here.
vi.mock("@/features/finance/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/finance/api")>()),
  fetchFinanceSummary: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchPurchase: vi.fn(),
  fetchSuppliers: vi.fn(),
  fetchShippingAddresses: vi.fn(),
  approvePurchase: vi.fn(),
  refusePurchase: vi.fn(),
  cancelPurchase: vi.fn(),
  placeOrder: vi.fn(),
  changeOrder: vi.fn(),
  cancelOrder: vi.fn(),
  closeOrder: vi.fn(),
  receivePurchase: vi.fn(),
  receiveBatch: vi.fn(),
}));

const LINA = { id: 1, first_name: "Lina", last_name: "Demo" };
const MEHDI = { id: 9, first_name: "Mehdi", last_name: "Demo" };
const RIGHTS = {
  edit: false,
  approve: false,
  cancel: false,
  order: false,
  manage_order: false,
  cancel_order: false,
  close_order: false,
};

const CELLS = purchaseDetail(7, "Cellules Li-ion 21700", {
  notes: "Pour le second pack.",
  part: {
    id: 107,
    name: "Cellules Li-ion 21700",
    category: "engine_tractive",
    reference: "LG-M50",
    description: "",
    material: "",
    process: "",
  },
});

function show(purchase: PurchaseRequestDetail = CELLS) {
  vi.mocked(fetchPurchase).mockResolvedValue(purchase);
  return renderWithProviders(<PurchaseView />);
}

async function summary() {
  return (await screen.findByRole("heading", { level: 1 })).closest("section")!;
}

describe("PurchaseView", () => {
  beforeEach(() => {
    vi.mocked(fetchPurchase).mockReset();
    vi.mocked(fetchFinanceSummary).mockResolvedValue({ ...NO_FINANCE });
    vi.mocked(fetchSuppliers).mockResolvedValue([supplier(9, "[DEMO] Atelier Laser Alger")]);
    vi.mocked(fetchShippingAddresses).mockResolvedValue([]);
  });

  it("shows the request: the part, what for, its steps, what it awaits and its history", async () => {
    show();
    const block = await summary();
    expect(within(block).getByRole("heading", { level: 1 })).toHaveTextContent("Cellules Li-ion 21700 × 4");
    expect(block).toHaveTextContent("Demandée par Rayan Demo le 17 oct. 2026");
    expect(block).toHaveTextContent("Pour : [DEMO] EV 2027 · HV Battery & BMS · Souhaitée pour le 12 nov. 2026");
    const steps = within(block).getByRole("list", { name: "Étapes de la demande" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(5);
    expect(within(steps).getByText("À valider (chef)").closest("li")).toHaveAttribute("aria-current", "step");
    expect(block).toHaveTextContent("En attente de la validation du chef (chef de l'unité ou chef de projet).");
    expect(screen.getByText("LG-M50")).toBeInTheDocument();
    expect(screen.getByText("Pour le second pack.")).toBeInTheDocument();
    expect(screen.getByText("a fait la demande", { exact: false }).closest("li")).toHaveTextContent(
      "Rayan Demo a fait la demande",
    );
    // No right: no button.
    expect(within(block).queryByRole("button")).not.toBeInTheDocument();
  });

  it("lets a leader approve, with a comment, then shows the request as it is now", async () => {
    const user = userEvent.setup();
    const approved = purchaseDetail(7, "Cellules Li-ion 21700", {
      status: "a_valider_operations",
      events: [
        ...CELLS.events,
        {
          id: 2,
          action: "approved",
          status: "a_valider_operations",
          actor: LINA,
          comment: "OK",
          quantity: null,
          created_at: "2026-10-18T09:00:00Z",
        },
      ],
    });
    vi.mocked(approvePurchase).mockResolvedValue(approved);
    show({ ...CELLS, permissions: { ...RIGHTS, approve: true } });
    await user.click(within(await summary()).getByRole("button", { name: "Valider" }));
    await user.type(screen.getByRole("textbox", { name: "Commentaire (facultatif)" }), "OK");
    vi.mocked(fetchPurchase).mockResolvedValue(approved); // as the API answers from now on
    await user.click(screen.getByRole("button", { name: "Confirmer la validation" }));
    expect(approvePurchase).toHaveBeenCalledWith(7, "OK");
    expect((await screen.findByText("l'a validée (chef)", { exact: false })).closest("li")).toHaveTextContent(
      "Lina Demo l'a validée (chef)",
    );
    expect(await summary()).toHaveTextContent(
      "Validée par le chef : en attente de la validation du chef des Opérations.",
    );
  });

  it("asks a reason before refusing", async () => {
    const user = userEvent.setup();
    vi.mocked(refusePurchase).mockResolvedValue({ ...CELLS, status: "annule" });
    show({ ...CELLS, permissions: { ...RIGHTS, approve: true } });
    await user.click(within(await summary()).getByRole("button", { name: "Refuser" }));
    const confirm = screen.getByRole("button", { name: "Confirmer le refus" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Motif (montré au demandeur)" }), "Déjà à l'atelier");
    await user.click(confirm);
    expect(refusePurchase).toHaveBeenCalledWith(7, "Déjà à l'atelier");
  });

  it("lets Operations place the order in a foreign currency, with the totals as they will be saved", async () => {
    const user = userEvent.setup();
    vi.mocked(placeOrder).mockResolvedValue({ ...CELLS, status: "en_commande", order: purchaseOrder() });
    show({ ...CELLS, status: "a_commander", permissions: { ...RIGHTS, order: true, cancel: true } });
    await user.click(within(await summary()).getByRole("button", { name: "Passer la commande" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Fournisseur" }), "9");
    await user.selectOptions(screen.getByRole("combobox", { name: "Devise" }), "EUR");
    await user.type(screen.getByRole("spinbutton", { name: "Prix unitaire (€)" }), "10");
    await user.type(screen.getByRole("spinbutton", { name: "Taux payé : DA pour 1 €" }), "250");
    await user.clear(screen.getByRole("spinbutton", { name: "Livraison (€)" }));
    await user.type(screen.getByRole("spinbutton", { name: "Livraison (€)" }), "5");
    await user.clear(screen.getByRole("spinbutton", { name: "Douane (€)" }));
    await user.type(screen.getByRole("spinbutton", { name: "Douane (€)" }), "2");
    expect(screen.getByText(/Total pour 4 pièce\(s\)/)).toHaveTextContent(
      "Total pour 4 pièce(s) : 47,00 € · soit 11 750,00 DA",
    );
    await user.click(screen.getByRole("button", { name: "Enregistrer la commande" }));
    expect(placeOrder).toHaveBeenCalledWith(7, {
      supplier_id: 9,
      unit_price: "10",
      currency: "EUR",
      exchange_rate: "250",
      delivery_cost: "5",
      customs_cost: "2",
      ordered_at: clubToday(new Date()),
      estimated_delivery_date: null,
      shipping_address_id: null,
    });
  });

  it("asks the rate of a foreign currency before ordering", async () => {
    const user = userEvent.setup();
    show({ ...CELLS, status: "a_commander", permissions: { ...RIGHTS, order: true } });
    await user.click(within(await summary()).getByRole("button", { name: "Passer la commande" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Fournisseur" }), "9");
    await user.selectOptions(screen.getByRole("combobox", { name: "Devise" }), "GBP");
    await user.type(screen.getByRole("spinbutton", { name: "Prix unitaire (£)" }), "10");
    await user.click(screen.getByRole("button", { name: "Enregistrer la commande" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez le fournisseur et indiquez le prix unitaire");
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("shows the order with its amounts in its currency and in dinars, and records the delivery", async () => {
    const user = userEvent.setup();
    const delivered: PurchaseRequestDetail = {
      ...CELLS,
      status: "livre",
      order: purchaseOrder({ status: "livre", actual_delivery_date: "2026-10-19" }),
    };
    vi.mocked(receivePurchase).mockResolvedValue(delivered);
    show({ ...CELLS, status: "en_commande", order: purchaseOrder(), permissions: { ...RIGHTS, manage_order: true } });
    const order = (await screen.findByRole("heading", { name: "Commande" })).closest("section")!;
    expect(order).toHaveTextContent("[DEMO] Atelier Laser Alger");
    const amounts = within(order).getByRole("table", { name: "Montants de la commande" });
    expect(within(amounts).getByText("Total").closest("tr")).toHaveTextContent("47,00 €");
    expect(within(amounts).getByText("Taux payé").closest("tr")).toHaveTextContent("1,00 € = 250,00 DA");
    expect(within(amounts).getByText("Total en dinars").closest("tr")).toHaveTextContent("11 750,00 DA");
    expect(await summary()).toHaveTextContent("Commandée : livraison prévue le 30 octobre 2026.");

    await user.click(within(await summary()).getByRole("button", { name: "Marquer comme livrée" }));
    await user.type(screen.getByRole("textbox", { name: "Emplacement en stock (facultatif)" }), "Armoire B2");
    vi.mocked(fetchPurchase).mockResolvedValue(delivered);
    await user.click(screen.getByRole("button", { name: "Confirmer la livraison" }));
    expect(receivePurchase).toHaveBeenCalledWith(7, {
      actual_delivery_date: clubToday(new Date()),
      location: "Armoire B2",
      quantity: 4, // all the parts still to come, by default
    });
    expect(await summary()).toHaveTextContent("Livrée le 19 octobre 2026 : la pièce est en stock.");
  });

  it("receives only the parts that arrived, then closes the order with them", async () => {
    const user = userEvent.setup();
    vi.mocked(receivePurchase).mockResolvedValue(CELLS);
    const view = show({
      ...CELLS,
      status: "en_commande",
      order: purchaseOrder(),
      permissions: { ...RIGHTS, manage_order: true, cancel_order: true },
    });
    await user.click(within(await summary()).getByRole("button", { name: "Marquer comme livrée" }));
    const count = screen.getByRole("spinbutton", { name: "Pièces arrivées (sur 4 attendues)" });
    await user.clear(count);
    await user.type(count, "3");
    await user.click(screen.getByRole("button", { name: "Confirmer la livraison" }));
    expect(receivePurchase).toHaveBeenCalledWith(7, {
      actual_delivery_date: clubToday(new Date()),
      location: "",
      quantity: 3,
    });
    view.unmount();

    vi.mocked(closeOrder).mockResolvedValue(CELLS);
    show({
      ...CELLS,
      status: "en_commande",
      order: purchaseOrder({ quantity_received: 3 }),
      permissions: { ...RIGHTS, manage_order: true, close_order: true },
    });
    expect(await summary()).toHaveTextContent("3 pièces reçues sur 4 : le reste est attendu.");
    const order = screen.getByRole("heading", { name: "Commande" }).closest("section")!;
    expect(order).toHaveTextContent("Reçues3 / 4");
    // Once parts arrived, the order is no longer cancelled: it is closed with them.
    expect(within(await summary()).queryByRole("button", { name: "Annuler la commande" })).not.toBeInTheDocument();
    await user.click(within(await summary()).getByRole("button", { name: "Clore avec ce qui est arrivé" }));
    await user.type(screen.getByRole("textbox", { name: "Motif (montré au demandeur)" }), "Plus en stock");
    await user.click(screen.getByRole("button", { name: "Confirmer la clôture" }));
    expect(closeOrder).toHaveBeenCalledWith(7, "Plus en stock");
  });

  it("shows the requests ordered with it, and receives everything still to come at once", async () => {
    const user = userEvent.setup();
    vi.mocked(receiveBatch).mockResolvedValue({} as never);
    show({
      ...CELLS,
      status: "en_commande",
      order: purchaseOrder({ batch: 3 }),
      grouped_order: {
        id: 3,
        supplier: { id: 9, name: "[DEMO] Atelier Laser Alger", type: "sous_traitant" },
        created_by: MEHDI,
        created_at: "2026-10-18T09:00:00Z",
        requests: [
          { id: 7, part: "Cellules Li-ion 21700", quantity: 4, status: "en_commande", quantity_received: 0 },
          { id: 8, part: "Supports moteur", quantity: 2, status: "livre", quantity_received: 2 },
        ],
        can_receive: true,
      },
    });
    const grouped = (await screen.findByRole("heading", { name: "Commande groupée" })).closest("section")!;
    expect(grouped).toHaveTextContent("Commandée en une fois chez [DEMO] Atelier Laser Alger, avec :");
    expect(within(grouped).getByRole("link", { name: "Supports moteur" })).toHaveAttribute(
      "href",
      "/fr/purchasing/requests/8",
    );
    expect(grouped).toHaveTextContent("Cellules Li-ion 21700 (cette demande)");
    expect(grouped).toHaveTextContent("2/2 reçues");
    await user.click(within(grouped).getByRole("button", { name: "Réceptionner tout ce qui reste" }));
    await user.click(within(grouped).getByRole("button", { name: "Confirmer la livraison" }));
    expect(receiveBatch).toHaveBeenCalledWith(3, { actual_delivery_date: clubToday(new Date()), location: "" });
  });

  it("explains when someone acted first, and reads the request again", async () => {
    const user = userEvent.setup();
    vi.mocked(approvePurchase).mockRejectedValue(new ApiError(409, "Cette demande n'attend plus de validation."));
    show({ ...CELLS, permissions: { ...RIGHTS, approve: true } });
    await user.click(within(await summary()).getByRole("button", { name: "Valider" }));
    await user.click(screen.getByRole("button", { name: "Confirmer la validation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette demande n'attend plus de validation.");
    await waitFor(() => expect(fetchPurchase).toHaveBeenCalledTimes(2));
  });

  it("shows why a request was refused, and approvals of Operations without a name", async () => {
    show(
      purchaseDetail(7, "Mousse de siège", {
        status: "annule",
        events: [
          ...CELLS.events,
          {
            id: 2,
            action: "approved",
            status: "a_commander",
            actor: null,
            comment: "",
            quantity: null,
            created_at: "2026-10-18T09:00:00Z",
          },
          {
            id: 3,
            action: "refused",
            status: "annule",
            actor: LINA,
            comment: "Il en reste à l'atelier.",
            quantity: null,
            created_at: "2026-10-18T10:00:00Z",
          },
        ],
      }),
    );
    const block = await summary();
    expect(within(block).queryByRole("list", { name: "Étapes de la demande" })).not.toBeInTheDocument();
    expect(within(block).getByRole("status")).toHaveTextContent("Cette demande a été refusée.");
    expect(within(block).getByRole("status")).toHaveTextContent("« Il en reste à l'atelier. »");
    expect(screen.getByText("Validée par les Opérations")).toBeInTheDocument();
    expect(screen.getByText("l'a refusée", { exact: false }).closest("li")).toHaveTextContent("Lina Demo l'a refusée");
  });

  it("names who received the parts", async () => {
    show(
      purchaseDetail(7, "Connecteurs HT", {
        status: "livre",
        order: purchaseOrder({ status: "livre", actual_delivery_date: "2026-10-09" }),
        events: [
          ...CELLS.events,
          {
            id: 4,
            action: "received",
            status: "livre",
            actor: MEHDI,
            comment: "",
            quantity: 4,
            created_at: "2026-10-09T11:00:00Z",
          },
        ],
      }),
    );
    expect(await screen.findByText("a réceptionné la livraison", { exact: false })).toHaveTextContent(
      "Mehdi Demo a réceptionné la livraison : la pièce est en stock",
    );
  });
});
