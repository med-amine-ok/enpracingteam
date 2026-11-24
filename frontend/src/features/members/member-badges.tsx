"use client";

import { useTranslations } from "next-intl";
import type { Membership, MemberStatus } from "./api";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: MemberStatus | undefined }) {
  const t = useTranslations("Member");
  const value = status ?? "active";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
        value === "active" ? "bg-success-soft text-success" : "bg-canvas text-muted",
      )}
    >
      {t(`statuses.${value}`)}
    </span>
  );
}

/** "Primary membership" and "Level: Main / Junior", when they apply. */
export function MembershipBadges({ membership }: { membership: Membership }) {
  const t = useTranslations("Member");
  const level =
    membership.member_level === "main" || membership.member_level === "junior" ? membership.member_level : null;
  return (
    <>
      {membership.is_primary ? (
        <span className="rounded-full bg-racing-soft px-2.5 py-0.5 text-xs font-medium text-racing-strong">
          {t("primary")}
        </span>
      ) : null}
      {level ? (
        <span className="rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-medium text-navy">
          {t("level", { level: t(`levels.${level}`) })}
        </span>
      ) : null}
    </>
  );
}
