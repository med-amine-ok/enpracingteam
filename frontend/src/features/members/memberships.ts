import type { Membership } from "./api";

/** Memberships that have not ended on `today` ("YYYY-MM-DD"), the primary one first. */
export function currentMemberships<T extends Pick<Membership, "end_date" | "is_primary">>(
  memberships: T[],
  today: string,
) {
  return memberships
    .filter((membership) => !membership.end_date || membership.end_date >= today)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
}

/** Memberships that ended before `today`, the most recent first. */
export function pastMemberships<T extends Pick<Membership, "end_date">>(memberships: T[], today: string) {
  return memberships
    .filter((membership) => membership.end_date && membership.end_date < today)
    .sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""));
}
