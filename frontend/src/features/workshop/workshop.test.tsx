import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers } from "@/features/members/api";
import { clubToday } from "@/lib/dates";
import { me, member } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  approveLoan,
  cancelLoan,
  cancelReservation,
  certify,
  createEquipment,
  fetchEquipment,
  fetchEquipmentList,
  fetchLoans,
  fetchMyReservations,
  fetchWorkshopRights,
  recordMaintenance,
  refuseLoan,
  requestLoan,
  reserve,
  returnLoan,
  revokeCertification,
  type Equipment,
  type EquipmentDetail,
  type Loan,
  type Reservation,
} from "./api";
import { NewEquipment } from "./equipment-form";
import { EquipmentView } from "./equipment-view";
import { LoansToHandle, MyWorkshop } from "./my-workshop";
import { WorkshopPage } from "./workshop-page";

const router = { replace: vi.fn() };

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "5" }),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchEquipmentList: vi.fn(),
  fetchEquipment: vi.fn(),
  fetchWorkshopRights: vi.fn(),
  createEquipment: vi.fn(),
  recordMaintenance: vi.fn(),
  certify: vi.fn(),
  revokeCertification: vi.fn(),
  reserve: vi.fn(),
  fetchMyReservations: vi.fn(),
  cancelReservation: vi.fn(),
  requestLoan: vi.fn(),
  fetchLoans: vi.fn(),
  approveLoan: vi.fn(),
  refuseLoan: vi.fn(),
  returnLoan: vi.fn(),
  cancelLoan: vi.fn(),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));

const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const MEMBER_RIGHTS = { manage: false, certify: false };
const LEAD_RIGHTS = { manage: true, certify: true };

function item(id: number, name: string, overrides: Partial<Equipment> = {}): Equipment {
  return {
    id,
    name,
    category: "machine",
    status: "available",
    location: "Atelier",
    requires_certification: false,
    loanable: true,
    certified: false,
    ...overrides,
  };
}

function detail(overrides: Partial<EquipmentDetail> = {}): EquipmentDetail {
  return {
    ...item(5, "Tour", { requires_certification: true, loanable: false, certified: true }),
    description: "Tour conventionnel, mandrin 160 mm.",
    purchased_at: null,
    last_maintenance_at: null,
    lent_to: null,
    lent_until: null,
    reservations: [],
    certifications: [],
    maintenance: [],
    loans: [],
    permissions: { manage: false, certify: false, reserve: true, borrow: false },
    ...overrides,
  };
}

function loan(id: number, overrides: Partial<Loan> = {}): Loan {
  return {
    id,
    equipment: { id: 6, name: "Pied à coulisse" },
    borrower: RAYAN,
    reason: "Mesurer les porte-moyeux",
    due_date: "2026-10-25",
    status: "requested",
    overdue: false,
    requested_at: "2026-10-22T08:00:00Z",
    decided_by: null,
    decided_at: null,
    decision_note: "",
    returned_at: null,
    received_by: null,
    return_condition: "",
    return_note: "",
    permissions: { decide: false, receive: false, cancel: false },
    ...overrides,
  };
}

function slot(id: number, overrides: Partial<Reservation> = {}): Reservation {
  return {
    id,
    equipment: { id: 5, name: "Tour" },
    reserved_by: RAYAN,
    reserved_from: "2026-10-23T08:00:00Z",
    reserved_to: "2026-10-23T10:00:00Z",
    purpose: "Usinage des entretoises",
    status: "confirmed",
    cancelled_by: null,
    cancelled_at: null,
    permissions: { cancel: false },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMe).mockResolvedValue(me()); // Lina, id 1
  vi.mocked(fetchWorkshopRights).mockResolvedValue(MEMBER_RIGHTS);
  vi.mocked(fetchLoans).mockResolvedValue([]);
  vi.mocked(fetchMembers).mockResolvedValue([member(2, "Rayan", "Demo"), member(3, "Yacine", "Demo")]);
});

