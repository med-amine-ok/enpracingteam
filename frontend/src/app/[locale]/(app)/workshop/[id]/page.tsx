import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EquipmentView } from "@/features/workshop/equipment-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workshop");
  return { title: t("title") };
}

// The id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <EquipmentView />
    </Suspense>
  );
}
