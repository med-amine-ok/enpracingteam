import { describe, expect, it } from "vitest";
import { errorText } from "@/lib/error-text";
import { ApiError, apiErrorMessage, ensureOk, send } from "./errors";

const t = (key: "network" | "notFound" | "unexpected") => `[${key}]`;

describe("apiErrorMessage", () => {
  it("reads the API's message in its two shapes", () => {
    expect(apiErrorMessage({ detail: "Code invalide ou expiré." })).toBe("Code invalide ou expiré.");
    expect(apiErrorMessage({ email: ["Saisissez une adresse e-mail valide."] })).toBe(
      "Saisissez une adresse e-mail valide.",
    );
    expect(apiErrorMessage(undefined)).toBe("");
    expect(apiErrorMessage("Bad Gateway")).toBe("");
  });

  it("finds the message of a nested field", () => {
    expect(apiErrorMessage({ new_part: { name: ["Ce champ est obligatoire."] } })).toBe("Ce champ est obligatoire.");
    expect(apiErrorMessage({ lines: [{}, { quantity: ["Doit être positif."] }] })).toBe("Doit être positif.");
    expect(apiErrorMessage({ code: "token_not_valid" })).toBe("");
  });
});

describe("send and ensureOk", () => {
  it("turn a network failure into ApiError(0)", async () => {
    await expect(send(() => Promise.reject(new TypeError("Failed to fetch")))).rejects.toMatchObject({ status: 0 });
  });

  it("keep an ApiError already thrown (the session could not be renewed)", async () => {
    await expect(send(() => Promise.reject(new ApiError(503, "")))).rejects.toMatchObject({ status: 503 });
  });

  it("turn an error answer into ApiError with the API's message", () => {
    const result = { response: new Response(null, { status: 429 }), error: { detail: "Trop de demandes." } };
    expect(() => ensureOk(result)).toThrow(new ApiError(429, "Trop de demandes."));
  });

  it("let a 2xx answer through", () => {
    const result = { response: new Response(null, { status: 200 }), data: { detail: "OK" } };
    expect(ensureOk(result)).toBe(result);
  });
});

describe("errorText", () => {
  it("shows the API's message, else ours", () => {
    expect(errorText(new ApiError(400, "Code invalide ou expiré."), t)).toBe("Code invalide ou expiré.");
    expect(errorText(new ApiError(0, ""), t)).toBe("[network]");
    expect(errorText(new ApiError(500, ""), t)).toBe("[unexpected]");
    expect(errorText(new Error("bug"), t)).toBe("[unexpected]");
  });

  it("says plainly that something was not found, instead of Django's technical message", () => {
    expect(errorText(new ApiError(404, "Aucun objet Task ne correspond à cette requête."), t)).toBe("[notFound]");
  });
});
