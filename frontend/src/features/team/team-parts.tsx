"use client";

import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Colour, MemberHealth, Warning } from "./api";

export const COLOUR_TONES: Record<Colour, BadgeTone> = {
  green: "success",
  orange: "warning",
  red: "danger",
  neutral: "neutral",
};

const DOTS: Record<Colour, string> = {
  green: "bg-success",
  orange: "bg-warning",
  red: "bg-racing",
  neutral: "bg-muted",
};

const MEMBER_TONES: Record<MemberHealth, BadgeTone> = { active: "success", at_risk: "warning", inactive: "danger" };

/** Green: on track; orange: attention required; red: critical (Team Manager – ERP Requirements §1). */
export function ColourBadge({ colour }: { colour: Colour }) {
  const t = useTranslations("Team");
  return <Badge tone={COLOUR_TONES[colour]}>{t(`colour.${colour}`)}</Badge>;
}

export function ColourDot({ colour, className }: { colour: Colour; className?: string }) {
  return (
    <span className={cn("inline-block size-2.5 shrink-0 rounded-full", DOTS[colour], className)} aria-hidden="true" />
  );
}

export function MemberHealthBadge({ status }: { status: MemberHealth }) {
  const t = useTranslations("Team");
  return <Badge tone={MEMBER_TONES[status]}>{t(`memberStatus.${status}`)}</Badge>;
}

/** The sentence of an early warning, in the language of the page. */
export function useWarningText() {
  const t = useTranslations("Team");
  return (row: Warning) => {
    const values = {
      member: row.member ? `${row.member.first_name} ${row.member.last_name}` : "",
      task: row.task?.title ?? "",
      department: row.department?.name ?? "",
      count: row.count ?? 0,
      days: row.days ?? 0,
    };
    if (row.kind === "member_inactive" && row.days === null) {
      return t("warning.member_never", values);
    }
    return t(`warning.${row.kind}`, values);
  };
}
