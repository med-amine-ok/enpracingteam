import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DeliverableView } from "@/features/workflow/deliverables/deliverable-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Deliverables");
  return { title: t("detailTitle") };
}

// The Deliverable's id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <DeliverableView />
    </Suspense>
  );
}
