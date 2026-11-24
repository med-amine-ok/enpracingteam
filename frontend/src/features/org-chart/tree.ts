import type { Member, Membership, OrgUnit, UnitType } from "@/features/members/api";
import { currentMemberships } from "@/features/members/memberships";

export type UnitPerson = { member: Member; membership: Membership };

export type UnitNode = {
  unit: OrgUnit;
  /** People currently in this unit: leaders first, then by name. */
  people: UnitPerson[];
  children: UnitNode[];
  /** Distinct people in this unit and every unit below it. */
  total: number;
};

// Order of the branches under a unit: governing bodies before departments, the FS team last.
const TYPE_ORDER: UnitType[] = ["root", "governing_body", "club_department", "club_pole", "fs_team", "fs_department"];

function byName(a: UnitPerson, b: UnitPerson) {
  return a.member.last_name.localeCompare(b.member.last_name) || a.member.first_name.localeCompare(b.member.first_name);
}

/** The tree of the active units, each with its current members. */
export function buildOrgChart(units: OrgUnit[], members: Member[], today: string): UnitNode[] {
  const peopleByUnit = new Map<number, UnitPerson[]>();
  for (const member of members) {
    for (const membership of currentMemberships(member.memberships, today)) {
      const list = peopleByUnit.get(membership.org_unit.id) ?? [];
      list.push({ member, membership });
      peopleByUnit.set(membership.org_unit.id, list);
    }
  }

  const active = units.filter((unit) => unit.is_active !== false);
  const ids = new Set(active.map((unit) => unit.id));
  const childrenOf = new Map<number | null, OrgUnit[]>();
  for (const unit of active) {
    // A unit whose parent is missing or inactive is shown at the top rather than lost.
    const parent = unit.parent != null && ids.has(unit.parent) ? unit.parent : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), unit]);
  }

  function build(unit: OrgUnit): UnitNode {
    const people = [...(peopleByUnit.get(unit.id) ?? [])].sort(
      (a, b) => Number(!!b.membership.role.is_leadership) - Number(!!a.membership.role.is_leadership) || byName(a, b),
    );
    const children = sortUnits(childrenOf.get(unit.id) ?? []).map(build);
    const everyone = new Set(people.map((person) => person.member.id));
    for (const child of children) {
      collectIds(child, everyone);
    }
    return { unit, people, children, total: everyone.size };
  }

  return sortUnits(childrenOf.get(null) ?? []).map(build);
}

function sortUnits(units: OrgUnit[]) {
  return [...units].sort(
    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name),
  );
}

function collectIds(node: UnitNode, ids: Set<number>) {
  node.people.forEach((person) => ids.add(person.member.id));
  node.children.forEach((child) => collectIds(child, ids));
}
