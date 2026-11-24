import { describe, expect, it } from "vitest";
import { pageWithoutLocale } from "./routing";

describe("pageWithoutLocale", () => {
  it.each<[string, string, string]>([
    ["/fr/projects/12", "", "/projects/12"],
    ["/ar/tasks/new", "?project=3&parent=7", "/tasks/new?project=3&parent=7"],
    ["/en", "", "/"],
    ["/fr/", "", "/"],
  ])("%s%s → %s", (pathname, search, page) => {
    expect(pageWithoutLocale({ pathname, search })).toBe(page);
  });

  it("only removes a language of the app", () => {
    expect(pageWithoutLocale({ pathname: "/de/projects", search: "" })).toBe("/de/projects");
  });
});