describe("WorkshopPage", () => {
  it("lists the equipment with its status and what it needs, and filters it", async () => {
    const tour = item(5, "Tour", { requires_certification: true, loanable: false });
    const caliper = item(6, "Pied à coulisse", { category: "measuring", status: "borrowed" });
    vi.mocked(fetchEquipmentList).mockImplementation(async (filters = {}) =>
      filters.category === "machine" ? [tour] : [tour, caliper],
    );
    const user = userEvent.setup();
    renderWithProviders(<WorkshopPage />);
    const card = (await screen.findByText("Tour")).closest("a")!;
    expect(card).toHaveAttribute("href", "/fr/workshop/5");
    for (const text of ["Disponible", "Machine-outil", "Habilitation requise", "Reste à l'atelier", "Atelier"]) {
      expect(within(card).getByText(text)).toBeInTheDocument();
    }
    expect(within(screen.getByText("Pied à coulisse").closest("a")!).getByText("Emprunté")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nouvel équipement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Prêts à traiter/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Catégorie"), "machine");
    await waitFor(() => expect(screen.queryByText("Pied à coulisse")).not.toBeInTheDocument());
    expect(fetchEquipmentList).toHaveBeenLastCalledWith({ category: "machine" });
  });

  it("shows the managers how to add equipment and the loans awaiting them", async () => {
    vi.mocked(fetchWorkshopRights).mockResolvedValue(LEAD_RIGHTS);
    vi.mocked(fetchEquipmentList).mockResolvedValue([]);
    vi.mocked(fetchLoans).mockResolvedValue([loan(1)]);
    renderWithProviders(<WorkshopPage />);
    expect(await screen.findByRole("link", { name: "Nouvel équipement" })).toHaveAttribute("href", "/fr/workshop/new");
    expect(await screen.findByRole("link", { name: "Prêts à traiter (1)" })).toHaveAttribute(
      "href",
      "/fr/workshop/loans",
    );
    expect(fetchLoans).toHaveBeenCalledWith({ status: "requested" });
    expect(screen.getByText("Aucun équipement.")).toBeInTheDocument();
  });
});

describe("NewEquipment", () => {
  it("adds an item, its certification and loan rules included", async () => {
    vi.mocked(createEquipment).mockResolvedValue(detail({ id: 9 }));
    const user = userEvent.setup();
    renderWithProviders(<NewEquipment />);
    await user.type(screen.getByLabelText("Nom"), "Fraiseuse");
    await user.selectOptions(screen.getByLabelText("Catégorie"), "machine");
    await user.type(screen.getByLabelText("Lieu"), "Atelier, poste 2");
    await user.click(screen.getByRole("checkbox", { name: /Habilitation requise pour l'utiliser/ }));
    await user.click(screen.getByRole("checkbox", { name: "Peut sortir de l'atelier (prêt)" }));
    await user.click(screen.getByRole("button", { name: "Ajouter l'équipement" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/workshop/9"));
    expect(createEquipment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Fraiseuse",
        category: "machine",
        location: "Atelier, poste 2",
        requires_certification: true,
        loanable: false,
      }),
    );
    expect(vi.mocked(createEquipment).mock.calls[0][0]).not.toHaveProperty("status");
  });
});

describe("EquipmentView", () => {
  it("books a free slot", async () => {
    vi.mocked(fetchEquipment).mockResolvedValue(detail());
    vi.mocked(reserve).mockResolvedValue(slot(1));
    const user = userEvent.setup();
    renderWithProviders(<EquipmentView />);
    expect(await screen.findByRole("heading", { level: 1, name: "Tour" })).toBeInTheDocument();
    expect(screen.getByText("Vous avez l'habilitation")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Début"), "2026-10-23T10:00");
    await user.type(screen.getByLabelText("Fin"), "2026-10-23T12:00");
    await user.type(screen.getByLabelText("Pour quoi (facultatif)"), "Entretoises");
    await user.click(screen.getByRole("button", { name: "Réserver" }));
    await waitFor(() =>
      expect(reserve).toHaveBeenCalledWith(
        5,
        new Date("2026-10-23T10:00").toISOString(),
        new Date("2026-10-23T12:00").toISOString(),
        "Entretoises",
      ),
    );
  });

  it("asks for a certification instead, on a machine that needs one", async () => {
    vi.mocked(fetchEquipment).mockResolvedValue(
      detail({ certified: false, permissions: { manage: false, certify: false, reserve: false, borrow: false } }),
    );
    renderWithProviders(<EquipmentView />);
    expect(
      await screen.findByText("Cette machine demande une habilitation : adressez-vous au chef d'atelier."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réserver" })).not.toBeInTheDocument();
    expect(screen.getByText("Habilitation requise")).toBeInTheDocument();
  });

  it("asks to borrow what may leave the workshop", async () => {
    vi.mocked(fetchEquipment).mockResolvedValue(
      detail({
        ...item(6, "Pied à coulisse", { category: "measuring" }),
        permissions: { manage: false, certify: false, reserve: true, borrow: true },
      }),
    );
    vi.mocked(requestLoan).mockResolvedValue(loan(3));
    const user = userEvent.setup();
    renderWithProviders(<EquipmentView />);
    // A return date in a week: the form refuses a date already past (a fixed date would fail once it is).
    const back = clubToday(new Date(Date.now() + 7 * 86_400_000));
    await user.type(await screen.findByLabelText("Pour quoi"), "Mesurer les porte-moyeux");
    await user.type(screen.getByLabelText("Retour prévu le"), back);
    await user.click(screen.getByRole("button", { name: "Demander le prêt" }));
    await waitFor(() => expect(requestLoan).toHaveBeenCalledWith(6, "Mesurer les porte-moyeux", back));
  });

  it("lets a manager hand a loan out, or refuse it saying why", async () => {
    const asked = loan(3, { permissions: { decide: true, receive: false, cancel: false } });
    vi.mocked(fetchEquipment).mockResolvedValue(
      detail({
        loanable: true,
        loans: [asked],
        permissions: { manage: true, certify: false, reserve: true, borrow: true },
      }),
    );
    vi.mocked(approveLoan).mockResolvedValue(loan(3, { status: "out" }));
    vi.mocked(refuseLoan).mockResolvedValue(loan(3, { status: "refused" }));
    const user = userEvent.setup();
    renderWithProviders(<EquipmentView />);
    const card = (await screen.findByText("Rayan Demo · retour prévu le 25 oct. 2026")).closest("li")!;
    await user.click(within(card).getByRole("button", { name: "Refuser" }));
    const confirm = within(card).getByRole("button", { name: "Refuser le prêt" });
    expect(confirm).toBeDisabled();
    await user.type(within(card).getByLabelText("Pourquoi il est refusé"), "Il sert à la journée portes ouvertes");
    await user.click(confirm);
    await waitFor(() => expect(refuseLoan).toHaveBeenCalledWith(3, "Il sert à la journée portes ouvertes"));
    await user.click(within(card).getByRole("button", { name: "Valider la sortie" }));
    await waitFor(() => expect(approveLoan).toHaveBeenCalledWith(3));
  });

  it("lets the workshop lead certify a member, and revoke a certification", async () => {
    vi.mocked(fetchEquipment).mockResolvedValue(
      detail({
        certifications: [
          {
            id: 8,
            member: RAYAN,
            granted_by: { id: 4, first_name: "Nadia", last_name: "Demo" },
            granted_at: "2026-10-20T09:00:00Z",
            note: "",
          },
        ],
        permissions: { manage: true, certify: true, reserve: true, borrow: false },
      }),
    );
    vi.mocked(certify).mockResolvedValue({ id: 9, member: RAYAN, granted_by: null, granted_at: "", note: "" });
    vi.mocked(revokeCertification).mockResolvedValue(detail());
    const user = userEvent.setup();
    renderWithProviders(<EquipmentView />);
    expect(await screen.findByText("par Nadia Demo, le 20 oct. 2026")).toBeInTheDocument();
    const select = screen.getByLabelText("Membre à habiliter");
    // Rayan is certified already: only Yacine is offered.
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Choisir un membre", "Yacine Demo"]),
    );
    await user.selectOptions(select, "3");
    await user.type(screen.getByLabelText("Note (facultatif)"), "Formé le 21/10");
    await user.click(screen.getByRole("button", { name: "Habiliter" }));
    await waitFor(() => expect(certify).toHaveBeenCalledWith(5, 3, "Formé le 21/10"));
    await user.click(screen.getByRole("button", { name: "Retirer l'habilitation de Rayan Demo" }));
    await waitFor(() => expect(revokeCertification).toHaveBeenCalledWith(5, 8));
  });

  it("lets a manager record a maintenance, and cancel a member's slot saying why", async () => {
    vi.mocked(fetchEquipment).mockResolvedValue(
      detail({
        reservations: [slot(1, { permissions: { cancel: true } })],
        maintenance: [
          {
            id: 2,
            performed_by: RAYAN,
            performed_at: "2026-10-01T10:00:00Z",
            description: "Courroie changée",
            cost: "1500.00",
          },
        ],
        permissions: { manage: true, certify: false, reserve: true, borrow: false },
      }),
    );
    vi.mocked(recordMaintenance).mockResolvedValue(detail());
    vi.mocked(cancelReservation).mockResolvedValue(slot(1, { status: "cancelled" }));
    const user = userEvent.setup();
    renderWithProviders(<EquipmentView />);
    expect(await screen.findByText("Courroie changée")).toBeInTheDocument();
    expect(screen.getByText(/1 500 DA/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Noter une maintenance" }));
    await user.type(screen.getByLabelText("Travail fait"), "Graissage des glissières");
    await user.selectOptions(screen.getByLabelText("État après"), "maintenance");
    await user.click(screen.getByRole("button", { name: "Enregistrer la maintenance" }));
    await waitFor(() =>
      expect(recordMaintenance).toHaveBeenCalledWith(5, {
        description: "Graissage des glissières",
        cost: null,
        status: "maintenance",
      }),
    );

    // Rayan's slot, not the viewer's: a reason is asked, for the e-mail Rayan receives.
    const row = screen.getByText("Usinage des entretoises").closest("li")!;
    await user.click(within(row).getByRole("button", { name: /^Annuler le créneau/ }));
    await user.type(within(row).getByLabelText("Pourquoi (le membre est prévenu)"), "Machine en panne");
    await user.click(within(row).getByRole("button", { name: "Confirmer l'annulation" }));
    await waitFor(() => expect(cancelReservation).toHaveBeenCalledWith(1, "Machine en panne"));
  });
});

describe("MyWorkshop", () => {
  it("lists the viewer's coming slots and loans; a request may be withdrawn", async () => {
    vi.mocked(fetchMyReservations).mockResolvedValue([
      slot(1, { reserved_by: { id: 1, first_name: "Lina", last_name: "Demo" } }),
    ]);
    vi.mocked(fetchLoans).mockResolvedValue([
      loan(3, { permissions: { decide: false, receive: false, cancel: true } }),
    ]);
    vi.mocked(cancelLoan).mockResolvedValue(loan(3, { status: "cancelled" }));
    const user = userEvent.setup();
    renderWithProviders(<MyWorkshop />);
    expect(await screen.findByRole("link", { name: "Tour" })).toHaveAttribute("href", "/fr/workshop/5");
    expect(fetchMyReservations).toHaveBeenCalledWith("upcoming");
    expect(fetchLoans).toHaveBeenCalledWith({ mine: true });
    expect(await screen.findByRole("link", { name: "Pied à coulisse" })).toHaveAttribute("href", "/fr/workshop/6");
    await user.click(screen.getByRole("button", { name: "Retirer la demande" }));
    await waitFor(() => expect(cancelLoan).toHaveBeenCalledWith(3));
  });
});

describe("LoansToHandle", () => {
  it("is for the managers only", async () => {
    renderWithProviders(<LoansToHandle />);
    expect(await screen.findByText(/Cette page est réservée aux gestionnaires/)).toBeInTheDocument();
    expect(fetchLoans).not.toHaveBeenCalled();
  });

  it("shows the requests and what is out, the late ones marked; records a return", async () => {
    vi.mocked(fetchWorkshopRights).mockResolvedValue(LEAD_RIGHTS);
    const out = loan(4, {
      status: "out",
      overdue: true,
      permissions: { decide: false, receive: true, cancel: false },
    });
    vi.mocked(fetchLoans).mockImplementation(async (filters = {}) => (filters.status === "out" ? [out] : []));
    vi.mocked(returnLoan).mockResolvedValue(loan(4, { status: "returned" }));
    const user = userEvent.setup();
    renderWithProviders(<LoansToHandle />);
    expect(await screen.findByText("Aucune demande.")).toBeInTheDocument();
    const card = (await screen.findByText("En retard")).closest("li")!;
    await user.click(within(card).getByRole("button", { name: "Noter le retour" }));
    await user.selectOptions(within(card).getByLabelText("État au retour"), "damaged");
    await user.type(within(card).getByLabelText("Note (facultatif)"), "Bec tordu");
    await user.click(within(card).getByRole("button", { name: "Enregistrer le retour" }));
    await waitFor(() => expect(returnLoan).toHaveBeenCalledWith(4, "damaged", "Bec tordu"));
  });
});
