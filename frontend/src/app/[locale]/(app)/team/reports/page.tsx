import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ReportsPage } from "@/features/team/reports-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Team");
  return { title: t("reportsTitle") };
}

// The current month (the default of the monthly report) is read on each visit, inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <ReportsPage />
    </Suspense>
  );
}
