import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DocumentView } from "@/features/documents/document-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Documents");
  return { title: t("title") };
}

// The id is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <DocumentView />
    </Suspense>
  );
}
