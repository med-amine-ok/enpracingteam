import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProposalsInbox } from "@/features/workflow/orders/proposals-inbox";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("WorkOrders");
  return { title: t("inboxTitle") };
}

export default function Page() {
  return <ProposalsInbox />;
}
