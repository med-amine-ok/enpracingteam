import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkOrdersList } from "@/features/workflow/orders/work-orders-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("WorkOrders");
  return { title: t("listTitle") };
}

export default function Page() {
  return <WorkOrdersList />;
}
