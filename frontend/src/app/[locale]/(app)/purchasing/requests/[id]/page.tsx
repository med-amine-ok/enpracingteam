import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PurchaseView } from "@/features/purchasing/purchase-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Purchasing");
  return { title: t("title") };
}

// The request id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <PurchaseView />
    </Suspense>
  );
}
