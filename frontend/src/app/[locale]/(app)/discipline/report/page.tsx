import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReportForm } from "@/features/discipline/discipline-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discipline");
  return { title: t("reportTitle") };
}

export default function Page() {
  return <ReportForm />;
}
