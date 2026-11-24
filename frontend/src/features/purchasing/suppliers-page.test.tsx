import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMembers } from "@/features/members/api";
import { member, supplier } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { createSupplier, fetchPurchaseSummary, fetchSuppliers, updateSupplier, type PurchaseSummary } from "./api";
import { SuppliersPage } from "./suppliers-page";

vi.mock("@/features/members/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members/api")>()),
  fetchMembers: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchSuppliers: vi.fn(),
  fetchPurchaseSummary: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));

const SUMMARY: PurchaseSummary = {
  by_status: { a_valider_chef: 0, a_valider_operations: 0, a_commander: 0, en_commande: 0, livre: 0, annule: 0 },
  to_approve: 0,
  mine: 0,
  can_manage: false,
};

const LASER = supplier(1, "[DEMO] Atelier Laser Alger");
const CELLS = supplier(2, "[DEMO] Cellules & Batteries", {
  type: "fournisseur",
  status: "en_attente",
  technical_capabilities: "Cellules Li-ion, connecteurs haute tension",
  city: "Lyon",
  country: "France",
  average_lead_time_days: 21,
});

function show(canManage = false) {
  vi.mocked(fetchPurchaseSummary).mockResolvedValue({ ...SUMMARY, can_manage: canManage });
  return renderWithProviders(<SuppliersPage />);
}

function card(name: string) {
  return screen.getByRole("heading", { name }).closest("li")!;
}

describe("SuppliersPage", () => {
  beforeEach(() => {
    vi.mocked(fetchSuppliers).mockReset().mockResolvedValue([LASER, CELLS]);
    vi.mocked(fetchMembers).mockResolvedValue([member(9, "Mehdi", "Demo")]);
  });

  it("shows what each supplier can do, where, and how far the request went", async () => {
    show();
    expect(await screen.findByText("2 fournisseurs")).toBeInTheDocument();
    const laser = card("[DEMO] Atelier Laser Alger");
    expect(laser).toHaveTextContent("Sous-traitant");
    expect(laser).toHaveTextContent("Validée");
    expect(laser).toHaveTextContent("Découpe laser, pliage");
    expect(laser).toHaveTextContent("Alger, Algérie");
    expect(laser).toHaveTextContent("Contacté par Mehdi Demo");
    expect(laser).toHaveTextContent("Délai moyen : 7 jours");
    // Contacts hidden from this member: nothing to show, no link.
    expect(within(laser).queryByRole("link")).not.toBeInTheDocument();
    expect(card("[DEMO] Cellules & Batteries")).toHaveTextContent("En attente");
    expect(screen.getByRole("link", { name: "Fournisseurs" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the contacts to those who may see them, as links", async () => {
    vi.mocked(fetchSuppliers).mockResolvedValue([
      supplier(1, "[DEMO] Atelier Laser Alger", {
        contact_name: "Contact (démo)",
        contact_role: "Ventes",
        email: "laser@example.invalid",
        phone: "+213 00 00 00 01",
        address: "1 rue de l'Exemple",
      }),
    ]);
    show();
    const laser = (await screen.findByRole("heading", { name: "[DEMO] Atelier Laser Alger" })).closest("li")!;
    expect(laser).toHaveTextContent("Contact (démo) — Ventes");
    expect(within(laser).getByRole("link", { name: "laser@example.invalid" })).toHaveAttribute(
      "href",
      "mailto:laser@example.invalid",
    );
    expect(within(laser).getByRole("link", { name: "+213 00 00 00 01" })).toHaveAttribute("href", "tel:+21300000001");
    expect(laser).toHaveTextContent("1 rue de l'Exemple — Alger, Algérie");
  });

  it("searches without accents and filters by type and status", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText("2 fournisseurs");
    await user.type(screen.getByRole("searchbox", { name: "Rechercher" }), "decoupe");
    await waitFor(() => expect(screen.getByText("1 fournisseur")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "[DEMO] Atelier Laser Alger" })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Rechercher" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "fournisseur");
    await waitFor(() => expect(screen.getByText("1 fournisseur")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "[DEMO] Cellules & Batteries" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Statut de la demande" }), "refusee");
    expect(await screen.findByText("Aucun fournisseur ne correspond.")).toBeInTheDocument();
  });

  it("lets Operations add a supplier", async () => {
    const user = userEvent.setup();
    vi.mocked(createSupplier).mockResolvedValue(supplier(3, "Tôlerie Test"));
    show(true);
    await user.click(await screen.findByRole("button", { name: "Ajouter un fournisseur" }));
    await user.type(screen.getByRole("textbox", { name: "Nom" }), "  Tôlerie Test ");
    await user.selectOptions(screen.getAllByRole("combobox", { name: "Type" })[0], "sous_traitant");
    await user.type(screen.getByRole("textbox", { name: "Ville" }), "Blida");
    await user.type(screen.getByRole("spinbutton", { name: "Délai moyen (jours)" }), "10");
    await user.type(screen.getByRole("textbox", { name: "E-mail" }), "tolerie@example.invalid");
    await user.selectOptions(screen.getByRole("combobox", { name: "Contacté par" }), "9");
    await user.click(screen.getByRole("button", { name: "Ajouter le fournisseur" }));
    await waitFor(() => expect(createSupplier).toHaveBeenCalled());
    expect(vi.mocked(createSupplier).mock.calls[0][0]).toMatchObject({
      name: "Tôlerie Test",
      type: "sous_traitant",
      status: "pas_encore_envoyee",
      city: "Blida",
      email: "tolerie@example.invalid",
      average_lead_time_days: 10,
      contacted_by_id: 9,
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ajouter le fournisseur" })).not.toBeInTheDocument(),
    );
  });

  it("lets only those allowed change a supplier", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSuppliers).mockResolvedValue([{ ...LASER, can_edit: true }, CELLS]);
    vi.mocked(updateSupplier).mockResolvedValue({ ...LASER, status: "refusee" });
    show(true);
    await user.click(await screen.findByRole("button", { name: "Modifier [DEMO] Atelier Laser Alger" }));
    expect(screen.queryByRole("button", { name: "Modifier [DEMO] Cellules & Batteries" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nom" })).toHaveValue("[DEMO] Atelier Laser Alger");
    await user.selectOptions(screen.getAllByRole("combobox", { name: "Statut de la demande" })[1], "refusee");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(updateSupplier).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: "refusee", average_lead_time_days: 7 }),
      ),
    );
  });

  it("does not offer to add a supplier to the other members", async () => {
    show(false);
    await screen.findByText("2 fournisseurs");
    expect(screen.queryByRole("button", { name: "Ajouter un fournisseur" })).not.toBeInTheDocument();
  });
});
