import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MyTasks } from "@/features/tasks/my-tasks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shell");
  return { title: t("tasks") };
}

export default function Page() {
  return <MyTasks />;
}
