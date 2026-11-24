/**
 * An API call that failed. `message` is the API's own message, already in the member's language
 * (empty when there is none); `status` is 0 when the API could not be reached at all.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The API's message: {"detail": "…"}, or the first one of an invalid field ({"email": ["…"]}),
 * also inside a nested object or list ({"new_part": {"name": ["…"]}}, {"lines": [{}, {"qty": ["…"]}]}).
 */
export function apiErrorMessage(body: unknown) {
  if (!body || typeof body !== "object") {
    return "";
  }
  if ("detail" in body && typeof body.detail === "string") {
    return body.detail;
  }
  // At the top, only the fields' lists and objects: a bare string there is a code, not a message.
  return firstMessage(Object.values(body).filter((value) => typeof value === "object"));
}

function firstMessage(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value) {
      return value;
    }
    if (value && typeof value === "object") {
      const message = firstMessage(Object.values(value));
      if (message) {
        return message;
      }
    }
  }
  return "";
}

/** Runs an API call; a network failure (API stopped, no connection) becomes ApiError(0). */
export async function send<T extends { response: Response; error?: unknown }>(call: () => Promise<T>) {
  let result: T;
  try {
    result = await call();
  } catch (error) {
    // An ApiError already says what failed (the session could not be renewed: API restarting…).
    throw error instanceof ApiError ? error : new ApiError(0, "");
  }
  return result;
}

/** Throws the API's error unless the answer is 2xx. */
export function ensureOk<T extends { response: Response; error?: unknown }>(result: T) {
  if (!result.response.ok) {
    throw new ApiError(result.response.status, apiErrorMessage(result.error));
  }
  return result;
}

/** The body of a 2xx answer, or the API's error. */
export function dataOf<T extends { response: Response; data?: unknown; error?: unknown }>(result: T) {
  ensureOk(result);
  if (result.data === undefined) {
    throw new ApiError(result.response.status, "");
  }
  return result.data as NonNullable<T["data"]>;
}
