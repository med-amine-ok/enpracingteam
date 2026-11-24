import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PurchasesPage } from "@/features/purchasing/purchases-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Purchasing");
  return { title: t("title") };
}

export default function Page() {
  return <PurchasesPage />;
}
