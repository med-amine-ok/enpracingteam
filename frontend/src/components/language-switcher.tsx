"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { updateLanguage, type Language, type Me } from "@/features/auth/api";
import { meQueryKey } from "@/features/auth/use-me";
import { useRouter } from "@/i18n/navigation";
import { pageWithoutLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const LANGUAGES: { code: Language; short: string; name: string }[] = [
  { code: "fr", short: "FR", name: "Français" },
  { code: "en", short: "EN", name: "English" },
  { code: "ar", short: "ع", name: "العربية" },
];

type LanguageSwitcherProps = {
  /** "dark" on a dark background. */
  tone?: "light" | "dark";
  className?: string;
};

/**
 * Changes the language of the pages. For a logged-in member, the choice is also saved in their
 * profile: the API (messages, e-mails) and their other devices then use it too.
 */
export function LanguageSwitcher({ tone = "light", className }: LanguageSwitcherProps) {
  const t = useTranslations("Language");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();

  async function choose(language: Language) {
    if (language === locale) {
      return;
    }
    if (queryClient.getQueryData<Me | null>(meQueryKey)) {
      try {
        await updateLanguage(language);
        queryClient.setQueryData<Me | null>(meQueryKey, (me) => (me ? { ...me, language } : me));
      } catch {
        // The pages still change language; the profile keeps the previous choice.
      }
    }
    // The same page with its parameters (?project=…), read on click: reading the address while
    // drawing would keep Next.js from prerendering pages such as /projects/12.
    startTransition(() => router.replace(pageWithoutLocale(window.location), { locale: language }));
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex rounded-lg p-0.5 text-xs font-semibold",
        tone === "dark" ? "bg-white/10" : "border border-line bg-surface shadow-xs",
        className,
      )}
    >
      {LANGUAGES.map(({ code, short, name }) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-label={name}
            aria-pressed={active}
            title={name}
            disabled={pending}
            onClick={() => choose(code)}
            className={cn(
              "min-w-9 rounded-md px-2.5 py-1.5 transition-colors",
              active
                ? tone === "dark"
                  ? "bg-white text-navy"
                  : "bg-navy text-white"
                : tone === "dark"
                  ? "text-white/70 hover:text-white"
                  : "text-muted hover:text-ink",
            )}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}
