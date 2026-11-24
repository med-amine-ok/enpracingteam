import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MemberSheetView } from "@/features/engagement/member-sheet";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Engagement");
  return { title: t("sheetTitle") };
}

// What the page shows is only known when it is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <MemberSheetView />
    </Suspense>
  );
}
