import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MyWorkshop } from "@/features/workshop/my-workshop";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workshop");
  return { title: t("mineTitle") };
}

export default function Page() {
  return <MyWorkshop />;
}
