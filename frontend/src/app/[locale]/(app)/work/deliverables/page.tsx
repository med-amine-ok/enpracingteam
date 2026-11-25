import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DeliverablesList } from "@/features/workflow/deliverables/deliverables-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workflow");
  return { title: t("tabs.deliverables") };
}

// The filters may come in the address (?status=submitted): they are read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <DeliverablesList />
    </Suspense>
  );
}
