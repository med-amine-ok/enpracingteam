"use client";

import { HandHeart, Trophy, UsersRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageTabs } from "@/components/ui/page-tabs";
import { SelectField } from "@/components/ui/select-field";
import { Link } from "@/i18n/navigation";
import { CLUB_TIME_ZONE } from "@/lib/dates";
import { PARTS, type Criterion, type RankingCategory, type Score } from "./api";
import { useRankingRights } from "./queries";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

const CATEGORY_TONES: Record<RankingCategory, BadgeTone> = {
  A: "success",
  B: "info",
  C: "neutral",
  D: "warning",
  E: "danger",
};

export function CategoryBadge({ category }: { category: RankingCategory | "" }) {
  const t = useTranslations("Ranking");
  if (!category) {
    return null;
  }
  return <Badge tone={CATEGORY_TONES[category]}>{t(`categoryName.${category}`)}</Badge>;
}

/** "86,5" or "—": a score out of 100 in the reader's language. */
export function useScore() {
  const format = useFormatter();
  return (value: number | null | undefined) =>
    value == null ? "—" : format.number(value, { maximumFractionDigits: 1, numberingSystem: "latn" });
}

/** "octobre 2026" from "2026-10". */
export function useMonthName() {
  const format = useFormatter();
  return (key: string) =>
    format.dateTime(new Date(`${key}-15T12:00:00Z`), {
      month: "long",
      year: "numeric",
      timeZone: CLUB_TIME_ZONE,
      numberingSystem: "latn",
    });
}

/** "2026-10": the month of a date, in Algiers. */
export function monthKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit" }).format(date);
}

/** The month before "2026-10": "2026-09". */
export function previousMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** The current month and the eleven before it. */
export function lastMonths(current: string, count = 12) {
  const months = [current];
  while (months.length < count) {
    months.push(previousMonth(months[months.length - 1]));
  }
  return months;
}

export function MonthSelect({
  value,
  months,
  onChange,
}: {
  value: string;
  months: string[];
  onChange: (month: string) => void;
}) {
  const t = useTranslations("Ranking");
  const monthName = useMonthName();
  return (
    <SelectField label={t("monthLabel")} value={value} onChange={(event) => onChange(event.target.value)}>
      {months.map((month) => (
        <option key={month} value={month}>
          {monthName(month)}
        </option>
      ))}
    </SelectField>
  );
}

/** My score | Team (leaders, the Team Manager, the bureau) | Contributions. */
export function RankingTabs({ current }: { current: "mine" | "team" | "contributions" }) {
  const t = useTranslations("Ranking");
  const rights = useRankingRights();
  const tabs = [
    { key: "mine", href: "/ranking", icon: Trophy, label: t("mineTab") },
    ...(rights.data?.team ? [{ key: "team", href: "/ranking/team", icon: UsersRound, label: t("teamTab") }] : []),
    { key: "contributions", href: "/ranking/contributions", icon: HandHeart, label: t("contributionsTab") },
  ];
  return <PageTabs label={t("tabsNav")} tabs={tabs} current={current} />;
}

/** The month's score: the final one, the ranking score and category, then each part and how it was made. */
export function ScoreBreakdown({ score }: { score: Score }) {
  const t = useTranslations("Ranking");
  const formatScore = useScore();
  const { details } = score;
  const criterion = (label: string, value: Criterion) =>
    value.mark != null
      ? t("criterionMark", { label, mark: String(value.mark) })
      : value.na
        ? t("criterionNa", { label, reason: value.na })
        : t("criterionMissing", { label });
  const lines: Record<(typeof PARTS)[number]["key"], string[]> = {
    delivery: [
      ...(score.performance != null ? [t("performance", { value: formatScore(score.performance) })] : []),
      ...(score.load != null
        ? [t("load", { value: formatScore(score.load), reference: formatScore(details.reference_load) })]
        : []),
    ],
    presence: [],
    reliability: [
      details.weeks_in_progress
        ? t("updates", { updated: String(details.weeks_updated), weeks: String(details.weeks_in_progress) })
        : t("noWeeks"),
      details.communication_mark != null
        ? t("communication", { mark: String(details.communication_mark) }) +
          (details.communication_cap < 5
            ? ` (${t("communicationCap", { cap: String(details.communication_cap), count: details.late_blockers })})`
            : "")
        : t("noCommunication"),
    ],
    team: [
      t("contributionPoints", { count: String(details.contribution_points) }),
      criterion(t("workshop"), details.workshop),
      criterion(t("events"), details.events),
      ...(details.logistics_mark != null
        ? [t("criterionMark", { label: t("logistics"), mark: String(details.logistics_mark) })]
        : []),
      ...(details.effort_mark != null
        ? [t("criterionMark", { label: t("effort"), mark: String(details.effort_mark) })]
        : []),
    ],
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-sm text-muted">{t("final")}</p>
          <p className="text-3xl font-semibold text-ink">
            {score.final == null ? t("notCalculable") : t("outOf100", { score: formatScore(score.final) })}
          </p>
        </div>
        {score.ranking_score != null ? (
          <div>
            <p className="text-sm text-muted" title={t("rankingScoreHint")}>
              {t("rankingScore")}
            </p>
            <p className="text-xl font-semibold text-ink">{formatScore(score.ranking_score)}</p>
          </div>
        ) : null}
        {score.rank != null ? (
          <div>
            <p className="text-sm text-muted">{t("rank")}</p>
            <p className="text-xl font-semibold text-ink">{score.rank}</p>
          </div>
        ) : null}
        <span className="flex flex-wrap items-center gap-1.5">
          <CategoryBadge category={score.category} />
          {score.provisional ? <Badge tone="warning">{t("provisional")}</Badge> : null}
        </span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {PARTS.map(({ key, weight }) => (
          <li key={key} className="space-y-1.5 rounded-lg border border-line p-3">
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink">
                {t(`part.${key}`)}{" "}
                <span className="text-xs text-muted">({t("weight", { weight: String(weight) })})</span>
              </span>
              <span className="text-lg font-semibold text-ink">{formatScore(score[key])}</span>
            </p>
            {lines[key].map((line) => (
              <p key={line} className="text-xs text-muted">
                {line}
              </p>
            ))}
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t("tasksTitle")}</h3>
        {details.tasks.length === 0 ? (
          <p className="text-sm text-muted">{t("noTasks")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {details.tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <Link href={`/tasks/${task.id}`} className="min-w-0 font-medium text-navy hover:underline">
                  <bdi>{task.title}</bdi>
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {task.not_delivered ? <Badge tone="danger">{t("notDelivered")}</Badge> : null}
                  {t("taskLine", {
                    points: String(task.points),
                    quality: String(task.quality),
                    timing: String(task.timing),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
