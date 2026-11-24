import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TeamRanking } from "@/features/ranking/team-ranking";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Ranking");
  return { title: t("teamTitle") };
}

// The month (today's, or the one asked) is only known in the browser: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <TeamRanking />
    </Suspense>
  );
}
