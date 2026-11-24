"use client";

import { useMutation } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { downloadReport, type MonthlyReport, type ReportFile, type ReportLanguage, type WeeklyReport } from "./api";
import { useMonthlyReport, useReportingRights, useWeeklyReport } from "./queries";
import { ColourBadge, MemberHealthBadge, useWarningText } from "./team-parts";

function thisMonth() {
  return clubToday(new Date()).slice(0, 7);
}

/**
 * The weekly team report and the monthly performance report (§11): a preview, then the PDF or the
 * Excel workbook, in French or English. The weekly one also reaches the Team Manager and the bureau
 * by e-mail every Sunday.
 */
export function ReportsPage() {
  const t = useTranslations("Team");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const locale = useLocale();
  const rights = useReportingRights();
  const allowed = !!rights.data?.reports;
  const [kind, setKind] = useState<"weekly" | "monthly">("weekly");
  const [month, setMonth] = useState(thisMonth());
  const [lang, setLang] = useState<ReportLanguage>(locale === "en" ? "en" : "fr");
  const weekly = useWeeklyReport(lang, allowed && kind === "weekly");
  const monthly = useMonthlyReport(month, lang, allowed && kind === "monthly");
  const current = kind === "weekly" ? weekly : monthly;
  const download = useMutation({
    mutationFn: (file: ReportFile) => {
      const stem = kind === "weekly" ? t("fileWeekly") : t("fileMonthly");
      const suffix = kind === "weekly" ? clubToday(new Date()) : month;
      return downloadReport(kind, { lang, file, month: kind === "monthly" ? month : undefined }, `${stem}-${suffix}`);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <BackLink href="/team">{t("title")}</BackLink>
      <PageHeader eyebrow={tShell("groups.team")} title={t("reportsTitle")} description={t("reportsIntro")} />
      {rights.data && !allowed ? (
        <Alert tone="info">{t("reportsForbidden")}</Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <Segmented
              label={t("reportKind")}
              value={kind}
              onChange={setKind}
              options={[
                { value: "weekly", label: t("weekly") },
                { value: "monthly", label: t("monthly") },
              ]}
            />
            {kind === "monthly" ? (
              <div className="w-44">
                <TextField
                  label={t("month")}
                  type="month"
                  valueDir="ltr"
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                />
              </div>
            ) : null}
            <div className="w-40">
              <SelectField
                label={t("language")}
                value={lang}
                onChange={(event) => setLang(event.target.value as ReportLanguage)}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </SelectField>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => download.mutate("pdf")}
                loading={download.isPending && download.variables === "pdf"}
              >
                <FileDown className="size-4" aria-hidden="true" />
                {t("downloadPdf")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => download.mutate("xlsx")}
                loading={download.isPending && download.variables === "xlsx"}
              >
                <FileSpreadsheet className="size-4" aria-hidden="true" />
                {t("downloadXlsx")}
              </Button>
            </div>
          </div>
          {download.isError ? <Alert tone="error">{errorText(download.error, tErrors)}</Alert> : null}
          {kind === "weekly" ? <p className="text-sm text-muted">{t("weeklyByMail")}</p> : null}
          {current.isError ? (
            <Alert tone="error">{errorText(current.error, tErrors)}</Alert>
          ) : !current.data ? (
            <LinesPlaceholder lines={6} />
          ) : kind === "weekly" ? (
            <WeeklyPreview report={current.data as WeeklyReport} />
          ) : (
            <MonthlyPreview report={current.data as MonthlyReport} />
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const t = useTranslations("Team");
  return (
    <Card title={`${title} (${count})`}>
      {count === 0 ? <p className="text-sm text-muted">{t("nothing")}</p> : children}
    </Card>
  );
}

function Lines({ items }: { items: ReactNode[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item, index) => (
        <li key={index} className="py-2 text-sm text-ink first:pt-0 last:pb-0">
          {item}
        </li>
      ))}
    </ul>
  );
}

function usePeriod() {
  const format = useFormatter();
  const t = useTranslations("Team");
  return (start: string, end: string) =>
    t("period", {
      start: format.dateTime(new Date(start), { dateStyle: "medium", numberingSystem: "latn" }),
      end: format.dateTime(new Date(end), { dateStyle: "medium", numberingSystem: "latn" }),
    });
}

function WeeklyPreview({ report }: { report: WeeklyReport }) {
  const t = useTranslations("Team");
  const format = useFormatter();
  const period = usePeriod();
  const text = useWarningText();
  const day = (value: string | null | undefined) =>
    value ? format.dateTime(new Date(value), { day: "numeric", month: "short", numberingSystem: "latn" }) : "—";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-ink">{report.title}</h2>
        <ColourBadge colour={report.overall} />
        <span className="text-sm text-muted">{period(report.start, report.end)}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("section.achievements")} count={report.achievements.length}>
          <Lines items={report.achievements.map((row) => `${row.title} · ${row.project}`)} />
        </Section>
        <Section title={t("section.delayed")} count={report.delayed.length}>
          <Lines
            items={report.delayed.map((row) =>
              t("delayedLine", { title: row.title, date: day(row.due_date), days: String(row.days_late ?? 0) }),
            )}
          />
        </Section>
        <Section title={t("section.criticalBlockers")} count={report.critical_blockers.length}>
          <Lines items={report.critical_blockers.map((row) => `${row.task.title} : ${row.description}`)} />
        </Section>
        <Section title={t("section.attention")} count={report.attention.length}>
          <Lines
            items={report.attention.map((row) => (
              <span key={row.member.id} className="flex flex-wrap items-center gap-2">
                {row.member.first_name} {row.member.last_name}
                <MemberHealthBadge status={row.status} />
              </span>
            ))}
          />
        </Section>
        <Section title={t("section.priorities")} count={report.priorities.length}>
          <Lines items={report.priorities.map((row) => `${row.title} · ${day(row.due_date)}`)} />
        </Section>
        <Section title={t("section.risks")} count={report.risks.length + report.workload.length}>
          <Lines items={[...report.risks, ...report.workload].map((row) => text(row))} />
        </Section>
      </div>
    </div>
  );
}

function MonthlyPreview({ report }: { report: MonthlyReport }) {
  const t = useTranslations("Team");
  const format = useFormatter();
  const period = usePeriod();
  const number = (value: number | null) =>
    value === null ? "—" : format.number(value, { maximumFractionDigits: 1, numberingSystem: "latn" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-ink">{report.title}</h2>
        <span className="text-sm text-muted">{period(report.start, report.end)}</span>
      </div>
      <Card title={t("section.members")}>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="px-2 py-2 text-start font-medium">{t("member")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("column.validated")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("column.delivered")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("column.presence")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("column.in_progress")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("column.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.members.map((row) => (
                <tr key={row.member.id}>
                  <th scope="row" className="px-2 py-2 text-start font-medium text-ink">
                    {row.member.first_name} {row.member.last_name}
                  </th>
                  <td className="px-2 py-2 text-end tabular-nums">{row.validated}</td>
                  <td className="px-2 py-2 text-end tabular-nums">{number(row.delivered_points)}</td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {row.presence === null ? "—" : `${number(row.presence)} %`}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">{row.open_tasks}</td>
                  <td className="px-2 py-2">
                    <MemberHealthBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("section.departments")} count={report.departments.length}>
          <Lines
            items={report.departments.map((row) =>
              t("departmentLine", {
                name: row.unit.name,
                validated: String(row.validated),
                points: number(row.delivered_points),
                overdue: String(row.overdue),
              }),
            )}
          />
        </Section>
        <Section title={t("section.trends")} count={report.trends.length}>
          <Lines
            items={report.trends.map((row) =>
              t("trendLine", {
                week: format.dateTime(new Date(row.start), { day: "numeric", month: "short", numberingSystem: "latn" }),
                attendance: row.attendance_rate === null ? "—" : `${number(row.attendance_rate)} %`,
                validated: String(row.validated),
                created: String(row.created),
              }),
            )}
          />
        </Section>
        <Section title={t("section.majorBlockers")} count={report.major_blockers.length}>
          <Lines items={report.major_blockers.map((row) => `${row.task.title} : ${row.description}`)} />
        </Section>
        <Section title={t("section.projects")} count={report.projects.length}>
          <Lines
            items={report.projects.map(
              (row) => `${row.project.name} · ${row.validated}/${row.tasks} (${number(row.progress)} %)`,
            )}
          />
        </Section>
      </div>
    </div>
  );
}
