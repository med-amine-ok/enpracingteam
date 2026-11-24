import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BudgetView } from "@/features/finance/budget-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Finance");
  return { title: t("title") };
}

// What depends on the address (its id, its parameters) is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <BudgetView />
    </Suspense>
  );
}
