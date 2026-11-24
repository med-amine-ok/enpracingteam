import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AssistantSourcesPage } from "@/features/assistant/sources-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Assistant");
  return { title: t("sourcesTab") };
}

export default function Page() {
  return <AssistantSourcesPage />;
}
