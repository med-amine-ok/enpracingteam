"use client";

import { FileBarChart, TriangleAlert } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { INDICATORS, type Dashboard, type IndicatorKey, type MemberHealth } from "./api";
import { useDashboard, useReportingRights } from "./queries";
import { ColourBadge, ColourDot, MemberHealthBadge, useWarningText } from "./team-parts";

const BORDERS = {
  green: "border-s-success",
  orange: "border-s-warning",
  red: "border-s-racing",
  neutral: "border-s-line",
} as const;

/**
 * The Team Manager's dashboard (Team Manager – ERP Requirements §1, §5, §7): the indicators in green,
 * orange or red, the early warnings, the departments and the members. A leader sees their departments.
 */
export function TeamDashboard() {
  const t = useTranslations("Team");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const rights = useReportingRights();
  const dashboard = useDashboard(!!rights.data?.dashboard);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.team")} title={t("title")} description={t("intro")}>
        {rights.data?.reports ? (
          <Link href="/team/reports" className={buttonClassName("secondary", "sm")}>
            <FileBarChart className="size-4" aria-hidden="true" />
            {t("reportsLink")}
          </Link>
        ) : null}
      </PageHeader>
      {rights.data && !rights.data.dashboard ? (
        <Alert tone="info">{t("forbidden")}</Alert>
      ) : dashboard.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(dashboard.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => dashboard.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !dashboard.data ? (
        <LinesPlaceholder lines={6} />
      ) : (
        <DashboardContent data={dashboard.data} />
      )}
    </div>
  );
}

function DashboardContent({ data }: { data: Dashboard }) {
  const t = useTranslations("Team");
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-ink">{t("overall")}</span>
        <ColourBadge colour={data.overall} />
        {data.scope === "department" ? <span className="text-sm text-muted">{t("departmentScope")}</span> : null}
      </div>
      <section aria-label={t("indicatorsTitle")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INDICATORS.map((key) => (
          <IndicatorTile key={key} name={key} data={data} />
        ))}
      </section>
      <Warnings data={data} />
      <Departments data={data} />
      <Members data={data} />
    </>
  );
}

function IndicatorTile({ name, data }: { name: IndicatorKey; data: Dashboard }) {
  const t = useTranslations("Team");
  const format = useFormatter();
  const indicator = data.indicators[name];
  const value =
    indicator.value === null
      ? "—"
      : name.endsWith("_rate")
        ? `${format.number(indicator.value, { maximumFractionDigits: 1, numberingSystem: "latn" })} %`
        : indicator.total !== null
          ? `${indicator.value} / ${indicator.total}`
          : String(indicator.value);
  return (
    <div
      role="group"
      aria-label={t(`indicator.${name}`)}
      className={cn(
        "space-y-1 rounded-xl border border-s-4 border-line bg-surface p-4 shadow-xs",
        BORDERS[indicator.status],
      )}
    >
      <p className="text-xs text-muted">{t(`indicator.${name}`)}</p>
      <p className="flex items-center gap-2 text-2xl font-semibold text-ink tabular-nums">
        {value}
        {indicator.status !== "neutral" ? <ColourDot colour={indicator.status} /> : null}
      </p>
      {indicator.status !== "neutral" ? <p className="text-xs text-muted">{t(`colour.${indicator.status}`)}</p> : null}
    </div>
  );
}

function Warnings({ data }: { data: Dashboard }) {
  const t = useTranslations("Team");
  const text = useWarningText();
  return (
    <Card title={t("warningsTitle", { count: data.warnings.length, shown: String(data.warnings.length) })}>
      {data.warnings.length === 0 ? (
        <p className="text-sm text-muted">{t("noWarnings")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.warnings.map((row, index) => (
            <li key={`${row.kind}-${index}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <TriangleAlert
                className={cn("mt-0.5 size-4 shrink-0", row.severity === "red" ? "text-racing" : "text-warning")}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-sm text-ink">
                {row.task ? (
                  <Link href={`/tasks/${row.task.id}`} className="hover:underline">
                    {text(row)}
                  </Link>
                ) : (
                  text(row)
                )}
              </span>
              <ColourBadge colour={row.severity} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Departments({ data }: { data: Dashboard }) {
  const t = useTranslations("Team");
  const format = useFormatter();
  if (data.departments.length === 0) {
    return null;
  }
  const columns = ["members", "validated", "in_progress", "overdue", "critical", "blockers"] as const;
  return (
    <Card title={t("departmentsTitle")}>
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-start text-xs text-muted">
              <th className="px-2 py-2 text-start font-medium">{t("department")}</th>
              {columns.map((column) => (
                <th key={column} className="px-2 py-2 text-end font-medium">
                  {t(`column.${column}`)}
                </th>
              ))}
              <th className="px-2 py-2 text-end font-medium">{t("column.attendance")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("column.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.departments.map((row) => (
              <tr key={row.unit.id}>
                <th scope="row" className="px-2 py-2 text-start font-medium text-ink">
                  <bdi>{row.unit.name}</bdi>
                </th>
                {columns.map((column) => (
                  <td key={column} className="px-2 py-2 text-end text-ink tabular-nums">
                    {row[column]}
                  </td>
                ))}
                <td className="px-2 py-2 text-end text-ink tabular-nums">
                  {row.attendance_rate === null
                    ? "—"
                    : `${format.number(row.attendance_rate, { maximumFractionDigits: 1, numberingSystem: "latn" })} %`}
                </td>
                <td className="px-2 py-2">
                  <ColourBadge colour={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Members({ data }: { data: Dashboard }) {
  const t = useTranslations("Team");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [filter, setFilter] = useState<"all" | "attention">("attention");
  const rows = data.members.filter((row) => filter === "all" || row.status !== "active" || row.overdue > 0);
  const order: Record<MemberHealth, number> = { inactive: 0, at_risk: 1, active: 2 };
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <Card
      title={t("membersTitle", { count: data.members.length, shown: String(data.members.length) })}
      action={
        <Segmented
          label={t("membersShown")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "attention", label: t("toFollow") },
            { value: "all", label: t("everyone") },
          ]}
        />
      }
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-muted">{t("nobodyToFollow")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map((row) => (
            <li key={row.member.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1">
                <Link href={`/members/${row.member.id}`} className="block text-sm font-medium text-ink hover:underline">
                  {row.member.first_name} {row.member.last_name}
                </Link>
                <span className="block text-xs text-muted">
                  <bdi>{row.units.join(", ")}</bdi>
                  {" · "}
                  {row.last_activity
                    ? t("lastActivity", { when: format.relativeTime(new Date(row.last_activity), now) })
                    : t("noActivity")}
                </span>
              </span>
              <span className="text-xs text-muted">
                {t("openWork", {
                  tasks: String(row.open_tasks),
                  points: String(row.open_points),
                  overdue: String(row.overdue),
                })}
              </span>
              <MemberHealthBadge status={row.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
