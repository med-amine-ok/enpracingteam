import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ExpensesPage } from "@/features/finance/expenses-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Finance");
  return { title: t("expensesPageTitle") };
}

// What depends on the address (its id, its parameters) is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <ExpensesPage />
    </Suspense>
  );
}
