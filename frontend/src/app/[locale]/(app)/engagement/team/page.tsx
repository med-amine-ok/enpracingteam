import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EngagementTeamPage } from "@/features/engagement/team-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Engagement");
  return { title: t("tabs.team") };
}

export default function Page() {
  return <EngagementTeamPage />;
}
