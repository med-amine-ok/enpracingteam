import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ObjectivesPage } from "@/features/engagement/objectives-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Engagement");
  return { title: t("tabs.objectives") };
}

export default function Page() {
  return <ObjectivesPage />;
}
