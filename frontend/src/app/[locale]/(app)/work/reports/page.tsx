import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReportsPage } from "@/features/workflow/hub/reports-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workflow");
  return { title: t("tabs.reports") };
}

export default function Page() {
  return <ReportsPage />;
}
