import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { purchase, purchaseOrder, supplier } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  fetchPurchases,
  fetchPurchaseSummary,
  fetchShippingAddresses,
  fetchSuppliers,
  orderTogether,
  type PurchaseSummary,
} from "./api";
import { PurchasesPage } from "./purchases-page";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchPurchases: vi.fn(),
  fetchPurchaseSummary: vi.fn(),
  fetchSuppliers: vi.fn(),
  fetchShippingAddresses: vi.fn(),
  orderTogether: vi.fn(),
}));

const SUMMARY: PurchaseSummary = {
  by_status: { a_valider_chef: 1, a_valider_operations: 1, a_commander: 0, en_commande: 1, livre: 4, annule: 1 },
  to_approve: 0,
  mine: 2,
  can_manage: false,
};

const CELLS = purchase(7, "Cellules Li-ion 21700", { quantity: 120 });
const PLATE = purchase(8, "Plaque aluminium 5 mm", {
  quantity: 1,
  priority: "medium",
  requested_date: null,
  status: "en_commande",
  requested_by: { id: 5, first_name: "Nour", last_name: "Demo" },
  subsystem: null,
  project: null,
  org_unit: { id: 4, code: null, name: "Chassis & Ergonomics", type: "fs_department" },
  order: purchaseOrder({
    currency: "DZD",
    exchange_rate: "1.0000",
    total_price: "10000.00",
    total_price_dzd: "10000.00",
  }),
});

function show(summary: Partial<PurchaseSummary> = {}, locale: "fr" | "ar" = "fr") {
  vi.mocked(fetchPurchaseSummary).mockResolvedValue({ ...SUMMARY, ...summary });
  return renderWithProviders(<PurchasesPage />, { locale });
}

function row(name: string) {
  return screen.getByRole("link", { name }).closest("li")!;
}

