import type { Member, MemberStatus } from "./api";
import { currentMemberships } from "./memberships";

export type StatusFilter = MemberStatus | "all";

export type DirectoryFilters = {
  query: string;
  /** Only members currently in this unit (null: every unit). */
  unitId: number | null;
  status: StatusFilter;
};

/**
 * Text as compared by the search: lower case, without accents (é → e) or Arabic short vowels and
 * tatweel, so "helene" finds "Hélène".
 */
export function normalizeText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯؐ-ًؚ-ٰٟـ]/g, "")
    .toLowerCase()
    .trim();
}

/** Every word of `query` appears in the member's name, e-mail, skills, units or roles. */
export function memberMatches(member: Member, query: string, today: string) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const memberships = currentMemberships(member.memberships, today);
  const text = normalizeText(
    [
      member.first_name,
      member.last_name,
      member.email,
      member.skill ?? "",
      ...memberships.flatMap((membership) => [membership.org_unit.name, membership.role.name]),
    ].join(" "),
  );
  return words.every((word) => text.includes(word));
}

export function filterMembers(members: Member[], { query, unitId, status }: DirectoryFilters, today: string) {
  return members.filter(
    (member) =>
      (status === "all" || (member.status ?? "active") === status) &&
      (unitId === null ||
        currentMemberships(member.memberships, today).some((membership) => membership.org_unit.id === unitId)) &&
      memberMatches(member, query, today),
  );
}
