"use client";

import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { downloadFile, toCsv } from "@/lib/csv";
import type { MemberRankingRow, Run } from "./api";
import { useRunRankings } from "./queries";
import { PublishControl } from "./runs";
import {
  LevelBadge,
  PanelPlaceholder,
  PublishedBadge,
  QueryFailure,
  RunStatusBadge,
  ScoringGate,
  ScoringHeader,
  ScoringNotFound,
  TableFrame,
  memberName,
  td,
  tdEnd,
  th,
  thEnd,
  useDecimal,
  useScoringRights,
  useWhen,
} from "./scoring-parts";

type SortKey = "rank" | "total";

/** A calculation run: its issues, the members' and departments' rankings, a CSV export (guide §14.3–14.4). */
export function RunDetailPage() {
  return (
    <ScoringGate>
      <RunDetail />
    </ScoringGate>
  );
}

/** The members in the order asked: by the backend's rank, or by the backend's total. Nothing is recomputed. */
export function sortRankings(rows: MemberRankingRow[], key: SortKey, ascending: boolean) {
  const sorted = [...rows].sort((a, b) =>
    key === "rank" ? a.rank - b.rank || a.name.localeCompare(b.name) : Number(a.total) - Number(b.total),
  );
  return ascending ? sorted : sorted.reverse();
}

