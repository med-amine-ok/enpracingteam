import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OrgChart } from "@/features/org-chart/org-chart";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shell");
  return { title: t("orgChart") };
}

export default function Page() {
  return <OrgChart />;
}
