import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { StockItemView } from "@/features/stock/stock-item-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Stock");
  return { title: t("title") };
}

// The line's id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <StockItemView />
    </Suspense>
  );
}
