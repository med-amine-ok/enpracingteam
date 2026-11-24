import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewMeeting } from "@/features/meetings/new-meeting";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meetings");
  return { title: t("newTitle") };
}

export default function Page() {
  return <NewMeeting />;
}
