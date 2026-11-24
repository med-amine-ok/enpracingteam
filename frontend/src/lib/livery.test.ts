import { describe, expect, it } from "vitest";
import { liveryKeyOfUnit, liveryOfMemberships, type UnitInTree } from "./livery";

const UNITS: UnitInTree[] = [
  { id: 1, code: "enp-racing-team", parent: null },
  { id: 2, code: "dept-media", parent: 1 },
  { id: 3, code: "media-photo", parent: 2 }, // added later by an admin
  { id: 4, code: "media-photo-drones", parent: 3 },
  { id: 5, code: "executive-bureau", parent: 1 },
];

describe("liveryKeyOfUnit", () => {
  it("gives a department its team, and the Formula Student units the Project's", () => {
    expect(liveryKeyOfUnit("dept-media")).toBe("medias");
    expect(liveryKeyOfUnit("fs-electronics")).toBe("projet");
    expect(liveryKeyOfUnit("executive-bureau")).toBe("team");
    expect(liveryKeyOfUnit(null)).toBe("team");
  });

  it("gives a unit added under a department that department's livery, once the org units are known", () => {
    expect(liveryKeyOfUnit("media-photo")).toBe("team"); // its code alone says nothing
    expect(liveryKeyOfUnit("media-photo", UNITS)).toBe("medias");
    expect(liveryKeyOfUnit("media-photo-drones", UNITS)).toBe("medias");
    expect(liveryKeyOfUnit("executive-bureau", UNITS)).toBe("team");
  });
});

describe("liveryOfMemberships", () => {
  const media = { code: "dept-media" };
  const operations = { code: "dept-operations" };

  it("takes the main current membership, also one ending later, never one already over or not begun", () => {
    const today = "2026-10-23";
    expect(
      liveryOfMemberships(
        [
          { is_primary: true, start_date: "2025-09-01", end_date: "2026-06-30", org_unit: operations }, // over
          { is_primary: false, start_date: "2025-09-01", end_date: "2027-06-30", org_unit: media }, // ends later
        ],
        today,
      ).team,
    ).toBe("Mercedes");
    expect(
      liveryOfMemberships([{ is_primary: true, start_date: "2026-11-01", end_date: null, org_unit: operations }], today)
        .team,
    ).toBe("ENP Racing"); // not begun yet
  });
});