function RunDetail() {
  const t = useTranslations("Scoring");
  const { id } = useParams<{ id: string }>();
  const runId = Number(id);
  const [department, setDepartment] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "rank", ascending: true });
  const all = useRunRankings(runId);
  const filtered = useRunRankings(runId, department);
  const decimal = useDecimal();

  const members = useMemo(() => {
    const words = search.trim().toLocaleLowerCase();
    const rows = (filtered.data?.members ?? []).filter((row) => !words || row.name.toLocaleLowerCase().includes(words));
    return sortRankings(rows, sort.key, sort.ascending);
  }, [filtered.data, search, sort]);

  if (!Number.isInteger(runId) || runId <= 0) {
    return <ScoringNotFound />;
  }
  if (all.isError) {
    return <QueryFailure error={all.error} />;
  }
  if (!all.data) {
    return <PanelPlaceholder lines={6} />;
  }
  const run = all.data.run;
  const departmentName = all.data.departments.find((item) => item.department_id === department)?.name;

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, ascending: !current.ascending } : { key, ascending: key === "rank" },
    );
  const exportCsv = () => {
    const rows = [
      [t("rankings.rank"), t("rankings.member"), t("rankings.total"), t("rankings.deliverables")],
      ...members.map((row) => [row.rank, row.name, row.total, row.deliverables]),
    ];
    const suffix = department ? `-dept-${department}` : "";
    downloadFile(`scoring-run-${run.id}${suffix}.csv`, toCsv(rows));
  };
  const sortHeader = (key: SortKey, label: string, end = false) => (
    <th
      className={end ? thEnd : th}
      aria-sort={sort.key === key ? (sort.ascending ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => toggle(key)} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        {sort.key === key ? (
          sort.ascending ? (
            <ArrowUp className="size-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3" aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <BackLink href="/scoring/runs">{t("runs.title")}</BackLink>
      <ScoringHeader current="runs" title={t("run.title", { id: run.id })}>
        <PublishArea run={run} />
      </ScoringHeader>
      <RunSummary run={run} />
      <Card title={t("run.issuesTitle")}>
        {run.issues?.length ? (
          <TableFrame minWidth="36rem">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t("run.level")}</th>
                <th className={th}>{t("run.deliverable")}</th>
                <th className={th}>{t("run.message")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {run.issues.map((issue, index) => (
                <tr key={`${issue.deliverable ?? "run"}-${index}`}>
                  <td className={td}>
                    <LevelBadge level={issue.level} />
                  </td>
                  <td className={td}>
                    <bdi>{issue.code || issue.title ? [issue.code, issue.title].filter(Boolean).join(" — ") : "—"}</bdi>
                  </td>
                  <td className={td} dir="auto">
                    {issue.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        ) : (
          <p className="text-sm text-muted">{t("run.noIssues")}</p>
        )}
      </Card>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <SelectField
            label={t("department")}
            value={department ?? ""}
            onChange={(event) => setDepartment(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">{t("allDepartments")}</option>
            {all.data.departments
              .filter((item) => item.department_id != null)
              .map((item) => (
                <option key={item.department_id} value={item.department_id ?? ""}>
                  {item.name}
                </option>
              ))}
          </SelectField>
        </div>
        <div className="w-64">
          <TextField
            label={t("rankings.search")}
            type="search"
            icon={<Search />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!members.length}>
          <Download className="size-4" aria-hidden="true" />
          {t("rankings.export")}
        </Button>
      </div>
      <Card
        title={t("rankings.membersTitle")}
        description={departmentName ? t("rankings.inDepartment", { name: departmentName }) : undefined}
      >
        {filtered.isError ? (
          <QueryFailure error={filtered.error} />
        ) : !filtered.data ? (
          <p className="text-sm text-muted">{t("loading")}</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted">{t("rankings.empty")}</p>
        ) : (
          <TableFrame minWidth="32rem">
            <thead>
              <tr className="border-b border-line">
                {sortHeader("rank", t("rankings.rank"))}
                <th className={th}>{t("rankings.member")}</th>
                {sortHeader("total", t("rankings.total"), true)}
                <th className={thEnd}>{t("rankings.deliverables")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((row) => (
                <tr key={row.member_id} data-testid="ranking-row">
                  <td className={td}>{row.rank}</td>
                  <td className={td}>
                    <Link
                      href={`/scoring/members/${row.member_id}?run=${run.id}`}
                      className="font-medium text-navy hover:underline"
                    >
                      <bdi>{row.name}</bdi>
                    </Link>
                  </td>
                  <td className={`${tdEnd} font-semibold`}>{decimal(row.total)}</td>
                  <td className={tdEnd}>{row.deliverables}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Card>
      <Card title={t("rankings.departmentsTitle")}>
        {!filtered.data || filtered.data.departments.length === 0 ? (
          <p className="text-sm text-muted">{t("rankings.empty")}</p>
        ) : (
          <TableFrame minWidth="28rem">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t("rankings.rank")}</th>
                <th className={th}>{t("department")}</th>
                <th className={thEnd}>{t("rankings.total")}</th>
                <th className={thEnd}>{t("rankings.memberCount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.data.departments.map((row) => (
                <tr key={row.department_id ?? "none"}>
                  <td className={td}>{row.rank}</td>
                  <td className={td}>
                    <bdi>{row.name || "—"}</bdi>
                  </td>
                  <td className={`${tdEnd} font-semibold`}>{decimal(row.total)}</td>
                  <td className={tdEnd}>{row.member_count}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Card>
    </div>
  );
}

function PublishArea({ run }: { run: Run }) {
  const rights = useScoringRights();
  return rights.publish ? <PublishControl run={run} /> : null;
}

function RunSummary({ run }: { run: Run }) {
  const t = useTranslations("Scoring");
  const when = useWhen();
  const items: [string, ReactNode][] = [
    [t("season"), <bdi key="season">{run.season_label}</bdi>],
    [t("formula"), <bdi key="formula">{run.formula_version}</bdi>],
    [t("runs.time"), when.dateTime(run.triggered_at)],
    [t("run.completedAt"), when.dateTime(run.completed_at)],
    [t("run.triggeredBy"), <bdi key="by">{memberName(run.triggered_by)}</bdi>],
    [t("runs.records"), run.records_processed ?? 0],
    [t("runs.warnings"), run.warnings_count ?? 0],
    [t("runs.errors"), run.errors_count ?? 0],
    [t("runs.status"), <RunStatusBadge key="status" status={run.status} />],
    [
      t("runs.publication"),
      <span key="pub" className="inline-flex flex-wrap items-center gap-1.5">
        <PublishedBadge published={run.is_published} />
        {run.is_published ? `${when.dateTime(run.published_at)} · ${memberName(run.published_by)}` : null}
      </span>,
    ],
  ];
  return (
    <Card>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {run.notes ? <p className="mt-4 text-sm text-muted">{t("run.notesLine", { notes: run.notes })}</p> : null}
    </Card>
  );
}
