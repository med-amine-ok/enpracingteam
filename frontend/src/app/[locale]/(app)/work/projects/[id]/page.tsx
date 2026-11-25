import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ProjectPage } from "@/features/workflow/hub/project-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workflow");
  return { title: t("entity.project") };
}

export default function Page() {
  return (
    <Suspense>
      <ProjectPage />
    </Suspense>
  );
}
