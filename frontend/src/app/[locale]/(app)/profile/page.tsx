import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProfileView } from "@/features/profile/profile-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shell");
  return { title: t("profile") };
}

export default function Page() {
  return <ProfileView />;
}
