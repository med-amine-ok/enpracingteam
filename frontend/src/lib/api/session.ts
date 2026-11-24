import { api } from "./client";
import { ApiError } from "./errors";

// The access token lives 10 minutes, the session 14 days (SIMPLE_JWT in backend/config/settings.py):
// an expired access token is renewed with the refresh cookie, without asking the member anything.

/** The name of the browser lock that lets a single tab at a time renew the session. */
const REFRESH_LOCK = "enp-auth-refresh";

let refreshing: Promise<boolean> | null = null;

/**
 * Renews the session; calls made at the same time share a single request.
 * Answers true when renewed, false when the session has ended (the API refuses the refresh cookie:
 * 401/403), and fails with ApiError when the API could not answer (unreachable: 0, restarting: 5xx,
 * too many requests: 429): the member is then still logged in, and the call can be tried again.
 */
export function refreshSession() {
  refreshing ??= api
    .POST("/api/auth/refresh/")
    .then(
      ({ response }) => {
        if (response.ok) {
          return true;
        }
        if (response.status === 401 || response.status === 403) {
          return false;
        }
        throw new ApiError(response.status, "");
      },
      () => {
        throw new ApiError(0, "");
      },
    )
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Runs an API call; on 401 (access token expired), renews the session once and tries again.
 *
 * The API rotates the refresh token and blacklists the old one: if two tabs renewed the session at
 * the same time, the second would be refused and the member logged out. So, where the browser has
 * them, a lock shared by the tabs lets one renew at a time; the next one first tries its call again
 * (the other tab may just have renewed the session) and renews only if it is still refused.
 */
export async function withSessionRefresh<T extends { response: Response }>(
  call: () => Promise<T>,
  refresh: () => Promise<boolean> = refreshSession,
) {
  const result = await call();
  if (result.response.status !== 401) {
    return result;
  }
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    // No lock (older browsers, tests): the calls of this tab still share a single refresh.
    return (await refresh()) ? call() : result;
  }
  return locks.request(REFRESH_LOCK, async () => {
    const again = await call();
    if (again.response.status !== 401) {
      return again;
    }
    return (await refresh()) ? call() : again;
  });
}
