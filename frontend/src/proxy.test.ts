// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "./proxy";

function visit(path: string, { session = false } = {}) {
  const headers = new Headers({ "accept-language": "fr" });
  if (session) {
    headers.set("cookie", "csrf_token=abc");
  }
  return proxy(new NextRequest(`http://localhost:3000${path}`, { headers }));
}

describe("proxy", () => {
  it("sends visitors without a session to the login page", () => {
    const response = visit("/fr");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/fr/login");
  });

  it("remembers the page they asked for", () => {
    const response = visit("/ar/tasks");
    expect(response.headers.get("location")).toBe("http://localhost:3000/ar/login?next=%2Ftasks");
  });

  it("keeps the parameters of that page", () => {
    const response = visit("/fr/tasks/new?project=3");
    expect(response.headers.get("location")).toBe("http://localhost:3000/fr/login?next=%2Ftasks%2Fnew%3Fproject%3D3");
  });

  it("lets everyone open the login page", () => {
    expect(visit("/fr/login").headers.get("location")).toBeNull();
  });

  it("lets members with a session in", () => {
    expect(visit("/fr", { session: true }).headers.get("location")).toBeNull();
  });

  it("adds the language to addresses without one", () => {
    expect(visit("/").headers.get("location")).toBe("http://localhost:3000/fr");
  });
});
