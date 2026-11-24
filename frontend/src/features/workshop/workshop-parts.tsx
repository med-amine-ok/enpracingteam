"use client";

import { CalendarDays, ClipboardList, Hammer, UserRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageTabs } from "@/components/ui/page-tabs";
import type { EquipmentStatus, LoanStatus } from "./api";
import { useLoans, useWorkshopRights } from "./queries";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

const STATUS_TONES: Record<EquipmentStatus, BadgeTone> = {
  available: "success",
  borrowed: "info",
  maintenance: "warning",
  out_of_service: "danger",
};

const LOAN_TONES: Record<LoanStatus, BadgeTone> = {
  requested: "warning",
  refused: "danger",
  cancelled: "neutral",
  out: "info",
  returned: "success",
};

export function EquipmentStatusBadge({ status }: { status: EquipmentStatus }) {
  const t = useTranslations("Workshop");
  return <Badge tone={STATUS_TONES[status]}>{t(`status.${status}`)}</Badge>;
}

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  const t = useTranslations("Workshop");
  return <Badge tone={LOAN_TONES[status]}>{t(`loanStatus.${status}`)}</Badge>;
}

/** "22 oct. 2026, 14:00 – 16:00": a slot in the reader's language. */
export function useSlot() {
  const format = useFormatter();
  return (from: string, to: string) =>
    format.dateTimeRange(new Date(from), new Date(to), {
      dateStyle: "medium",
      timeStyle: "short",
      numberingSystem: "latn",
    });
}

/** "22 oct. 2026": a date of the API ("YYYY-MM-DD") or a moment. */
export function useDay() {
  const format = useFormatter();
  return (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });
}

export function personName(person: { first_name: string; last_name: string }) {
  return `${person.first_name} ${person.last_name}`;
}

/** Equipment | My bookings and loans | Loans to handle (the managers, with how many await them). */
export function WorkshopTabs({ current }: { current: "equipment" | "calendar" | "mine" | "loans" }) {
  const t = useTranslations("Workshop");
  const rights = useWorkshopRights();
  const manage = rights.data?.manage ?? false;
  const requested = useLoans({ status: "requested" }, manage);
  const pending = requested.data?.length ?? 0;
  const tabs = [
    { key: "equipment", href: "/workshop", icon: Hammer, label: t("equipmentTab") },
    { key: "calendar", href: "/workshop/calendar", icon: CalendarDays, label: t("calendarTab") },
    { key: "mine", href: "/workshop/mine", icon: UserRound, label: t("mineTab") },
    ...(manage
      ? [
          {
            key: "loans",
            href: "/workshop/loans",
            icon: ClipboardList,
            label: pending > 0 ? t("loansTabCount", { count: String(pending) }) : t("loansTab"),
          },
        ]
      : []),
  ];
  return <PageTabs label={t("tabsNav")} tabs={tabs} current={current} />;
}
