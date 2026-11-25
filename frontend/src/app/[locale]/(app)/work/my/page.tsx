import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MyWork } from "@/features/workflow/deliverables/my-work";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workflow");
  return { title: t("tabs.myWork") };
}

export default function Page() {
  return <MyWork />;
}
