import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkDashboard } from "@/features/workflow/hub/work-dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workflow");
  return { title: t("tabs.dashboard") };
}

export default function Page() {
  return <WorkDashboard />;
}
