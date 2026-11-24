"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { PARTS, publishMonth } from "./api";
import { rankingKeys, refreshRanking, useMonthTable, useRankingRights } from "./queries";
import {
  CategoryBadge,
  MonthSelect,
  RankingTabs,
  lastMonths,
  monthKey,
  previousMonth,
  useMonthName,
  useScore,
} from "./ranking-parts";

/** A month's table for the department heads (their departments), the Team Manager and the bureau (everyone). */
export function TeamRanking() {
  const t = useTranslations("Ranking");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const now = useNow();
  const current = monthKey(now);
  const [month, setMonth] = useState(previousMonth(current));
  const rights = useRankingRights();
  const table = useMonthTable(month, rights.data?.team ?? false);
  const monthName = useMonthName();
  const formatScore = useScore();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const publish = useMutation({
    mutationFn: () => publishMonth(month),
    onSuccess: async (saved) => {
      queryClient.setQueryData(rankingKeys.month(month), saved);
      setConfirming(false);
      await refreshRanking(queryClient);
    },
  });
  const data = table.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.team")} title={t("teamTitle")} description={t("teamIntro")} />
      <RankingTabs current="team" />
      <Alert tone="info">{t("neverSanction")}</Alert>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <MonthSelect value={month} months={lastMonths(current)} onChange={setMonth} />
        </div>
        {data?.permissions.publish && !confirming ? (
          <Button onClick={() => setConfirming(true)}>
            <Megaphone className="size-4" aria-hidden="true" />
            {data.published_at ? t("republish") : t("publish")}
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-canvas p-3">
          <p className="text-sm text-ink">{t("publishConfirm", { month: monthName(month) })}</p>
          <Button size="sm" onClick={() => publish.mutate()} loading={publish.isPending} autoFocus>
            {t("confirmPublish")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}
      {publish.isError ? <Alert tone="error">{errorText(publish.error, tErrors)}</Alert> : null}
      {table.isError ? (
        <Alert tone="error">{errorText(table.error, tErrors)}</Alert>
      ) : !data ? (
        <Card>
          <LinesPlaceholder lines={6} />
        </Card>
      ) : (
        <Card
          title={monthName(data.month)}
          description={
            data.published_at
              ? t("publishedOn", {
                  date: format.dateTime(new Date(data.published_at), { dateStyle: "medium", numberingSystem: "latn" }),
                  name: data.published_by ? `${data.published_by.first_name} ${data.published_by.last_name}` : "—",
                })
              : t("notPublished")
          }
        >
          {data.rows.length === 0 ? (
            <p className="text-sm text-muted">{t("noRows")}</p>
          ) : (
            <div className="-mx-5 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-start text-xs text-muted">
                    <th className="px-3 py-2 text-start font-medium">{t("rank")}</th>
                    <th className="px-3 py-2 text-start font-medium">{t("member")}</th>
                    <th className="px-3 py-2 text-start font-medium">{t("department")}</th>
                    {PARTS.map(({ key }) => (
                      <th key={key} className="px-3 py-2 text-end font-medium">
                        {t(`part.${key}`)}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-end font-medium">{t("final")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("rankingScore")}</th>
                    <th className="px-3 py-2 text-start font-medium">{t("category")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((row) => (
                    <tr key={row.member.id}>
                      <td className="px-3 py-2 text-muted">{row.rank ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/ranking/members/${row.member.id}?month=${data.month}`}
                          className="font-medium text-navy hover:underline"
                        >
                          {row.member.first_name} {row.member.last_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        <bdi>{row.department?.name ?? "—"}</bdi>
                      </td>
                      {PARTS.map(({ key }) => (
                        <td key={key} className="px-3 py-2 text-end tabular-nums">
                          {formatScore(row[key])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-end font-semibold tabular-nums">
                        {formatScore(row.final)}
                        {row.provisional ? (
                          <Badge tone="warning" className="ms-1.5">
                            {t("provisional")}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{formatScore(row.ranking_score)}</td>
                      <td className="px-3 py-2">
                        <CategoryBadge category={row.category} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
