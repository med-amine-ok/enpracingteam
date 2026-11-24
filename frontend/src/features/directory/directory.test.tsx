import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchEngagementRights, fetchFollowedMembers } from "@/features/engagement/api";
import { fetchMemberAdding, fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { ApiError } from "@/lib/api/errors";
import { me, member, membership, role, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Directory } from "./directory";

vi.mock("@/features/members/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members/api")>()),
  fetchMembers: vi.fn(),
  fetchOrgUnits: vi.fn(),
  fetchMemberAdding: vi.fn(),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/engagement/api", () => ({ fetchEngagementRights: vi.fn(), fetchFollowedMembers: vi.fn() }));

const media = unit(1, "Media Department", { code: "dept-media" });
const aero = unit(2, "Aerodynamics", { type: "fs_department" });
const journalist = role(1, "Lead Journalist", { is_leadership: true });
const engineer = role(2, "Aerodynamics Engineer");

const lina = member(1, "Lina", "Demo", {
  race_number: 16,
  phone: "0555 12 34 56",
  facebook_url: "https://www.facebook.com/lina.demo",
  memberships: [membership(media, journalist, { is_primary: true, member_level: "main" })],
});
const rayan = member(2, "Rayan", "Demo", { memberships: [membership(aero, engineer)] });
const karim = member(3, "Karim", "Demo", {
  status: "alumni",
  alumni_profile: {
    graduation_year: 2023,
    current_position: "Ingénieur essais",
    current_company: "Atelier Demo",
    linkedin_url: null,
    willing_to_mentor: true,
  },
  facebook_url: "javascript:alert(1)",
  memberships: [membership(aero, engineer)],
});

