import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { FoldersPage } from "@/features/documents/folders-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Documents");
  return { title: t("foldersTab") };
}

// The folder shown depends on the address (?unit=, ?project=, ?season=): it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <FoldersPage />
    </Suspense>
  );
}
