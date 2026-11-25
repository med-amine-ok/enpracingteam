"use client";

import {
  Building2,
  Calculator,
  CircleAlert,
  ClipboardCheck,
  FlaskConical,
  Megaphone,
  PackageCheck,
  UsersRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { Link } from "@/i18n/navigation";
import { AuditTimeline } from "./audit-timeline";
import { useScoringDashboard } from "./queries";
import {
  PanelPlaceholder,
  QueryFailure,
  RunStatusBadge,
  ScoringGate,
  ScoringHeader,
  SeasonSelect,
  useWhen,
} from "./scoring-parts";
import { ValidationIssueList } from "./validation-issues";

/** The Ranking Admin Dashboard (guide §5.3): completeness, the latest run, publication, issues, recent activity. */
export function ScoringDashboardPage() {
  return (
    <ScoringGate>
      <Dashboard />
    </ScoringGate>
  );
}

function Dashboard() {
  const t = useTranslations("Scoring");
  const when = useWhen();
  const [season, setSeason] = useState<number | null>(null);
  const dashboard = useScoringDashboard(season);
  const data = dashboard.data;

  if (dashboard.isError) {
    return <QueryFailure error={dashboard.error} />;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ScoringHeader current="dashboard" title={t("dashboard.title")} description={t("dashboard.intro")} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-64">
          <SeasonSelect value={season} onChange={setSeason} />
        </div>
        {data ? (
          <p className="text-sm text-muted">
            <bdi>{data.season.label}</bdi> ·{" "}
            {data.season.scoring_cutoff_at
              ? t("dashboard.cutoff", { date: when.dateTime(data.season.scoring_cutoff_at) })
              : t("dashboard.noCutoff")}
          </p>
        ) : null}
      </div>
      {!data ? (
        <PanelPlaceholder lines={6} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t("dashboard.deliverables")} value={data.deliverables} icon={<PackageCheck />} />
            <KpiCard label={t("dashboard.validated")} value={data.validated} icon={<ClipboardCheck />} />
            <KpiCard
              label={t("dashboard.qualityComplete")}
              value={data.quality_complete}
              hint={t("dashboard.ofValidated", { count: data.validated })}
              icon={<ClipboardCheck />}
              href="/scoring/data"
            />
            <KpiCard label={t("dashboard.departments")} value={data.departments} icon={<Building2 />} />
            <KpiCard
              label={t("dashboard.members")}
              value={data.members}
              hint={t("dashboard.membersHint")}
              icon={<UsersRound />}
            />
            <KpiCard
              label={t("dashboard.latestRun")}
              value={data.latest_run ? `#${data.latest_run.id}` : "—"}
              hint={
                data.latest_run ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {when.dateTime(data.latest_run.completed_at ?? data.latest_run.triggered_at)} ·{" "}
                    <bdi>{data.latest_run.formula_version}</bdi>
                    <RunStatusBadge status={data.latest_run.status} />
                  </span>
                ) : (
                  t("dashboard.noRun")
                )
              }
              icon={<Calculator />}
              href={data.latest_run ? `/scoring/runs/${data.latest_run.id}` : "/scoring/runs"}
            />
            <KpiCard
              label={t("dashboard.publication")}
              value={data.published_run ? t("published") : t("notPublished")}
              hint={
                data.published_run
                  ? t("dashboard.publishedRun", {
                      id: data.published_run.id,
                      date: when.dateTime(data.published_run.published_at),
                    })
                  : undefined
              }
              icon={<Megaphone />}
              href={data.published_run ? `/scoring/runs/${data.published_run.id}` : undefined}
            />
            <KpiCard
              label={t("dashboard.issues")}
              value={data.issues.length}
              icon={<CircleAlert />}
              accent={data.issues.length ? undefined : "var(--color-success)"}
              href="/scoring/data"
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="space-y-6 lg:col-span-3">
              <Card
                title={t("dashboard.issuesTitle")}
                description={t("dashboard.issuesIntro")}
                action={
                  <Link href="/scoring/data" className="text-sm text-navy hover:underline">
                    {t("dashboard.openData")}
                  </Link>
                }
              >
                <ValidationIssueList issues={data.issues} />
              </Card>
            </div>
            <div className="space-y-6 lg:col-span-2">
              <Card title={t("dashboard.formulaTitle")}>
                <p className="flex items-center gap-2 text-sm">
                  <FlaskConical className="size-4 text-muted" aria-hidden="true" />
                  {data.current_formula ? (
                    <bdi className="font-semibold text-ink">{data.current_formula}</bdi>
                  ) : (
                    <span className="text-muted">{t("dashboard.noFormula")}</span>
                  )}
                </p>
                <Link href="/scoring/formulas" className="mt-2 inline-block text-sm text-navy hover:underline">
                  {t("dashboard.openFormulas")}
                </Link>
              </Card>
              <Card
                title={t("dashboard.recentTitle")}
                action={
                  <Link href="/scoring/audit" className="text-sm text-navy hover:underline">
                    {t("dashboard.openAudit")}
                  </Link>
                }
              >
                <AuditTimeline entries={data.recent} compact />
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
