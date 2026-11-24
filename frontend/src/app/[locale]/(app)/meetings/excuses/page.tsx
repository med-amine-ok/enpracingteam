import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExcusesPage } from "@/features/meetings/excuses-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meetings");
  return { title: t("excusesTitle") };
}

export default function Page() {
  return <ExcusesPage />;
}
