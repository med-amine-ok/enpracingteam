import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TaskView } from "@/features/tasks/task-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shell");
  return { title: t("tasks") };
}

// The task id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <TaskView />
    </Suspense>
  );
}
