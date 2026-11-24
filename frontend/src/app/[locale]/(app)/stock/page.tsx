import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StockPage } from "@/features/stock/stock-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Stock");
  return { title: t("title") };
}

export default function Page() {
  return <StockPage />;
}
