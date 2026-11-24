import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MeetingsPage } from "@/features/meetings/meetings-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meetings");
  return { title: t("title") };
}

export default function Page() {
  return <MeetingsPage />;
}
