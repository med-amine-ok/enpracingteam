import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { NewTask } from "@/features/tasks/new-task";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Tasks");
  return { title: t("newTitle") };
}

// ?project= and ?parent= are only known when the page is visited: read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <NewTask />
    </Suspense>
  );
}
