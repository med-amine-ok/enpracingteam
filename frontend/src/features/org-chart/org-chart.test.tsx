import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { member, membership, role, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { OrgChart } from "./org-chart";

vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));

const team = unit(1, "ENP Racing Team", { type: "root" });
const aero = unit(2, "Aerodynamics", { type: "fs_department", parent: 1 });
const board = unit(3, "Board of Directors", { type: "governing_body", parent: 1 });
const lead = role(1, "Aerodynamics Lead Engineer", { is_leadership: true });
const engineer = role(2, "Aerodynamics Engineer");
const boardMember = role(3, "Board Member", { is_leadership: true });

describe("OrgChart", () => {
  beforeEach(() => {
    vi.mocked(fetchOrgUnits).mockResolvedValue([team, aero, board]);
    vi.mocked(fetchMembers).mockResolvedValue([
      member(1, "Amel", "Demo", { memberships: [membership(aero, lead)] }),
      member(2, "Nour", "Demo", { memberships: [membership(aero, engineer)] }),
      member(3, "Sara", "Demo", { memberships: [membership(board, boardMember)] }),
    ]);
  });

  it("shows each unit with its type, its size and its leaders", async () => {
    renderWithProviders(<OrgChart />);
    expect(await screen.findByRole("heading", { name: "Aerodynamics" })).toBeInTheDocument();
    expect(screen.getByText("Département Formula Student")).toBeInTheDocument();
    expect(screen.getByText("3 membres")).toBeInTheDocument(); // the whole team
    expect(screen.getByText("2 membres")).toBeInTheDocument(); // aerodynamics
    expect(screen.getAllByRole("list", { name: "Responsables" })[1]).toHaveTextContent("Amel Demo");
    expect(screen.queryByText("Nour Demo")).not.toBeInTheDocument();
  });

  it("shows each department as a team in its livery, leading to its branch", async () => {
    const media = unit(4, "Media Department", { type: "club_department", parent: 1, code: "dept-media" });
    vi.mocked(fetchOrgUnits).mockResolvedValue([team, aero, board, media]);
    renderWithProviders(<OrgChart />);
    const teams = await screen.findByRole("region", { name: "Écuries départementales" });
    const card = within(teams).getByRole("link", { name: /Media Department/ });
    expect(card).toHaveAttribute("href", "/fr/org-chart/4");
    expect(card).toHaveTextContent("Mercedes");
  });

  it("opens and closes the list of the other members", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrgChart />);
    const toggle = await screen.findByRole("button", { name: "Voir les autres membres (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Nour Demo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Masquer les membres" }));
    expect(screen.queryByText("Nour Demo")).not.toBeInTheDocument();
  });

  it("does not repeat a unit whose members are all leaders", async () => {
    renderWithProviders(<OrgChart />);
    expect(await screen.findByRole("heading", { name: "Board of Directors" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Voir/ })).toHaveLength(1); // aerodynamics only
  });
});
