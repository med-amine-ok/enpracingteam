import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TrainingsPage } from "@/features/engagement/trainings-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Engagement");
  return { title: t("tabs.trainings") };
}

export default function Page() {
  return <TrainingsPage />;
}
