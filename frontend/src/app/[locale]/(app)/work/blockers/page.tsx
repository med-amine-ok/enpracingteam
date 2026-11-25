import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BlockersPage } from "@/features/workflow/hub/blockers-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workflow");
  return { title: t("tabs.blockers") };
}

export default function Page() {
  return (
    <Suspense>
      <BlockersPage />
    </Suspense>
  );
}
