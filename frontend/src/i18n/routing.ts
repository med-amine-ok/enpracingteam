import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // Same languages as the API (LANGUAGES in backend/config/settings.py). Every page lives under
  // its language: /fr/login, /en/login, /ar/login. A visitor without one is sent to the language
  // of their browser, else French.
  locales: ["fr", "en", "ar"],
  defaultLocale: "fr",
});

export type AppLocale = (typeof routing.locales)[number];

/** Arabic is written right to left. */
export function getDirection(locale: string): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * A page's address without its language, as the navigation of ./navigation.ts expects it:
 * "/fr/projects/12" with "?tab=team" → "/projects/12?tab=team".
 */
export function pageWithoutLocale({ pathname, search }: { pathname: string; search: string }) {
  const [, first, ...rest] = pathname.split("/");
  const page = (routing.locales as readonly string[]).includes(first) ? `/${rest.join("/")}` : pathname;
  return `${page}${search}`;
}
