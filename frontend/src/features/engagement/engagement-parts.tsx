"use client";

import { GraduationCap, HandHeart, Target, Users, type LucideIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs } from "@/components/ui/page-tabs";
import type { GoalStatus, TrainingStatus, VolunteeringStatus } from "./api";
import { useLeads } from "./queries";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

export const panelClass = "space-y-3 rounded-lg border border-line bg-canvas p-3";

export function personName(person: { first_name: string; last_name: string } | null | undefined) {
  return person ? `${person.first_name} ${person.last_name}` : "—";
}

type TabKey = "volunteering" | "trainings" | "objectives" | "team";

const TABS: { key: TabKey; href: string; icon: LucideIcon; leads?: true }[] = [
  { key: "volunteering", href: "/engagement", icon: HandHeart },
  { key: "trainings", href: "/engagement/trainings", icon: GraduationCap },
  { key: "objectives", href: "/engagement/objectives", icon: Target },
  { key: "team", href: "/engagement/team", icon: Users, leads: true },
];

/** The module's title and its pages: "My team" only for who heads members, the Team Manager and the Bureau. */
export function EngagementHeader({ current, children }: { current: TabKey; children?: ReactNode }) {
  const t = useTranslations("Engagement");
  const tShell = useTranslations("Shell");
  const leads = useLeads();
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={tShell("groups.team")} title={t("title")} description={t("intro")}>
        {children}
      </PageHeader>
      <PageTabs
        label={t("sections")}
        tabs={TABS.filter((tab) => !tab.leads || leads || tab.key === current).map((tab) => ({
          ...tab,
          label: t(`tabs.${tab.key}`),
        }))}
        current={current}
      />
    </div>
  );
}

const GOAL_TONES: Record<GoalStatus, BadgeTone> = {
  in_progress: "info",
  achieved: "success",
  not_achieved: "danger",
  dropped: "neutral",
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const t = useTranslations("Engagement");
  return <Badge tone={GOAL_TONES[status]}>{t(`goalStatus.${status}`)}</Badge>;
}

const TRAINING_TONES: Record<TrainingStatus, BadgeTone> = {
  wished: "warning",
  planned: "info",
  followed: "success",
  dropped: "neutral",
};

export function TrainingStatusBadge({ status }: { status: TrainingStatus }) {
  const t = useTranslations("Engagement");
  return <Badge tone={TRAINING_TONES[status]}>{t(`trainingStatus.${status}`)}</Badge>;
}

const VOLUNTEERING_TONES: Record<VolunteeringStatus, BadgeTone> = {
  proposed: "warning",
  validated: "success",
  refused: "danger",
};

export function VolunteeringStatusBadge({ status }: { status: VolunteeringStatus }) {
  const t = useTranslations("Engagement");
  return <Badge tone={VOLUNTEERING_TONES[status]}>{t(`volunteeringStatus.${status}`)}</Badge>;
}

/** How far a goal is, as a bar with its percentage. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full rounded-full bg-navy" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-medium text-muted tabular-nums">{value} %</span>
    </div>
  );
}

/** A day ("2026-10-22") written in the page's language, with latin digits. */
export function useDay() {
  const format = useFormatter();
  return (day: string) =>
    format.dateTime(new Date(`${day}T12:00:00Z`), { dateStyle: "medium", numberingSystem: "latn" });
}

/** "2026-10" written as a month ("octobre 2026"). */
export function useMonth() {
  const format = useFormatter();
  return (month: string) =>
    format.dateTime(new Date(`${month}-15T12:00:00Z`), { month: "long", year: "numeric", numberingSystem: "latn" });
}
