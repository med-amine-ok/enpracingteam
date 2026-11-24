"use client";

import { useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { errorText } from "@/lib/error-text";
import { useMyRanking } from "./queries";
import {
  CategoryBadge,
  MonthSelect,
  RankingTabs,
  ScoreBreakdown,
  lastMonths,
  monthKey,
  useMonthName,
  useScore,
} from "./ranking-parts";

/** The viewer's score: the chosen month (the current one, provisional, by default) and the published months. */
export function MyRanking() {
  const t = useTranslations("Ranking");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const now = useNow();
  const current = monthKey(now);
  const [month, setMonth] = useState(current);
  const mine = useMyRanking(month === current ? undefined : month);
  const monthName = useMonthName();
  const formatScore = useScore();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={tShell("groups.team")} title={t("title")} description={t("intro")} />
      <RankingTabs current="mine" />
      <Alert tone="info">{t("neverSanction")}</Alert>
      <div className="w-56">
        <MonthSelect value={month} months={lastMonths(current)} onChange={setMonth} />
      </div>
      {mine.isError ? (
        <Alert tone="error">{errorText(mine.error, tErrors)}</Alert>
      ) : !mine.data ? (
        <Card>
          <LinesPlaceholder lines={5} />
        </Card>
      ) : (
        <>
          <Card title={monthName(mine.data.month)}>
            <ScoreBreakdown score={mine.data.score} />
          </Card>
          <Card title={t("historyTitle")}>
            {mine.data.history.length === 0 ? (
              <p className="text-sm text-muted">{t("noHistory")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {mine.data.history.map((row) => (
                  <li key={row.month} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span className="font-medium text-ink">{monthName(row.month)}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span>{t("labelled", { label: t("final"), value: formatScore(row.final) })}</span>
                      <span>{t("labelled", { label: t("rankingScore"), value: formatScore(row.ranking_score) })}</span>
                      {row.rank != null ? (
                        <span>{t("labelled", { label: t("rank"), value: String(row.rank) })}</span>
                      ) : null}
                      <CategoryBadge category={row.category} />
                      {row.provisional ? <Badge tone="warning">{t("provisional")}</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
