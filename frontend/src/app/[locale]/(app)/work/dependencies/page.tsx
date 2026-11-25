import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DependenciesPage } from "@/features/workflow/hub/dependencies-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workflow");
  return { title: t("tabs.dependencies") };
}

export default function Page() {
  return <DependenciesPage />;
}
