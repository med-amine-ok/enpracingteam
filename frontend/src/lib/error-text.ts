import { ApiError } from "@/lib/api/errors";

type Translate = (key: "network" | "notFound" | "unexpected") => string;

/** The message to show for a failed action: the API's own (already translated) or ours. */
export function errorText(error: unknown, t: Translate) {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return t("network");
    }
    // Django's "No Task matches the given query." names code, not what the member was looking at.
    if (error.status === 404) {
      return t("notFound");
    }
    return error.message || t("unexpected");
  }
  return t("unexpected");
}
