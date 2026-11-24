import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { UnitPage } from "@/features/org-chart/unit-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("OrgChart");
  return { title: t("title") };
}

// What the page shows is only known when it is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <UnitPage />
    </Suspense>
  );
}
