import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOrgUnits } from "@/features/members/api";
import { fetchProjects, fetchSubsystems } from "@/features/work/api";
import { ApiError } from "@/lib/api/errors";
import { project, purchaseDetail, subsystem, supplier, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { createPurchase, fetchPart, fetchSuppliers, searchParts, updatePurchase } from "./api";
import { NewPurchase } from "./new-purchase";
import { PurchaseForm } from "./purchase-form";

const router = { push: vi.fn() };
let search = "";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchProjects: vi.fn(),
  fetchSubsystems: vi.fn(),
}));
vi.mock("@/features/members/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members/api")>()),
  fetchOrgUnits: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchSuppliers: vi.fn(),
  fetchPart: vi.fn(),
  searchParts: vi.fn(),
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
}));

const BOLT = {
  id: 31,
  name: "Vis M8",
  category: "workshop" as const,
  reference: "ISO-4017",
  description: "",
  material: "",
  process: "",
};

describe("PurchaseForm", () => {
  beforeEach(() => {
    search = "";
    router.push.mockReset();
    vi.mocked(fetchProjects).mockResolvedValue([project(1, "[DEMO] EV 2027")]);
    vi.mocked(fetchSubsystems).mockResolvedValue([subsystem(2, "HV Battery & BMS")]);
    vi.mocked(fetchOrgUnits).mockResolvedValue([
      unit(6, "Opérations & Partenariats"),
      unit(7, "Ancienne cellule", { is_active: false }),
    ]);
    vi.mocked(fetchSuppliers).mockResolvedValue([supplier(9, "[DEMO] Atelier Laser Alger")]);
    vi.mocked(searchParts).mockReset().mockResolvedValue([BOLT]);
    vi.mocked(createPurchase).mockReset().mockResolvedValue(purchaseDetail(42, "Busbar cuivre"));
  });

  it("asks for a new part for a subsystem, then opens the request", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewPurchase />);
    expect(screen.getByRole("heading", { level: 1, name: "Nouvelle demande d'achat" })).toBeInTheDocument();
    await screen.findByRole("option", { name: "[DEMO] EV 2027" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Projet" }), "1");
    await screen.findByRole("option", { name: "HV Battery & BMS" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Sous-système" }), "2");
    await user.type(screen.getByRole("textbox", { name: "Nom de la pièce" }), "Busbar cuivre");
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie" }), "low_voltage");
    await user.type(screen.getByRole("textbox", { name: "Matière" }), "Cuivre");
    await user.clear(screen.getByRole("spinbutton", { name: "Quantité" }));
    await user.type(screen.getByRole("spinbutton", { name: "Quantité" }), "6");
    await user.click(screen.getByRole("button", { name: "P1 · haute" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Fournisseur suggéré" }), "9");
    await user.type(screen.getByRole("textbox", { name: "Remarques" }), "Pour le second pack");
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/purchasing/requests/42"));
    expect(createPurchase).toHaveBeenCalledWith({
      new_part: {
        name: "Busbar cuivre",
        category: "low_voltage",
        reference: "",
        material: "Cuivre",
        process: "",
        description: "",
      },
      quantity: 6,
      priority: "high",
      requested_date: null,
      notes: "Pour le second pack",
      suggested_supplier_id: 9,
      subsystem_id: 2,
    });
  });

  it("asks for a known part for a unit, the project's unit when there is no subsystem", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewPurchase />);
    // A unit (no project): only the active units are offered.
    expect(await screen.findByRole("option", { name: "Opérations & Partenariats" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Ancienne cellule" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Unité" }), "6");
    await user.click(screen.getByRole("button", { name: "Pièce déjà connue" }));
    await user.type(screen.getByRole("searchbox", { name: "Chercher une pièce" }), "vis");
    await user.click(await screen.findByRole("button", { name: /Vis M8/ }));
    expect(screen.getByText("Atelier · ISO-4017")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(createPurchase).toHaveBeenCalled());
    expect(vi.mocked(createPurchase).mock.calls[0][0]).toMatchObject({
      part_id: 31,
      org_unit_id: 6,
      subsystem_id: null,
    });
    expect(searchParts).toHaveBeenLastCalledWith("vis");

    // A project without a subsystem: its own unit.
    vi.mocked(createPurchase).mockClear();
    await user.selectOptions(screen.getByRole("combobox", { name: "Projet" }), "1");
    expect(await screen.findByRole("combobox", { name: "Sous-système" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(createPurchase).toHaveBeenCalled());
    expect(vi.mocked(createPurchase).mock.calls[0][0]).toMatchObject({ org_unit_id: 1, subsystem_id: null });
  });

  it("starts with the part of a stock line (?part=)", async () => {
    const user = userEvent.setup();
    search = "part=31";
    vi.mocked(fetchPart).mockResolvedValue(BOLT);
    renderWithProviders(<NewPurchase />);
    expect(await screen.findByText("Vis M8")).toBeInTheDocument();
    expect(fetchPart).toHaveBeenCalledWith(31);
    await screen.findByRole("option", { name: "Opérations & Partenariats" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Unité" }), "6");
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(createPurchase).toHaveBeenCalled());
    expect(vi.mocked(createPurchase).mock.calls[0][0]).toMatchObject({ part_id: 31, org_unit_id: 6 });
  });

  it("says what is missing before sending", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewPurchase />);
    await screen.findByRole("option", { name: "[DEMO] EV 2027" });
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez pour quoi est la pièce");
    await user.selectOptions(screen.getByRole("combobox", { name: "Unité" }), "6");
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    expect(screen.getByRole("alert")).toHaveTextContent("donnez le nom de la nouvelle pièce");
    await user.type(screen.getByRole("textbox", { name: "Nom de la pièce" }), "Busbar");
    await user.clear(screen.getByRole("spinbutton", { name: "Quantité" }));
    await user.type(screen.getByRole("spinbutton", { name: "Quantité" }), "0");
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La quantité doit être un nombre entier, au moins 1.");
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("shows the API's refusal", async () => {
    const user = userEvent.setup();
    vi.mocked(createPurchase).mockRejectedValue(
      new ApiError(403, "Vous ne pouvez pas demander de pièces pour cette unité."),
    );
    renderWithProviders(<NewPurchase />);
    await screen.findByRole("option", { name: "Opérations & Partenariats" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Unité" }), "6");
    await user.type(screen.getByRole("textbox", { name: "Nom de la pièce" }), "Busbar");
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vous ne pouvez pas demander de pièces pour cette unité.",
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("changes a request with its current values filled in", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const cells = purchaseDetail(7, "Cellules Li-ion 21700", { notes: "Second pack" });
    vi.mocked(updatePurchase).mockResolvedValue(cells);
    renderWithProviders(<PurchaseForm purchase={cells} onSaved={onSaved} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Sous-système" })).toHaveValue("2"));
    expect(screen.getByText("Cellules Li-ion 21700")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Quantité" })).toHaveValue(4);
    expect(screen.getByRole("textbox", { name: "Remarques" })).toHaveValue("Second pack");
    await user.clear(screen.getByRole("spinbutton", { name: "Quantité" }));
    await user.type(screen.getByRole("spinbutton", { name: "Quantité" }), "8");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(cells));
    expect(updatePurchase).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ part_id: 107, quantity: 8, subsystem_id: 2 }),
    );
  });
});
