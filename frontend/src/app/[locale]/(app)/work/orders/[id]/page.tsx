import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { WorkOrderView } from "@/features/workflow/orders/work-order-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("WorkOrders");
  return { title: t("detailTitle") };
}

// The Work Order's id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <WorkOrderView />
    </Suspense>
  );
}
