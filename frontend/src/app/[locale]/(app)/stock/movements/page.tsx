import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { JournalPage } from "@/features/stock/journal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Stock");
  return { title: t("tabs.journal") };
}

export default function Page() {
  return <JournalPage />;
}
