import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkshopPage } from "@/features/workshop/workshop-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workshop");
  return { title: t("title") };
}

export default function Page() {
  return <WorkshopPage />;
}