describe("Directory", () => {
  beforeEach(() => {
    vi.mocked(fetchMembers).mockResolvedValue([lina, rayan, karim]);
    vi.mocked(fetchOrgUnits).mockResolvedValue([media, aero]);
    vi.mocked(fetchMemberAdding).mockResolvedValue({
      can_add: false,
      can_manage: false,
      unit_ids: [],
      roles: [],
      positions: [],
      projects: [],
    });
    vi.mocked(fetchMe).mockResolvedValue(me()); // Lina
    vi.mocked(fetchEngagementRights).mockResolvedValue({ leads: false, sees_all: false });
    vi.mocked(fetchFollowedMembers).mockResolvedValue([]);
  });

  it("offers to add a member only to who may (club admins, department heads)", async () => {
    const first = renderWithProviders(<Directory />);
    await screen.findAllByText(/Rayan/);
    expect(screen.queryByRole("link", { name: "Ajouter un membre" })).not.toBeInTheDocument();
    first.unmount();
    vi.mocked(fetchMemberAdding).mockResolvedValue({
      can_add: true,
      can_manage: false,
      unit_ids: [2],
      roles: [engineer],
      positions: [],
      projects: [],
    });
    renderWithProviders(<Directory />);
    expect(await screen.findByRole("link", { name: "Ajouter un membre" })).toHaveAttribute("href", "/fr/directory/new");
  });

  it("opens the full sheet of oneself and of the members one heads, not of the others", async () => {
    vi.mocked(fetchEngagementRights).mockResolvedValue({ leads: true, sees_all: false });
    vi.mocked(fetchFollowedMembers).mockResolvedValue([
      { id: 2, first_name: "Rayan", last_name: "Demo", goals: 0, volunteered: false },
    ]);
    renderWithProviders(<Directory />);
    expect(await screen.findByRole("link", { name: "Ouvrir la fiche complète de Rayan Demo" })).toHaveAttribute(
      "href",
      "/fr/members/2",
    );
    expect(screen.getByRole("link", { name: "Ouvrir la fiche complète de Lina Demo" })).toHaveAttribute(
      "href",
      "/fr/members/1",
    );
  });

  it("opens only one's own sheet for a member who heads nobody", async () => {
    renderWithProviders(<Directory />);
    expect(await screen.findByRole("link", { name: "Ouvrir la fiche complète de Lina Demo" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /fiche complète de Rayan/ })).not.toBeInTheDocument();
    expect(fetchFollowedMembers).not.toHaveBeenCalled();
  });

  it("lists active members with their primary role and unit", async () => {
    renderWithProviders(<Directory />);
    expect(await screen.findByText("2 membres")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Lina Demo" }).closest("li")!;
    expect(within(card).getByText("Lead Journalist · Media Department")).toBeInTheDocument();
    expect(within(card).getByText("Appartenance principale")).toBeInTheDocument();
    expect(within(card).getByText("Niveau : Principal")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Karim Demo" })).not.toBeInTheDocument();
  });

  it("shows a member's position in the club and their projects (decision D-025)", async () => {
    const board = unit(9, "Board of Directors", { code: "board", type: "governing_body" });
    const president = role(9, "President", { is_leadership: true, role_type: "admin" });
    vi.mocked(fetchMembers).mockResolvedValue([
      member(1, "Lina", "Demo", {
        memberships: [
          membership(media, journalist, { is_primary: true }),
          membership(board, president),
          membership(aero, engineer, { member_level: "junior" }),
        ],
        projects: [
          { id: 7, name: "EV 2027", category: "ev", manages: true },
          { id: 8, name: "MATE ROV 2027", category: "complementary_competition", manages: false },
        ],
      }),
    ]);
    renderWithProviders(<Directory />);
    const card = (await screen.findByRole("heading", { name: "Lina Demo" })).closest("li")!;
    expect(within(card).getByText("President")).toBeInTheDocument(); // the position, not "Board of Directors"
    expect(within(card).getByText("Aerodynamics")).toBeInTheDocument(); // another unit: its name
    const projects = within(card).getByRole("list", { name: "Projets de Lina Demo" });
    expect(
      within(projects)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["EV 2027· chef de projet", "MATE ROV 2027"]);
  });

  it("shows the members as driver cards in their department's livery, or as a list", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Directory />);
    const card = (await screen.findByRole("heading", { name: "Lina Demo" })).closest("li")!;
    expect(within(card).getByText("Mercedes")).toBeInTheDocument(); // the Media department's livery
    expect(within(card).getByText("Numéro", { exact: false }).parentElement).toHaveTextContent("Numéro 16");
    await user.click(screen.getByRole("button", { name: "Liste" }));
    expect(screen.getByRole("button", { name: "Liste" })).toHaveAttribute("aria-pressed", "true");
    const row = screen.getByRole("cell", { name: /Lead Journalist/ }).closest("tr")!;
    expect(within(row).getByRole("cell", { name: "16" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Écrire à Lina Demo" })).toHaveAttribute(
      "href",
      "mailto:lina.demo@example.invalid",
    );
  });

  it("shows where an alumni works now, and that they mentor the team", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Directory />);
    await user.selectOptions(await screen.findByLabelText("Statut"), "alumni");
    const card = screen.getByRole("heading", { name: "Karim Demo" }).closest("li")!;
    expect(within(card).getByText("Ingénieur essais · Atelier Demo")).toBeInTheDocument();
    expect(within(card).getByText("Mentor")).toBeInTheDocument();
  });

  it("shows phone and Facebook only when the API sends them", async () => {
    renderWithProviders(<Directory />);
    await screen.findByText("2 membres");
    expect(screen.getByRole("link", { name: "Appeler Lina Demo" })).toHaveAttribute("href", "tel:0555123456");
    expect(screen.getByRole("link", { name: "Profil Facebook de Lina Demo" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getByRole("link", { name: "Écrire à Rayan Demo" })).toHaveAttribute(
      "href",
      "mailto:rayan.demo@example.invalid",
    );
    expect(screen.queryByRole("link", { name: "Appeler Rayan Demo" })).not.toBeInTheDocument();
  });

  it("never turns a dangerous address into a link", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Directory />);
    await screen.findByText("2 membres");
    await user.selectOptions(screen.getByLabelText("Statut"), "all");
    expect(await screen.findByRole("heading", { name: "Karim Demo" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Profil Facebook de Karim Demo" })).not.toBeInTheDocument();
  });

  it("searches as you type and filters by unit", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Directory />);
    await screen.findByText("2 membres");
    await user.type(screen.getByLabelText("Rechercher"), "journalist");
    expect(await screen.findByText("1 membre")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Rechercher"));
    await user.selectOptions(screen.getByLabelText("Unité"), "Aerodynamics");
    expect(await screen.findByText("1 membre")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rayan Demo" })).toBeInTheDocument();
  });

  it("says when nobody matches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Directory />);
    await screen.findByText("2 membres");
    await user.type(screen.getByLabelText("Rechercher"), "nobody");
    expect(await screen.findByText("Aucun membre ne correspond")).toBeInTheDocument();
    expect(screen.getByText("Aucun membre")).toBeInTheDocument();
  });

  it("shows the API's error with a way to try again", async () => {
    vi.mocked(fetchMembers).mockRejectedValue(new ApiError(0, ""));
    renderWithProviders(<Directory />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de joindre le serveur.");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("counts in Arabic with Arabic plurals and Latin digits", async () => {
    vi.mocked(fetchMembers).mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => member(10 + index, `Demo${index}`, "Person")),
    );
    renderWithProviders(<Directory />, { locale: "ar" });
    expect(await screen.findByText("11 عضوًا")).toBeInTheDocument();
  });
});
