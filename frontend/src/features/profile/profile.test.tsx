import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchMe,
  updateAlumniProfile,
  updateLanguage,
  updateMutedEmailTopics,
  updateRaceNumber,
  updateStudies,
} from "@/features/auth/api";
import { me, membership, role, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ProfileView } from "./profile-view";

const router = { replace: vi.fn() };

vi.mock("@/features/auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/api")>()),
  fetchMe: vi.fn(),
  updateLanguage: vi.fn(),
  updateStudies: vi.fn(),
  updateRaceNumber: vi.fn(),
  updateAlumniProfile: vi.fn(),
  updateMutedEmailTopics: vi.fn(),
}));
// The presence card of the page: no session yet.
vi.mock("@/features/meetings/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/meetings/api")>()),
  fetchPresence: vi.fn().mockResolvedValue({ score: null, history: [] }),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
  usePathname: () => "/profile",
}));

const media = unit(1, "Media Department");
const aero = unit(2, "Aerodynamics");

describe("ProfileView", () => {
  beforeEach(() => {
    router.replace.mockReset();
    vi.mocked(updateLanguage).mockResolvedValue(undefined);
    vi.mocked(fetchMe).mockResolvedValue(
      me({
        phone: "0555 12 34 56",
        memberships: [
          membership(media, role(1, "Lead Journalist"), { is_primary: true, start_date: "2025-10-01" }),
          membership(aero, role(2, "Aerodynamics Engineer"), { start_date: "2024-10-01", end_date: "2025-06-30" }),
        ],
      }),
    );
  });

  it("shows the member's details, with what is missing said plainly", async () => {
    renderWithProviders(<ProfileView />);
    expect(await screen.findByRole("heading", { name: "Lina Demo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0555 12 34 56" })).toHaveAttribute("href", "tel:0555123456");
    expect(screen.getAllByText("Non renseigné")).toHaveLength(2); // Facebook and skills
  });

  it("separates current and past memberships, with their dates", async () => {
    renderWithProviders(<ProfileView />);
    expect(await screen.findByText("Lead Journalist · depuis le 1 octobre 2025")).toBeInTheDocument();
    expect(screen.getByText("Appartenances passées")).toBeInTheDocument();
    expect(screen.getByText("Aerodynamics Engineer · du 1 octobre 2024 au 30 juin 2025")).toBeInTheDocument();
  });

  it("saves the preferred language and switches the pages to it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfileView />);
    await user.selectOptions(await screen.findByLabelText("Langue préférée"), "ar");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/profile", { locale: "ar" }));
    expect(updateLanguage).toHaveBeenCalledWith("ar");
  });

  it("can go back to following the browser", async () => {
    vi.mocked(fetchMe).mockResolvedValue(me({ language: "fr" }));
    const user = userEvent.setup();
    renderWithProviders(<ProfileView />);
    await user.selectOptions(await screen.findByLabelText("Langue préférée"), "");
    expect(await screen.findByText("Préférence enregistrée.")).toBeInTheDocument();
    expect(updateLanguage).toHaveBeenCalledWith("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("saves the year and field of study, and leads to the member's full sheet", async () => {
    vi.mocked(updateStudies).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<ProfileView />);
    expect(await screen.findByRole("link", { name: "Ma fiche complète" })).toHaveAttribute("href", "/fr/members/1");
    await user.selectOptions(screen.getByLabelText("Année d'étude"), "prep_2");
    await user.type(screen.getByLabelText("Filière"), "Classes préparatoires ST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Études enregistrées.")).toBeInTheDocument();
    expect(updateStudies).toHaveBeenCalledWith({ study_level: "prep_2", study_field: "Classes préparatoires ST" });
  });

  it("lets the member choose their race number, then give it up", async () => {
    vi.mocked(updateRaceNumber).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<ProfileView />);
    await user.type(await screen.findByLabelText("Numéro (1 à 99)"), "16");
    await user.click(screen.getByRole("button", { name: "Prendre ce numéro" }));
    expect(await screen.findByText("Numéro enregistré.")).toBeInTheDocument();
    expect(updateRaceNumber).toHaveBeenCalledWith(16);
    await user.click(screen.getByRole("button", { name: "Libérer mon numéro" }));
    await waitFor(() => expect(updateRaceNumber).toHaveBeenLastCalledWith(null));
    await waitFor(() => expect(screen.getByLabelText("Numéro (1 à 99)")).toHaveValue(null));
  });

  it("lets the member turn off e-mails by subject, never the warnings", async () => {
    vi.mocked(updateMutedEmailTopics).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<ProfileView />);
    const workshop = await screen.findByRole("checkbox", { name: "Atelier : prêts et réservations" });
    expect(workshop).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Avertissements et exclusions/ })).toBeDisabled();
    await user.click(workshop);
    await user.click(screen.getByRole("checkbox", { name: "Classement du mois" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(await screen.findByText("Vos choix d'e-mails sont enregistrés.")).toBeInTheDocument();
    expect(updateMutedEmailTopics).toHaveBeenCalledWith(["workshop", "ranking"]);
  });

  it("refuses a number outside 1 to 99 without asking the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfileView />);
    await user.type(await screen.findByLabelText("Numéro (1 à 99)"), "120");
    await user.click(screen.getByRole("button", { name: "Prendre ce numéro" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez un nombre entier de 1 à 99.");
    expect(updateRaceNumber).not.toHaveBeenCalled();
  });

  it("asks an alumni, and only an alumni, about their life after the team", async () => {
    renderWithProviders(<ProfileView />);
    await screen.findByRole("heading", { name: "Lina Demo" });
    expect(screen.queryByText("Profil d'ancien membre")).not.toBeInTheDocument();
  });

  it("saves the alumni profile", async () => {
    vi.mocked(fetchMe).mockResolvedValue(me({ status: "alumni" }));
    const profile = {
      graduation_year: 2024,
      current_position: "Ingénieure calcul",
      current_company: "Atelier Demo",
      linkedin_url: "https://www.linkedin.com/in/lina-demo",
      willing_to_mentor: true,
    };
    vi.mocked(updateAlumniProfile).mockResolvedValue(profile);
    const user = userEvent.setup();
    renderWithProviders(<ProfileView />);
    await user.type(await screen.findByLabelText("Année de sortie de l'école"), "2024");
    await user.type(screen.getByLabelText("Entreprise"), "Atelier Demo");
    await user.type(screen.getByLabelText("Poste actuel"), "Ingénieure calcul");
    await user.type(screen.getByLabelText("Profil LinkedIn (lien)"), "https://www.linkedin.com/in/lina-demo");
    await user.click(screen.getByRole("checkbox", { name: /parrainer/ }));
    await user.click(screen.getByRole("button", { name: "Enregistrer le profil" }));
    expect(await screen.findByText("Profil enregistré.")).toBeInTheDocument();
    expect(updateAlumniProfile).toHaveBeenCalledWith(profile);
  });
});
