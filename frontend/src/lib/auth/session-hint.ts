import { CSRF_COOKIE } from "@/lib/api/cookies";

/**
 * A cookie that says a session probably exists, without proving it: the CSRF cookie, sent with page
 * requests and kept as long as the session. src/proxy.ts uses it only to send logged-out visitors
 * straight to the login page; the API checks the real session on every request.
 */
export const SESSION_HINT_COOKIE = CSRF_COOKIE;

const PUBLIC_PAGES = ["/login"];

/** Pages open without a session (path without the language prefix). */
export function isPublicPage(page: string) {
  return PUBLIC_PAGES.some((publicPage) => page === publicPage || page.startsWith(`${publicPage}/`));
}

/**
 * Where to go after login (the ?next= parameter): only a page of this site, never another site
 * ("//evil.example", "https://…"), which would let a link send members elsewhere after they log in.
 */
export function safeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return isPublicPage(value) ? "/" : value;
}
