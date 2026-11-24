import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SuppliersPage } from "@/features/purchasing/suppliers-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Purchasing");
  return { title: t("tabs.suppliers") };
}

export default function Page() {
  return <SuppliersPage />;
}
