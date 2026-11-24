import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotificationsPage } from "@/features/notifications/notifications-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notifications");
  return { title: t("title") };
}

export default function Page() {
  return <NotificationsPage />;
}
