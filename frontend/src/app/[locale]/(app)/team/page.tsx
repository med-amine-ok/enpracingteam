import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TeamDashboard } from "@/features/team/team-dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Team");
  return { title: t("title") };
}

export default function Page() {
  return <TeamDashboard />;
}
