import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { getDirection, routing } from "./routing";

type Tree = { [key: string]: string | Tree };

/** "Login.title" → text, for every message of a file. */
function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      entries.set(path, value);
    } else {
      flatten(value, path).forEach((text, nested) => entries.set(nested, text));
    }
  }
  return entries;
}

/** Names of the values a message needs ({email}, {count, plural…}) and its tags (<address>). */
function placeholders(message: string) {
  // "{email}" or "{count, plural, …}"; not the text of a plural form ("one {Renvoyer…}", "=0 {Comments}"),
  // whose brace follows its selector.
  const names = [...message.matchAll(/(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{\s*(\w+)\s*[,}]/g)].map(
    (match) => match[1],
  );
  const tags = [...message.matchAll(/<(\w+)>/g)].map((match) => `<${match[1]}>`);
  return [...new Set([...names, ...tags])].sort();
}

const catalogs = { fr, en, ar } as Record<string, Tree>;
const french = flatten(fr);

describe("translations", () => {
  it("exist for every language of the app", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...routing.locales].sort());
  });

  it.each(["en", "ar"])("%s has exactly the French keys", (locale) => {
    expect([...flatten(catalogs[locale]).keys()].sort()).toEqual([...french.keys()].sort());
  });

  it.each(["fr", "en", "ar"])("%s has no empty message", (locale) => {
    const empty = [...flatten(catalogs[locale])].filter(([, text]) => !text.trim()).map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it.each(["en", "ar"])("%s uses the same values and tags as French", (locale) => {
    const other = flatten(catalogs[locale]);
    for (const [key, text] of french) {
      expect(placeholders(other.get(key) ?? ""), key).toEqual(placeholders(text));
    }
  });

  it("gives Arabic plurals their Arabic forms (one, two, few, many)", () => {
    const resend = flatten(ar).get("Login.resendIn") ?? "";
    for (const form of ["one", "two", "few", "many", "other"]) {
      expect(resend).toMatch(new RegExp(`\\b${form} \\{`));
    }
  });
});

describe("writing direction", () => {
  it("is right to left for Arabic only", () => {
    expect(getDirection("ar")).toBe("rtl");
    expect(getDirection("fr")).toBe("ltr");
    expect(getDirection("en")).toBe("ltr");
  });
});
