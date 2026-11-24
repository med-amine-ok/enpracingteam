import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProjectsList } from "@/features/projects/projects-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shell");
  return { title: t("projects") };
}

export default function Page() {
  return <ProjectsList />;
}
