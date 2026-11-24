import { describe, expect, it } from "vitest";
import { apiHeaders } from "./client";
import { CSRF_COOKIE, readCookie } from "./cookies";

async function headersFor(method: string) {
  const request = new Request("http://localhost:8000/api/auth/me/", { method });
  const result = await apiHeaders.onRequest!({ request } as Parameters<NonNullable<typeof apiHeaders.onRequest>>[0]);
  return (result as Request).headers;
}

describe("readCookie", () => {
  it("finds one cookie among others", () => {
    expect(readCookie("csrf_token", "NEXT_LOCALE=fr; csrf_token=abc%3D; other=1")).toBe("abc=");
    expect(readCookie("csrf_token", "NEXT_LOCALE=fr")).toBeUndefined();
  });
});

describe("API headers", () => {
  it("ask the API to answer in the language of the page", async () => {
    document.documentElement.lang = "ar";
    expect((await headersFor("GET")).get("Accept-Language")).toBe("ar");
  });

  it("send the CSRF token on changes (POST, PUT, PATCH, DELETE)", async () => {
    document.cookie = `${CSRF_COOKIE}=token-123; path=/`;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await headersFor(method)).get("X-CSRF-Token"), method).toBe("token-123");
    }
  });

  it("do not send it on reads", async () => {
    document.cookie = `${CSRF_COOKIE}=token-123; path=/`;
    expect((await headersFor("GET")).get("X-CSRF-Token")).toBeNull();
  });

  it("send nothing without a session", async () => {
    expect((await headersFor("POST")).get("X-CSRF-Token")).toBeNull();
  });
});
