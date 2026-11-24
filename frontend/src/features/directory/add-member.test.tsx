import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMember, fetchMemberAdding, fetchOrgUnits } from "@/features/members/api";
import { ApiError } from "@/lib/api/errors";
import { member, membership, role, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AddMember } from "./add-member";

vi.mock("@/features/members/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/members/api")>()),
  fetchOrgUnits: vi.fn(),
  fetchMemberAdding: vi.fn(),
  addMember: vi.fn(),
}));

const media = unit(1, "Media Department", { code: "dept-media" });
const electronics = unit(2, "Electronics", { type: "fs_department" });
const operations = unit(3, "Operations"); // not the viewer's: not offered
const engineer = role(10, "Engineer", { scope: "fs_team" });
const lead = role(11, "Lead Engineer", { scope: "fs_team", is_leadership: true });
const reporter = role(12, "Reporter");

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Prénom"), "Nadia");
  await user.type(screen.getByLabelText("Nom"), "New");
  await user.type(screen.getByLabelText("Adresse e-mail (Gmail ou de l'école)"), "nadia.new@gmail.com");
}

describe("AddMember", () => {
  beforeEach(() => {
    vi.mocked(fetchOrgUnits).mockResolvedValue([media, electronics, operations]);
    vi.mocked(fetchMemberAdding).mockResolvedValue({
      can_add: true,
      can_manage: false,
      unit_ids: [1, 2],
      roles: [engineer, lead, reporter],
      positions: [],
      projects: [],
    });
    vi.mocked(addMember).mockReset();
  });

  it("adds a member to a unit with a role of that unit, then is ready for the next one", async () => {
    const user = userEvent.setup();
    vi.mocked(addMember).mockResolvedValue(
      member(42, "Nadia", "New", {
        email: "nadia.new@gmail.com",
        memberships: [membership(electronics, engineer)],
      }),
    );
    renderWithProviders(<AddMember />);
    await fill(user);
    const units = screen.getByLabelText("Unité");
    expect(within(units).queryByRole("option", { name: "Operations" })).not.toBeInTheDocument();
    await user.selectOptions(units, "2");
    // Electronics is a Formula Student unit: only the team's roles.
    const roles = screen.getByLabelText("Rôle");
    expect(
      within(roles)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Choisir un rôle", "Engineer", "Lead Engineer"]);
    await user.selectOptions(roles, "10");
    await user.selectOptions(screen.getByLabelText("Niveau"), "junior");
    await user.click(screen.getByRole("button", { name: "Ajouter le membre" }));
    expect(addMember).toHaveBeenCalledWith({
      first_name: "Nadia",
      last_name: "New",
      email: "nadia.new@gmail.com",
      org_unit_id: 2,
      role_id: 10,
      member_level: "junior",
      study_level: "",
      phone: "",
      position_id: null,
      project_ids: [],
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nadia New fait maintenant partie de l'ERP : un e-mail à nadia.new@gmail.com explique comment se connecter.",
    );
    expect(screen.getByRole("link", { name: "Voir sa fiche" })).toHaveAttribute("href", "/fr/members/42");
    expect(screen.getByLabelText("Prénom")).toHaveValue(""); // ready for the next one
  });

  it("asks no level for a leadership role, and says why the API refused", async () => {
    const user = userEvent.setup();
    vi.mocked(addMember).mockRejectedValue(new ApiError(400, "Un membre de l'ERP a déjà cette adresse."));
    renderWithProviders(<AddMember />);
    await fill(user);
    await user.selectOptions(screen.getByLabelText("Unité"), "2");
    await user.selectOptions(screen.getByLabelText("Rôle"), "11");
    expect(screen.queryByLabelText("Niveau")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ajouter le membre" }));
    expect(addMember).toHaveBeenCalledWith(expect.objectContaining({ role_id: 11, member_level: null }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Un membre de l'ERP a déjà cette adresse.");
  });

  it("lets the Board give a position in the club and put the member in projects (decision D-025)", async () => {
    const user = userEvent.setup();
    const board = unit(5, "Board of Directors", { code: "board", type: "governing_body" });
    vi.mocked(fetchMemberAdding).mockResolvedValue({
      can_add: true,
      can_manage: true,
      unit_ids: [1, 2],
      roles: [engineer, lead, reporter],
      positions: [{ id: 30, name: "President", unit: { id: 5, code: "board", name: board.name, type: board.type } }],
      projects: [
        { id: 7, name: "EV 2027", category: "ev" },
        { id: 8, name: "MATE ROV 2027", category: "complementary_competition" },
      ],
    });
    vi.mocked(addMember).mockResolvedValue(member(43, "Nadia", "New", { email: "nadia.new@gmail.com" }));
    renderWithProviders(<AddMember />);
    await fill(user);
    await user.selectOptions(screen.getByLabelText("Unité"), "2");
    await user.selectOptions(screen.getByLabelText("Rôle"), "10");
    await user.selectOptions(screen.getByLabelText("Poste au club (facultatif)"), "30");
    expect(screen.getByRole("option", { name: "President — Board of Directors" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /MATE ROV 2027/ }));
    await user.click(screen.getByRole("button", { name: "Ajouter le membre" }));
    expect(addMember).toHaveBeenCalledWith(expect.objectContaining({ position_id: 30, project_ids: [8] }));
    // Ready for the next one: no position, no project ticked.
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getByLabelText("Poste au club (facultatif)")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /MATE ROV 2027/ })).not.toBeChecked();
  });

  it("tells the others that only admins and heads add members", async () => {
    vi.mocked(fetchMemberAdding).mockResolvedValue({
      can_add: false,
      can_manage: false,
      unit_ids: [],
      roles: [],
      positions: [],
      projects: [],
    });
    renderWithProviders(<AddMember />);
    expect(
      await screen.findByText("Seuls les administrateurs du club et les chefs de département ajoutent des membres."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter le membre" })).not.toBeInTheDocument();
  });
});
