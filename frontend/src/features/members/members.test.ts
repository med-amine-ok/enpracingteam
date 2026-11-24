import { describe, expect, it } from "vitest";
import { member, membership, role, unit } from "@/test/fixtures";
import { currentMemberships, pastMemberships } from "./memberships";
import { filterMembers, memberMatches, normalizeText } from "./search";

const TODAY = "2026-10-18";
const media = unit(1, "Media & Scientific Journalism Department");
const powertrain = unit(2, "Powertrain", { type: "fs_department" });
const journalist = role(1, "Lead Journalist", { is_leadership: true });
const engineer = role(2, "Powertrain Engineer");

describe("memberships", () => {
  const ongoing = membership(media, journalist);
  const endsToday = membership(powertrain, engineer, { end_date: TODAY, is_primary: true });
  const ended = membership(powertrain, engineer, { end_date: "2026-06-30" });
  const older = membership(media, engineer, { end_date: "2025-06-30" });

  it("current ones: not ended yet, primary first", () => {
    expect(currentMemberships([ongoing, ended, endsToday], TODAY)).toEqual([endsToday, ongoing]);
  });

  it("past ones: most recent first", () => {
    expect(pastMemberships([older, ongoing, ended], TODAY)).toEqual([ended, older]);
  });
});

describe("search", () => {
  const helene = member(1, "Hélène", "Démo", {
    skill: "SolidWorks, ANSYS",
    memberships: [membership(media, journalist)],
  });
  const karim = member(2, "Karim", "Demo", {
    status: "alumni",
    memberships: [membership(powertrain, engineer), membership(media, engineer, { end_date: "2026-01-31" })],
  });

  it("ignores accents, case and Arabic short vowels", () => {
    expect(normalizeText("  Hélène ÉLÈVE ")).toBe("helene eleve");
    expect(normalizeText("مُحَمَّد")).toBe("محمد");
    expect(normalizeText("أمين")).toBe(normalizeText("امين"));
  });

  it("finds a member by any word of their name, e-mail, skills, units or roles", () => {
    expect(memberMatches(helene, "helene", TODAY)).toBe(true);
    expect(memberMatches(helene, "demo HEL", TODAY)).toBe(true);
    expect(memberMatches(helene, "ansys", TODAY)).toBe(true);
    expect(memberMatches(helene, "journalist", TODAY)).toBe(true);
    expect(memberMatches(helene, "example.invalid", TODAY)).toBe(true);
    expect(memberMatches(helene, "helene powertrain", TODAY)).toBe(false);
    expect(memberMatches(karim, "", TODAY)).toBe(true);
  });

  it("does not find a member through a unit they have left", () => {
    expect(memberMatches(karim, "media", TODAY)).toBe(false);
  });

  it("filters by current unit and by status", () => {
    const everyone = [helene, karim];
    const ids = (filters: Parameters<typeof filterMembers>[1]) =>
      filterMembers(everyone, filters, TODAY).map((found) => found.id);
    expect(ids({ query: "", unitId: null, status: "all" })).toEqual([1, 2]);
    expect(ids({ query: "", unitId: null, status: "active" })).toEqual([1]);
    expect(ids({ query: "", unitId: null, status: "alumni" })).toEqual([2]);
    expect(ids({ query: "", unitId: media.id, status: "all" })).toEqual([1]);
    expect(ids({ query: "karim", unitId: powertrain.id, status: "all" })).toEqual([2]);
  });
});
