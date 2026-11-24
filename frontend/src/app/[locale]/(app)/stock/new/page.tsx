import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewStockLine } from "@/features/stock/new-stock-line";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Stock");
  return { title: t("form.title") };
}

export default function Page() {
  return <NewStockLine />;
}
