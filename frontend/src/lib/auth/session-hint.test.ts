import { describe, expect, it } from "vitest";
import { isPublicPage, safeNextPath } from "./session-hint";

describe("safeNextPath", () => {
  it("keeps a page of this site", () => {
    expect(safeNextPath("/tasks")).toBe("/tasks");
    expect(safeNextPath("/projects/3?tab=parts")).toBe("/projects/3?tab=parts");
  });

  it.each<[string | null, string]>([
    ["//evil.example", "protocol-relative address of another site"],
    ["/\\evil.example", "backslash trick read as another site by browsers"],
    ["https://evil.example", "full address of another site"],
    ["javascript:alert(1)", "script"],
    ["tasks", "relative path"],
    ["", "empty"],
    [null, "missing"],
  ])("sends %s to the home page (%s)", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it("does not send back to the login page", () => {
    expect(safeNextPath("/login")).toBe("/");
  });
});

describe("isPublicPage", () => {
  it("only opens the login page without a session", () => {
    expect(isPublicPage("/login")).toBe(true);
    expect(isPublicPage("/")).toBe(false);
    expect(isPublicPage("/loginx")).toBe(false);
    expect(isPublicPage("/tasks")).toBe(false);
  });
});
