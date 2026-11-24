import { describe, expect, it } from "vitest";
import { member, membership, role, unit } from "@/test/fixtures";
import { buildOrgChart } from "./tree";

const TODAY = "2026-10-18";

const team = unit(1, "ENP Racing Team", { type: "root" });
const projects = unit(2, "Project Department", { parent: 1 });
const bureau = unit(3, "Executive Bureau", { type: "governing_body", parent: 1 });
const fsTeam = unit(4, "Formula Student Team", { type: "fs_team", parent: 2 });
const aero = unit(5, "Aerodynamics", { type: "fs_department", parent: 4 });
const chassis = unit(6, "Chassis & Ergonomics", { type: "fs_department", parent: 4 });
const closed = unit(7, "Old Pole", { type: "club_pole", parent: 1, is_active: false });
const orphan = unit(8, "Temporary Cell", { parent: 99 });

const lead = role(1, "Aerodynamics Lead Engineer", { is_leadership: true });
const engineer = role(2, "Aerodynamics Engineer");

const yanis = member(1, "Yanis", "Zed", { memberships: [membership(aero, engineer)] });
const amel = member(2, "Amel", "Demo", { memberships: [membership(aero, lead), membership(bureau, engineer)] });
const nour = member(3, "Nour", "Alpha", { memberships: [membership(aero, engineer)] });
const gone = member(4, "Old", "Member", { memberships: [membership(aero, engineer, { end_date: "2026-01-31" })] });

const tree = buildOrgChart(
  [aero, chassis, fsTeam, projects, bureau, team, closed, orphan],
  [yanis, amel, nour, gone],
  TODAY,
);

describe("buildOrgChart", () => {
  it("rebuilds the hierarchy from the parent of each unit", () => {
    expect(tree.map((node) => node.unit.name)).toEqual(["ENP Racing Team", "Temporary Cell"]);
    const [root] = tree;
    // Governing bodies come before departments.
    expect(root.children.map((node) => node.unit.name)).toEqual(["Executive Bureau", "Project Department"]);
    expect(root.children[1].children[0].children.map((node) => node.unit.name)).toEqual([
      "Aerodynamics",
      "Chassis & Ergonomics",
    ]);
  });

  it("leaves out inactive units and keeps a unit whose parent is missing", () => {
    const names = JSON.stringify(tree);
    expect(names).not.toContain("Old Pole");
    expect(tree[1].unit.name).toBe("Temporary Cell");
  });

  it("lists current members, leaders first, then by last name", () => {
    const aeroNode = tree[0].children[1].children[0].children[0];
    expect(aeroNode.people.map((person) => person.member.first_name)).toEqual(["Amel", "Nour", "Yanis"]);
  });

  it("counts each person once in a branch", () => {
    // Amel is in the bureau and in aerodynamics: 3 different people in the whole team.
    expect(tree[0].total).toBe(3);
    expect(tree[0].children[0].total).toBe(1);
  });
});
