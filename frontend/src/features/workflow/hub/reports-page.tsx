"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { LoadError } from "@/components/ui/load-error";
import { SelectField } from "@/components/ui/select-field";
import { Link } from "@/i18n/navigation";
import {
  DELIVERABLE_STATUSES,
  WORK_ORDER_STATUSES,
  type DepartmentProgress,
  type OperationalReport,
  type SeasonOverview,
} from "../api";
import { DeliverableStatusBadge, ProgressMeter, WorkOrderStatusBadge } from "../badges";
import { useOperationalReport, useSeasonOverview, useSeasons, useWorkMe } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { WorkloadList } from "./work-dashboard";
import { Empty, useDates } from "./parts";

/**
 * Operational progress (front guide §12.1): Season → Project → Department → Work Order, as the backend aggregates
 * them. Nothing is recomputed here, and nothing of the scoring is shown.
 */
export function ReportsPage() {
  const t = useTranslations("WorkHub");
  const seasons = useSeasons();
  const workMe = useWorkMe();
  const [chosen, setChosen] = useState<number | null>(null);
  const season = chosen ?? workMe.data?.current_season?.id ?? seasons.data?.[0]?.id ?? null;
  const overview = useSeasonOverview(season);
  const report = useOperationalReport(season ? { season } : {});

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <WorkflowHeader current="reports" description={t("reports.intro")}>
        <div className="w-60">
          <SelectField
            label={t("reports.season")}
            value={season ?? ""}
            onChange={(event) => setChosen(Number(event.target.value) || null)}
          >
            {(seasons.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
        </div>
      </WorkflowHeader>
      <Rules />
      {seasons.isError ? <LoadError error={seasons.error} /> : null}
      {season ? (
        overview.isError ? (
          <LoadError error={overview.error} />
        ) : !overview.data ? (
          <LinesPlaceholder lines={4} />
        ) : (
          <SeasonPart overview={overview.data} />
        )
      ) : seasons.data ? (
        <Empty>{t("reports.noSeason")}</Empty>
      ) : null}
      {report.isError ? (
        <LoadError error={report.error} />
      ) : !report.data ? (
        <LinesPlaceholder lines={6} />
      ) : (
        <ReportPart report={report.data} />
      )}
    </div>
  );
}

/** How the backend aggregates progress (spec §6). */
function Rules() {
  const t = useTranslations("WorkHub");
  return (
    <Card title={t("reports.rulesTitle")} description={t("reports.rulesIntro")}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {(["workOrder", "department", "project", "season"] as const).map((level) => (
          <div key={level} className="space-y-0.5">
            <dt className="font-semibold text-navy">{t(`reports.rules.${level}.title`)}</dt>
            <dd className="text-muted">{t(`reports.rules.${level}.text`)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function SeasonPart({ overview }: { overview: SeasonOverview }) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  return (
    <Card
      title={t("reports.seasonProgress", { season: overview.season.label })}
      action={<ProgressMeter value={overview.progress} label={tWorkflow("progress")} className="w-48" />}
    >
      {overview.projects.length === 0 ? (
        <Empty>{t("reports.noProjects")}</Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {overview.projects.map((project) => (
            <li key={project.id} className="space-y-3 rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/work/projects/${project.id}`}
                  dir="auto"
                  className="font-semibold text-ink hover:text-racing"
                >
                  {project.name}
                </Link>
                <ProgressMeter value={project.progress} label={tWorkflow("progress")} className="w-40" />
              </div>
              <DepartmentRows rows={project.departments} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DepartmentRows<T extends DepartmentProgress>({
  rows,
  extra,
}: {
  rows: T[];
  extra?: (row: T) => ReactNode;
}) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  if (rows.length === 0) {
    return <Empty>{t("reports.noDepartments")}</Empty>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span dir="auto" className="text-ink">
            {row.name}
            {extra ? <span className="ms-2 text-xs text-muted">{extra(row)}</span> : null}
          </span>
          <ProgressMeter value={row.progress} label={`${tWorkflow("progress")} · ${row.name}`} className="w-40" />
        </li>
      ))}
    </ul>
  );
}

function ReportPart({ report }: { report: OperationalReport }) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const { day } = useDates();
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label={t("reports.workOrders")}
          value={Object.values(report.work_orders_by_status).reduce((sum, value) => sum + (value ?? 0), 0)}
        />
        <KpiCard label={t("reports.overdue")} value={report.overdue.length} />
        <KpiCard label={t("reports.waiting")} value={report.waiting} hint={t("reports.waitingHint")} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("reports.byStatus")}>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="eyebrow">{tWorkflow("tabs.workOrders")}</p>
              <ul className="flex flex-wrap gap-2">
                {WORK_ORDER_STATUSES.filter((status) => report.work_orders_by_status[status]).map((status) => (
                  <li key={status} className="inline-flex items-center gap-1.5">
                    <WorkOrderStatusBadge status={status} />
                    <span className="text-sm font-semibold text-ink tabular-nums">
                      {report.work_orders_by_status[status]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <p className="eyebrow">{tWorkflow("tabs.deliverables")}</p>
              <ul className="flex flex-wrap gap-2">
                {DELIVERABLE_STATUSES.filter((status) => report.deliverables_by_status[status]).map((status) => (
                  <li key={status} className="inline-flex items-center gap-1.5">
                    <DeliverableStatusBadge status={status} />
                    <span className="text-sm font-semibold text-ink tabular-nums">
                      {report.deliverables_by_status[status]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
        <Card title={t("reports.departments")}>
          <DepartmentRows
            rows={report.departments}
            extra={(row) => t("reports.workOrderCount", { count: row.work_orders })}
          />
        </Card>
      </div>
      <Card title={t("reports.workOrderProgress")}>
        {report.work_orders.length === 0 ? (
          <Empty>{t("reports.noWorkOrders")}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {report.work_orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <Link href={`/work/orders/${order.id}`} dir="auto" className="font-medium text-ink hover:text-racing">
                    {[order.code, order.title].filter(Boolean).join(" · ")}
                  </Link>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span dir="auto">{order.department}</span>
                    <WorkOrderStatusBadge status={order.status} />
                    {"budget_tier" in order && order.budget_tier != null ? (
                      <Badge tone="neutral">{t("reports.budget", { tier: order.budget_tier })}</Badge>
                    ) : null}
                  </p>
                </div>
                <ProgressMeter value={order.progress} label={tWorkflow("progress")} className="w-44" />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("reports.overdueList")}>
          {report.overdue.length === 0 ? (
            <Empty>{t("reports.noOverdue")}</Empty>
          ) : (
            <ul className="space-y-2">
              {report.overdue.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Link href={`/work/deliverables/${item.id}`} dir="auto" className="text-ink hover:text-racing">
                    {[item.code, item.title].filter(Boolean).join(" · ")}
                  </Link>
                  <span className="text-xs text-racing">{day(item.effective_deadline ?? item.original_deadline)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("reports.workload")}>
          <WorkloadList rows={report.workload} />
        </Card>
      </div>
    </div>
  );
}
