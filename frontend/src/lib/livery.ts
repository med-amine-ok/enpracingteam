/**
 * The liveries of the team's Figma (decision D-022): each department races in the colours of a Formula 1
 * team ("écuries départementales"), and each section of the ERP shows one in its top bar. The pictures are in
 * public/racing. The colours of the rest of the ERP stay racing red and night blue (globals.css).
 */

export type Livery = {
  /** The department's colour. */
  color: string;
  /** Its darker shade, where gradients start. */
  shade: string;
  /** The text on that colour. */
  foreground: string;
  /** The colour itself as text on white or on the canvas: darkened where needed (WCAG AA, 4.5:1 at least). */
  text: string;
  /** The Formula 1 team whose livery it wears. */
  team: string;
  car: string | null;
  logo: string;
};

const LIVERIES = {
  projet: {
    color: "#dc0000",
    shade: "#5c0012",
    foreground: "#ffffff",
    text: "#dc0000",
    team: "Ferrari",
    car: "/racing/ferrari-car.webp",
    logo: "/racing/ferrari-logo.webp",
  },
  formation: {
    color: "#ff8000",
    shade: "#804000",
    foreground: "#ffffff",
    text: "#a85400",
    team: "McLaren",
    car: "/racing/mclaren-car.webp",
    logo: "/racing/mclaren-logo.webp",
  },
  medias: {
    color: "#27f4d2",
    shade: "#067e6a",
    foreground: "#0a2a2a",
    text: "#067e6a",
    team: "Mercedes",
    car: "/racing/mercedes-car.webp",
    logo: "/racing/mercedes-logo.webp",
  },
  si: {
    color: "#3671c6",
    shade: "#142948",
    foreground: "#ffffff",
    text: "#3671c6",
    team: "Red Bull Racing",
    car: "/racing/red-bull-car.webp",
    logo: "/racing/red-bull-logo.webp",
  },
  business: {
    color: "#229971",
    shade: "#0f4331",
    foreground: "#ffffff",
    text: "#16704f",
    team: "Aston Martin",
    car: "/racing/aston-martin-car.webp",
    logo: "/racing/aston-martin-logo.webp",
  },
  operations: {
    color: "#0093cc",
    shade: "#004e70",
    foreground: "#ffffff",
    text: "#00719e",
    team: "Alpine",
    car: "/racing/alpine-car.webp",
    logo: "/racing/alpine-logo.webp",
  },
  // The Executive Bureau, the board and the whole team: the club's own colours.
  team: {
    color: "#be1e2d",
    shade: "#5c0e16",
    foreground: "#ffffff",
    text: "#be1e2d",
    team: "ENP Racing",
    car: null,
    logo: "/racing/logo-mark.webp",
  },
} satisfies Record<string, Livery>;

export type LiveryKey = keyof typeof LIVERIES;

/** Department code (seed_org_units) → livery; the Formula Student Team and its departments are the Project's. */
const UNIT_LIVERIES: Record<string, LiveryKey> = {
  "dept-projet": "projet",
  "fs-team": "projet",
  "dept-training-industry": "formation",
  "dept-media": "medias",
  "dept-information-systems": "si",
  "dept-business-projects": "business",
  "dept-operations": "operations",
};

export function livery(key: LiveryKey): Livery {
  return LIVERIES[key];
}

/** A unit as the org units list gives it: enough to climb to its department. */
export type UnitInTree = { id: number; code: string | null; parent?: number | null };

/** The livery of a unit, from its code: its department's, the club's for the others (or a unit without code).
 * With the org units list, a unit added later under a department (any code) wears that department's livery. */
export function liveryKeyOfUnit(code: string | null | undefined, units?: UnitInTree[]): LiveryKey {
  if (!code) {
    return "team";
  }
  if (code.startsWith("fs-")) {
    return "projet";
  }
  if (UNIT_LIVERIES[code]) {
    return UNIT_LIVERIES[code];
  }
  const byId = new Map((units ?? []).map((unit) => [unit.id, unit]));
  let unit = (units ?? []).find((item) => item.code === code);
  for (let steps = 0; unit && steps < 10; steps += 1) {
    const known = unit.code ? UNIT_LIVERIES[unit.code] : undefined;
    if (known) {
      return known;
    }
    unit = unit.parent == null ? undefined : byId.get(unit.parent);
  }
  return "team";
}

export function liveryOfUnit(code: string | null | undefined, units?: UnitInTree[]): Livery {
  return LIVERIES[liveryKeyOfUnit(code, units)];
}

type MembershipLike = {
  is_primary?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  org_unit: { code: string | null };
};

/** A member's livery: the one of their main current membership (else their first current one). `today` is the
 * club's day ("2026-10-23", lib/dates clubToday): a membership ending later still counts, one not started yet
 * does not. */
export function liveryOfMemberships(
  memberships: MembershipLike[] | undefined,
  today: string,
  units?: UnitInTree[],
): Livery {
  const current = (memberships ?? []).filter(
    (membership) =>
      (!membership.start_date || membership.start_date <= today) &&
      (!membership.end_date || membership.end_date >= today),
  );
  const main = current.find((membership) => membership.is_primary) ?? current[0];
  return liveryOfUnit(main?.org_unit.code, units);
}

/** The livery shown in the top bar of each section, as in the Figma (home and projects: Ferrari…). */
export const SECTION_LIVERIES: Record<string, LiveryKey> = {
  home: "projet",
  profile: "medias",
  directory: "medias",
  orgChart: "formation",
  projects: "projet",
  tasks: "si",
  work: "projet",
  scoring: "business",
  meetings: "formation",
  documents: "operations",
  workshop: "medias",
  team: "business",
  ranking: "projet",
  discipline: "si",
  engagement: "operations",
  assistant: "si",
  purchasing: "business",
  stock: "operations",
  finance: "business",
  notifications: "medias",
};
