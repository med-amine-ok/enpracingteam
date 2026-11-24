import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewLesson } from "@/features/documents/lessons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Documents");
  return { title: t("newLessonTitle") };
}

export default function Page() {
  return <NewLesson />;
}
