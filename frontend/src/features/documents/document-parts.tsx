"use client";

import { FileText, FolderTree, Lightbulb } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { PageTabs } from "@/components/ui/page-tabs";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

/** "2026-2027": a season, from the year it starts (September 1st). */
export function seasonName(season: number) {
  return `${season}-${season + 1}`;
}

/** The season of a day ("2026-10-22"): the year it starts, as the API counts it. */
export function seasonOf(day: string) {
  const [year, month] = day.split("-").map(Number);
  return month >= 9 ? year : year - 1;
}

/** "2,4 Mo": a file's size in the reader's language. */
export function useSize() {
  const format = useFormatter();
  return (bytes: number) => {
    const units = ["B", "kB", "MB", "GB"] as const;
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return format.number(value, {
      style: "unit",
      unit: ["byte", "kilobyte", "megabyte", "gigabyte"][unit],
      unitDisplay: "short",
      maximumFractionDigits: unit === 0 ? 0 : 1,
      numberingSystem: "latn",
    });
  };
}

/** Documents | Folders | Lessons learned: the parts of the knowledge base. */
export function KnowledgeTabs({ current }: { current: "documents" | "folders" | "lessons" }) {
  const t = useTranslations("Documents");
  const tabs = [
    { key: "documents", href: "/documents", icon: FileText, label: t("documentsTab") },
    { key: "folders", href: "/documents/folders", icon: FolderTree, label: t("foldersTab") },
    { key: "lessons", href: "/documents/lessons", icon: Lightbulb, label: t("lessonsTab") },
  ] as const;
  return <PageTabs label={t("knowledgeNav")} tabs={tabs} current={current} />;
}
