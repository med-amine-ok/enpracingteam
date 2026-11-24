import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Directory } from "@/features/directory/directory";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shell");
  return { title: t("directory") };
}

export default function Page() {
  return <Directory />;
}