describe("PurchasesPage", () => {
  beforeEach(() => {
    vi.mocked(fetchPurchases).mockReset().mockResolvedValue([CELLS, PLATE]);
  });

  it("lists the requests in progress: the part, what for, who asked, where each stands", async () => {
    show();
    expect(await screen.findByRole("link", { name: "Cellules Li-ion 21700" })).toHaveAttribute(
      "href",
      "/fr/purchasing/requests/7",
    );
    expect(fetchPurchases).toHaveBeenCalledWith({ open: true });
    const cells = row("Cellules Li-ion 21700");
    expect(cells).toHaveTextContent("× 120");
    expect(cells).toHaveTextContent("P1"); // the team's word for a high priority
    expect(within(cells).getByText("Priorité haute")).toHaveClass("sr-only");
    expect(cells).toHaveTextContent("[DEMO] EV 2027 · HV Battery & BMS");
    expect(cells).toHaveTextContent("Rayan Demo");
    expect(cells).toHaveTextContent("Souhaitée pour le 12 nov. 2026");
    expect(cells).toHaveTextContent("À valider (chef)");
    // Without a subsystem: the unit; ordered: the supplier and the total in dinars.
    const plate = row("Plaque aluminium 5 mm");
    expect(plate).toHaveTextContent("Chassis & Ergonomics");
    expect(plate).toHaveTextContent("En commande");
    expect(plate).toHaveTextContent("[DEMO] Atelier Laser Alger · 10 000,00 DA");
    expect(screen.getByRole("button", { name: /En cours/ })).toHaveTextContent("3"); // 1 + 1 + 0 + 1
  });

  it("offers the views each one needs: to approve for leaders, to order for Operations", async () => {
    const user = userEvent.setup();
    show({ to_approve: 2, can_manage: true, by_status: { ...SUMMARY.by_status, a_commander: 3 } });
    await user.click(await screen.findByRole("button", { name: /À valider par moi/ }));
    expect(fetchPurchases).toHaveBeenLastCalledWith({ to_approve: true });
    expect(screen.getByRole("button", { name: /À valider par moi/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /À commander/ }));
    expect(fetchPurchases).toHaveBeenLastCalledWith({ status: "a_commander" });
    await user.click(screen.getByRole("button", { name: /Mes demandes/ }));
    expect(fetchPurchases).toHaveBeenLastCalledWith({ mine: true });
    await user.click(screen.getByRole("button", { name: "Livrées" }));
    expect(fetchPurchases).toHaveBeenLastCalledWith({ status: "livre" });
  });

  it("shows neither view to those who have nothing to approve and do not order", async () => {
    show();
    await screen.findByRole("link", { name: "Cellules Li-ion 21700" });
    expect(screen.queryByRole("button", { name: /À valider par moi/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /À commander/ })).not.toBeInTheDocument();
  });

  it("lets Operations tick requests to order and order them together", async () => {
    const user = userEvent.setup();
    const mounts = purchase(9, "Supports moteur", { quantity: 2, status: "a_commander" });
    const cells = { ...CELLS, status: "a_commander" as const };
    vi.mocked(fetchPurchases).mockResolvedValue([cells, mounts]);
    vi.mocked(fetchSuppliers).mockResolvedValue([supplier(4, "Usinage Test")]);
    vi.mocked(fetchShippingAddresses).mockResolvedValue([]);
    vi.mocked(orderTogether).mockResolvedValue({ requests: [{}, {}] } as never);
    show({ can_manage: true, by_status: { ...SUMMARY.by_status, a_commander: 2 } });
    await user.click(await screen.findByRole("button", { name: /^À commander/ }));
    const together = await screen.findByRole("button", { name: "Commander ensemble (0)" });
    expect(together).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Choisir « Cellules Li-ion 21700 »" }));
    await user.click(screen.getByRole("checkbox", { name: "Choisir « Supports moteur »" }));
    await user.click(screen.getByRole("button", { name: "Commander ensemble (2)" }));

    const form = screen.getByRole("form", { name: "Commander ensemble" });
    await user.selectOptions(within(form).getByRole("combobox", { name: "Fournisseur" }), "4");
    await user.type(within(form).getByRole("spinbutton", { name: /Cellules Li-ion 21700/ }), "300");
    await user.type(within(form).getByRole("spinbutton", { name: /Supports moteur/ }), "1500");
    const delivery = within(form).getByRole("spinbutton", { name: "Livraison, pour toute la commande (DA)" });
    await user.clear(delivery);
    await user.type(delivery, "1000");
    // 120 × 300 + 2 × 1 500 + 1 000.
    expect(form).toHaveTextContent("2 demandes · total : 40 000,00 DA");
    await user.click(within(form).getByRole("button", { name: "Passer la commande groupée" }));
    expect(orderTogether).toHaveBeenCalledWith(
      expect.objectContaining({
        supplier_id: 4,
        currency: "DZD",
        delivery_cost: "1000",
        lines: [
          { request_id: 7, unit_price: "300" },
          { request_id: 9, unit_price: "1500" },
        ],
      }),
    );
    expect(await screen.findByText("Commande groupée passée : 2 demandes sont en commande.")).toBeInTheDocument();
  });

  it("searches without accents, in the part and the people", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole("link", { name: "Cellules Li-ion 21700" });
    await user.type(screen.getByRole("searchbox", { name: "Rechercher" }), "nour");
    await waitFor(() => expect(screen.queryByRole("link", { name: "Cellules Li-ion 21700" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Plaque aluminium 5 mm" })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Rechercher" }));
    await user.type(screen.getByRole("searchbox", { name: "Rechercher" }), "zzz");
    expect(await screen.findByText("Aucune demande ne correspond à cette recherche.")).toBeInTheDocument();
  });

  it("says when a view is empty, and leads to a new request", async () => {
    vi.mocked(fetchPurchases).mockResolvedValue([]);
    show();
    expect(await screen.findByText("Aucune demande en cours.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nouvelle demande" })).toHaveAttribute(
      "href",
      "/fr/purchasing/requests/new",
    );
    expect(screen.getByRole("link", { name: "Fournisseurs" })).toHaveAttribute("href", "/fr/purchasing/suppliers");
    expect(screen.getByRole("link", { name: "Demandes" })).toHaveAttribute("aria-current", "page");
  });

  it("speaks Arabic, with Latin digits and French names kept in order", async () => {
    show({}, "ar");
    const link = await screen.findByRole("link", { name: "Cellules Li-ion 21700" });
    const cells = link.closest("li")!;
    expect(cells).toHaveTextContent("بانتظار مصادقة المسؤول");
    expect(cells).toHaveTextContent("× 120");
    expect(row("Plaque aluminium 5 mm")).toHaveTextContent("10,000.00 دج");
  });
});
