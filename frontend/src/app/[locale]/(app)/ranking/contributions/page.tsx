import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ContributionsPage } from "@/features/ranking/contributions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Ranking");
  return { title: t("contributionsTitle") };
}

// The month (today's, or the one asked) is only known in the browser: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <ContributionsPage />
    </Suspense>
  );
}
