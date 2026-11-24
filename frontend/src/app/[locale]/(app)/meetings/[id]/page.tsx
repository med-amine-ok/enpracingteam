import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MeetingView } from "@/features/meetings/meeting-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meetings");
  return { title: t("title") };
}

// The session's id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <MeetingView />
    </Suspense>
  );
}
