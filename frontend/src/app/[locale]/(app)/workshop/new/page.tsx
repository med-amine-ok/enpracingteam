import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewEquipment } from "@/features/workshop/equipment-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workshop");
  return { title: t("newTitle") };
}

export default function Page() {
  return <NewEquipment />;
}
