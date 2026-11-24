import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { NewDocument } from "@/features/documents/new-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Documents");
  return { title: t("newTitle") };
}

// What depends on the address (the folder it was opened from) is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <NewDocument />
    </Suspense>
  );
}
