import { Boxes, FileText, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LogoFull } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/features/auth/login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Login");
  return { title: t("title") };
}

export default function LoginPage() {
  const t = useTranslations("Login");
  return (
    <main className="grid min-h-dvh bg-canvas lg:grid-cols-2">
      <BrandPanel />
      <section className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-4 lg:justify-end">
          <LogoFull className="w-20 lg:hidden" />
          <LanguageSwitcher />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="text-center text-xs text-muted">{t("footer")}</p>
      </section>
    </main>
  );
}

/** The night-blue panel of the team's Figma (decision D-022): the logo, the motto, what the ERP gathers. */
function BrandPanel() {
  const t = useTranslations("Brand");
  const features = [
    { icon: ListChecks, text: t("featureProjects") },
    { icon: Boxes, text: t("featureStock") },
    { icon: FileText, text: t("featureDocuments") },
  ];
  return (
    <aside className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col lg:justify-between">
      {/* The Figma's red line on top and two turned squares in a corner: decoration only. */}
      <span className="absolute inset-x-0 top-0 h-0.5 bg-racing" aria-hidden="true" />
      <span
        className="absolute end-0 bottom-0 size-64 translate-x-1/2 -translate-y-1/2 rotate-45 border border-white/5 rtl:-translate-x-1/2"
        aria-hidden="true"
      />
      <span
        className="absolute end-0 bottom-0 size-40 translate-x-1/2 -translate-y-1/2 rotate-45 border border-white/5 rtl:-translate-x-1/2"
        aria-hidden="true"
      />
      <LogoFull tone="light" className="relative w-40" />
      <div className="relative max-w-md">
        <span className="mb-6 block h-0.5 w-8 bg-racing" aria-hidden="true" />
        <p className="mb-3 text-2xs font-semibold tracking-[0.18em] text-white/45 uppercase">{t("eyebrow")}</p>
        <h2 className="mb-4 font-display text-4xl leading-tight font-bold tracking-wide whitespace-pre-line uppercase">
          {t("headline")}
        </h2>
        <p className="max-w-xs text-sm leading-relaxed text-white/45">{t("tagline")}</p>
        <ul className="mt-8 space-y-3">
          {features.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-white/75">
              <span className="grid size-8 place-items-center rounded-md bg-white/10">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
      <p className="relative flex items-center gap-3">
        <span className="size-1.5 bg-racing" aria-hidden="true" />
        <span className="font-display text-xs font-bold tracking-widest text-white/40 uppercase">{t("school")}</span>
      </p>
    </aside>
  );
}
