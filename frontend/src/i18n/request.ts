import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import { routing } from "./routing";

export default getRequestConfig(async ({ locale: explicitLocale }) => {
  const locale = explicitLocale ?? (await rootParams.locale());
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Dates are shown at the club's time, like the API (TIME_ZONE in backend/config/settings.py).
    timeZone: "Africa/Algiers",
  };
});
