/**
 * A web address typed by someone (a Facebook profile…), usable in a link only if it is http(s):
 * "javascript:…" or "data:…" would run code when clicked.
 */
export function safeWebUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** "0555 12 34 56" → "tel:0555123456" (digits and a leading +), or null without digits. */
export function telHref(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return /\d/.test(digits) ? `tel:${digits}` : null;
}
