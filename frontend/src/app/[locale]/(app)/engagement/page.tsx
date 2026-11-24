import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VolunteeringPage } from "@/features/engagement/volunteering-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Engagement");
  return { title: t("tabs.volunteering") };
}

export default function Page() {
  return <VolunteeringPage />;
}
