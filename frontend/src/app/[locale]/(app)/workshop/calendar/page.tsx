import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { WeekCalendar } from "@/features/workshop/week-calendar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Workshop");
  return { title: t("calendarTab") };
}

// The week shown depends on the address (?week=, ?equipment=): it is read inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <WeekCalendar />
    </Suspense>
  );
}
