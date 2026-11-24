import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { NewPurchase } from "@/features/purchasing/new-purchase";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Purchasing");
  return { title: t("form.newTitle") };
}

// ?part= is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <NewPurchase />
    </Suspense>
  );
}
