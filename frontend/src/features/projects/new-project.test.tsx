import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { createProject, fetchProjectCreating } from "@/features/work/api";
import { member, membership, project, role, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { NewProject } from "./new-project";

const router = { push: vi.fn() };

vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/features/members/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members/api")>()),
  fetchMembers: vi.fn(),
  fetchOrgUnits: vi.fn(),
}));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchProjectCreating: vi.fn(),
  createProject: vi.fn(),
}));

const fsTeam = unit(1, "Formula Student Team", { code: "fs-team", type: "fs_team" });
const rov = unit(4, "MATE ROV", { code: "mate-rov", type: "club_pole" });
const media = unit(6, "Media Department");
const manager = role(20, "Project Manager", { can_be_project_manager: true, is_leadership: true });
const engineer = role(10, "Engineer", { scope: "fs_team" });

describe("NewProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchProjectCreating).mockResolvedValue({ can_create: true });
    vi.mocked(fetchOrgUnits).mockResolvedValue([fsTeam, rov, media]);
    vi.mocked(fetchMembers).mockResolvedValue([
      member(1, "Lina", "Demo", { memberships: [membership(media, manager)] }),
      member(2, "Rayan", "Demo", { memberships: [membership(fsTeam, engineer)] }),
      member(3, "Yacine", "Demo", {
        memberships: [membership(media, manager, { end_date: "2025-06-30" })],
      }),
      member(4, "Ancien", "Demo", { status: "alumni" }),
    ]);
  });

  it("creates a project in the unit of its kind, with any member still in the team as its manager", async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue(project(12, "MATE ROV 2027", { category: "complementary_competition" }));
    renderWithProviders(<NewProject />);
    await user.type(await screen.findByLabelText("Nom du projet"), "MATE ROV 2027");
    await user.selectOptions(screen.getByLabelText("Catégorie"), "complementary_competition");
    expect(screen.getByLabelText("Unité responsable")).toHaveValue("4"); // the MATE ROV team's
    const managers = screen.getByLabelText("Chef de projet");
    // The Board names anyone (the ERP gives the Project Manager role to who lacks it), not the former members.
    expect([...managers.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Pas encore de chef de projet",
      "Lina Demo",
      "Rayan Demo",
      "Yacine Demo",
    ]);
    await user.selectOptions(managers, "1");
    await user.type(screen.getByLabelText("Préfixe des références"), "rov27");
    await user.click(screen.getByRole("button", { name: "Créer le projet" }));
    expect(createProject).toHaveBeenCalledWith({
      name: "MATE ROV 2027",
      category: "complementary_competition",
      org_unit_id: 4,
      project_manager_id: 1,
      status: "planned",
      key: "ROV27",
      start_date: null,
      end_date: null,
      description: "",
    });
    expect(router.push).toHaveBeenCalledWith("/projects/12");
  });

  it("puts the cars' projects in the Formula Student team", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewProject />);
    await user.selectOptions(await screen.findByLabelText("Catégorie"), "ev");
    expect(screen.getByLabelText("Unité responsable")).toHaveValue("1");
  });

  it("tells the others that only the Board and the Team Manager create projects", async () => {
    vi.mocked(fetchProjectCreating).mockResolvedValue({ can_create: false });
    renderWithProviders(<NewProject />);
    expect(await screen.findByText("Seuls le Board et le Team Manager créent les projets.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Créer le projet" })).not.toBeInTheDocument();
  });
});
