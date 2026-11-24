import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMembership,
  changeMember,
  endMembership,
  fetchMemberAdding,
  fetchMemberManage,
  fetchOrgUnits,
  type MemberManage,
} from "@/features/members/api";
import { ApiError } from "@/lib/api/errors";
import { membership, role, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { EditMember } from "./edit-member";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "2" }),
}));
vi.mock("@/features/members/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members/api")>()),
  fetchOrgUnits: vi.fn(),
  fetchMemberAdding: vi.fn(),
  fetchMemberManage: vi.fn(),
  changeMember: vi.fn(),
  addMembership: vi.fn(),
  endMembership: vi.fn(),
}));

const electronics = unit(2, "Electronics", { type: "fs_department" });
const aero = unit(3, "Aerodynamics", { type: "fs_department" });
const board = unit(5, "Board of Directors", { code: "board", type: "governing_body" });
const engineer = role(10, "Engineer", { scope: "fs_team" });
const president = role(30, "President", { is_leadership: true, role_type: "admin" });
const mainMembership = membership(electronics, engineer, { id: 101, is_primary: true, member_level: "main" });

function rayan(overrides: Partial<MemberManage> = {}): MemberManage {
  return {
    id: 2,
    first_name: "Rayan",
    last_name: "Demo",
    email: "rayan.demo@example.invalid",
    phone: "",
    study_level: "",
    status: "active",
    memberships: [mainMembership],
    projects: [7],
    ...overrides,
  };
}

describe("EditMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchOrgUnits).mockResolvedValue([electronics, aero, board]);
    vi.mocked(fetchMemberManage).mockResolvedValue(rayan());
    vi.mocked(fetchMemberAdding).mockResolvedValue({
      can_add: true,
      can_manage: true,
      unit_ids: [2, 3, 5],
      roles: [engineer, president],
      positions: [{ id: 30, name: "President", unit: { id: 5, code: "board", name: board.name, type: board.type } }],
      projects: [
        { id: 7, name: "EV 2027", category: "ev" },
        { id: 8, name: "MATE ROV 2027", category: "complementary_competition" },
      ],
    });
  });

  it("changes who the member is, their status and their projects", async () => {
    const user = userEvent.setup();
    vi.mocked(changeMember).mockResolvedValue(rayan({ first_name: "Rayane", status: "on_leave", projects: [7, 8] }));
    renderWithProviders(<EditMember />);
    expect(await screen.findByRole("heading", { level: 1, name: "Modifier Rayan Demo" })).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Identité et projets" });
    expect(within(form).getByRole("checkbox", { name: /EV 2027/ })).toBeChecked();
    await user.clear(within(form).getByLabelText("Prénom"));
    await user.type(within(form).getByLabelText("Prénom"), "Rayane");
    await user.selectOptions(within(form).getByLabelText("Statut"), "on_leave");
    await user.click(within(form).getByRole("checkbox", { name: /MATE ROV 2027/ }));
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    expect(changeMember).toHaveBeenCalledWith(2, {
      first_name: "Rayane",
      last_name: "Demo",
      email: "rayan.demo@example.invalid",
      phone: "",
      study_level: "",
      status: "on_leave",
      project_ids: [7, 8],
    });
    expect(await within(form).findByText("Modifications enregistrées.")).toBeInTheDocument();
  });

  it("adds a membership, gives a position and ends a membership after a confirmation", async () => {
    const user = userEvent.setup();
    const aeroMembership = membership(aero, engineer, { id: 102, member_level: "junior" });
    vi.mocked(addMembership).mockResolvedValue(rayan({ memberships: [mainMembership, aeroMembership] }));
    vi.mocked(endMembership).mockResolvedValue(rayan({ memberships: [{ ...aeroMembership, is_primary: true }] }));
    renderWithProviders(<EditMember />);
    const add = await screen.findByRole("form", { name: "Ajouter une affectation" });
    await user.selectOptions(within(add).getByLabelText("Unité"), "3");
    await user.selectOptions(within(add).getByLabelText("Rôle"), "10");
    await user.selectOptions(within(add).getByLabelText("Niveau"), "junior");
    await user.click(within(add).getByRole("button", { name: "Ajouter l'affectation" }));
    expect(addMembership).toHaveBeenCalledWith(2, { org_unit_id: 3, role_id: 10, member_level: "junior" });
    const list = await screen.findByRole("list", { name: "Affectations et postes" });
    expect(await within(list).findByText("Aerodynamics · Junior")).toBeInTheDocument();

    const give = screen.getByRole("form", { name: "Donner un poste au club" });
    await user.selectOptions(within(give).getByLabelText("Poste au club"), "30");
    await user.click(within(give).getByRole("button", { name: "Donner ce poste" }));
    expect(addMembership).toHaveBeenLastCalledWith(2, { position_id: 30 });

    await user.click(within(list).getByRole("button", { name: "Retirer : Engineer · Electronics" }));
    expect(endMembership).not.toHaveBeenCalled(); // a confirmation first
    await user.click(within(list).getByRole("button", { name: "Confirmer le retrait" }));
    expect(endMembership).toHaveBeenCalledWith(2, 101);
  });

  it("tells the others that only the Board and the Team Manager edit the members", async () => {
    vi.mocked(fetchMemberManage).mockRejectedValue(
      new ApiError(403, "Seuls le Board et le Team Manager modifient les membres."),
    );
    renderWithProviders(<EditMember />);
    expect(await screen.findByText(/Seuls le Board et le Team Manager modifient les membres/)).toBeInTheDocument();
  });
});
