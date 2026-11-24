import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ProjectView } from "@/features/projects/project-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shell");
  return { title: t("projects") };
}

// The project id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <ProjectView />
    </Suspense>
  );
}
