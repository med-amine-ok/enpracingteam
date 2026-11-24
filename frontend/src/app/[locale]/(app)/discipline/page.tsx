import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DisciplinePage } from "@/features/discipline/discipline-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discipline");
  return { title: t("title") };
}

export default function Page() {
  return <DisciplinePage />;
}
