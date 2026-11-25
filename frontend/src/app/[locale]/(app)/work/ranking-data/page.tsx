import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RankingDataPage } from "@/features/workflow/hub/ranking-data-page";

// A neutral title: the page answers "not found" to whoever is not a Head (front guide §2.1).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workflow");
  return { title: t("title") };
}

export default function Page() {
  return <RankingDataPage />;
}
