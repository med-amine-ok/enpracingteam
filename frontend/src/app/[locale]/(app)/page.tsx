import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HomeDashboard } from "@/features/home/home-dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shell");
  return { title: t("home") };
}

export default function HomePage() {
  return <HomeDashboard />;
}
