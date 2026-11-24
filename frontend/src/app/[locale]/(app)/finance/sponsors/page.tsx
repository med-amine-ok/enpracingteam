import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SponsorsPage } from "@/features/finance/sponsors-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Finance");
  return { title: t("sponsorsTitle") };
}

export default function Page() {
  return <SponsorsPage />;
}
