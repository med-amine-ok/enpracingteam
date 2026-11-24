import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EditMember } from "@/features/directory/edit-member";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Directory");
  return { title: t("editPageTitle") };
}

// The member is only known when the page is visited: it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <EditMember />
    </Suspense>
  );
}
