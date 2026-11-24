/**
 * The API's CSRF cookie (AUTH_COOKIE_CSRF in backend/config/settings.py). Readable by JavaScript
 * (the other two, access_token and refresh_token, are HttpOnly) and sent back in the X-CSRF-Token
 * header. It lives as long as the session.
 */
export const CSRF_COOKIE = "csrf_token";

export function readCookie(name: string, cookies = typeof document === "undefined" ? "" : document.cookie) {
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return undefined;
}
