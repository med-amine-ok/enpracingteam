import createClient, { type Middleware } from "openapi-fetch";
import { CSRF_COOKIE, readCookie } from "./cookies";
import type { paths } from "./schema";

/**
 * Address of the Django API (.env.example). Open the frontend with the same host name as the API
 * (localhost, not 127.0.0.1): the browser then shares the API's cookies with the pages.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** What the API expects on every call made from the browser. */
export const apiHeaders: Middleware = {
  onRequest({ request }) {
    // API messages (errors, the e-mail with the code) in the language shown on screen.
    const language = typeof document === "undefined" ? "" : document.documentElement.lang;
    if (language) {
      request.headers.set("Accept-Language", language);
    }
    // Double-submit CSRF protection, see backend/apps/members/authentication.py.
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf && UNSAFE_METHODS.has(request.method)) {
      request.headers.set("X-CSRF-Token", csrf);
    }
    return request;
  },
};

/** Typed client of the whole API: paths, request bodies and answers come from schema.d.ts. */
export const api = createClient<paths>({ baseUrl: API_URL, credentials: "include" });
api.use(apiHeaders);
