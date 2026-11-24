import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AddMember } from "@/features/directory/add-member";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Directory");
  return { title: t("addTitle") };
}

export default function Page() {
  return <AddMember />;
}
