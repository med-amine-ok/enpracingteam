import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DocumentsPage } from "@/features/documents/documents-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Documents");
  return { title: t("title") };
}

export default function Page() {
  return <DocumentsPage />;
}
