import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LessonsPage } from "@/features/documents/lessons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Documents");
  return { title: t("lessonsTab") };
}

export default function Page() {
  return <LessonsPage />;
}
