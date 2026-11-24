"use client";

import { AlertTriangle, Ban, CircleCheck, ListChecks, Timer, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import type { Task } from "@/features/work/api";
import { useTasks, workKeys } from "@/features/work/queries";
import { TaskBoard, useStartTask } from "@/features/work/task-board";
import { errorText } from "@/lib/error-text";
import { PeopleView, ReportView, TaskTable, TeamsView } from "./task-views";

type View = "board" | "list" | "teams" | "people" | "report";
const VIEWS: View[] = ["board", "list", "teams", "people", "report"];
type Focus = { kind: "unit" | "person"; id: number; name: string } | null;

/** The tasks assigned to me (or every task of the team) as the Figma's work orders: on a kanban, in a list, by
 * team, by person, or as a report to print or export. */
export function MyTasks() {
  const t = useTranslations("Tasks");
  const tErrors = useTranslations("Errors");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [view, setView] = useState<View>("board");
  const [focus, setFocus] = useState<Focus>(null);
  const filters = scope === "mine" ? { assignee: "me" } : {};
  const tasks = useTasks(filters);
  // A team's or a person's card leads to their tasks, in the list.
  const shown =
    tasks.data?.filter((task) =>
      focus === null
        ? true
        : focus.kind === "unit"
          ? task.unit.id === focus.id
          : task.assignees.some(({ member }) => member.id === focus.id),
    ) ?? [];
  const start = useStartTask(workKeys.tasks(filters));
  const overdue = tasks.data?.filter((task) => task.is_overdue).length ?? 0;
  const blocked = tasks.data?.filter((task) => task.is_blocked).length ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("intro")} />
      {tasks.data && tasks.data.length > 0 ? (
        <div className="print-hidden">
          <TaskFigures tasks={tasks.data} />
        </div>
      ) : null}
      <div className="print-hidden flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
          <Segmented
            label={t("scopeLabel")}
            value={scope}
            onChange={(value) => {
              setScope(value);
              setFocus(null);
            }}
            options={[
              { value: "mine", label: t("mine") },
              { value: "all", label: t("all") },
            ]}
          />
          <Segmented
            label={t("viewLabel")}
            value={view}
            onChange={(value) => {
              setView(value);
              setFocus(null);
            }}
            options={VIEWS.map((value) => ({ value, label: t(`view.${value}`) }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {blocked > 0 ? (
            <Badge tone="danger">
              <Ban className="size-3.5" aria-hidden="true" />
              {t("blockedCount", { count: blocked, shown: String(blocked) })}
            </Badge>
          ) : null}
          {overdue > 0 ? (
            <Badge tone="danger">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {t("overdueCount", { count: overdue, shown: String(overdue) })}
            </Badge>
          ) : null}
        </div>
      </div>
      {start.isError ? <Alert tone="error">{errorText(start.error, tErrors)}</Alert> : null}
      {tasks.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(tasks.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => tasks.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !tasks.data ? (
        <LinesPlaceholder lines={4} />
      ) : tasks.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
          {scope === "mine" ? t("emptyMine") : t("emptyAll")}
        </p>
      ) : (
        <>
          {focus ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
              {t(focus.kind === "unit" ? "focusTeam" : "focusPerson", { name: focus.name })}
              <Button size="sm" variant="ghost" onClick={() => setFocus(null)}>
                <X className="size-4" aria-hidden="true" />
                {t("clearFocus")}
              </Button>
            </p>
          ) : null}
          {view === "board" ? (
            <TaskBoard tasks={shown} showProject onStart={(task) => start.mutate(task)} />
          ) : view === "list" ? (
            <TaskTable tasks={shown} />
          ) : view === "teams" ? (
            <TeamsView
              tasks={tasks.data}
              onOpen={(unit) => {
                setFocus({ kind: "unit", id: unit.id, name: unit.name });
                setView("list");
              }}
            />
          ) : view === "people" ? (
            <PeopleView
              tasks={tasks.data}
              onOpen={(person) => {
                setFocus({ kind: "person", id: person.id, name: `${person.first_name} ${person.last_name}` });
                setView("list");
              }}
            />
          ) : (
            <ReportView tasks={tasks.data} />
          )}
        </>
      )}
    </div>
  );
}

/** The Figma's key figures of the work orders, and how many are in each state. */
function TaskFigures({ tasks }: { tasks: Task[] }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const count = (test: (task: Task) => boolean) => tasks.filter(test).length;
  const done = count((task) => task.status === "validated");
  const bars = [
    { key: "validated", value: done, colour: "var(--color-green)" },
    {
      key: "in_progress",
      value: count((task) => ["in_progress", "submitted", "needs_revision"].includes(task.status)),
      colour: "var(--color-info)",
    },
    { key: "planned", value: count((task) => task.status === "planned"), colour: "var(--color-subtle)" },
  ] as const;
  const largest = Math.max(...bars.map(({ value }) => value), 1);
  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_340px]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label={t("kpiTotal")} value={tasks.length} icon={<ListChecks />} />
        <KpiCard
          label={t("kpiActive")}
          value={count((task) => task.status === "in_progress")}
          icon={<Timer />}
          accent="var(--color-info)"
        />
        <KpiCard
          label={t("kpiDone")}
          value={done}
          hint={t("kpiDoneHint", { rate: String(Math.round((done / tasks.length) * 100)) })}
          icon={<CircleCheck />}
          accent="var(--color-green)"
        />
        <KpiCard
          label={t("kpiOverdue")}
          value={count((task) => task.is_overdue)}
          icon={<AlertTriangle />}
          accent="var(--color-amber)"
        />
        <KpiCard label={t("kpiBlocked")} value={count((task) => task.is_blocked)} icon={<Ban />} />
      </div>
      <Card title={t("statusTitle")}>
        <dl className="space-y-3">
          {bars.map(({ key, value, colour }) => (
            <div key={key} className="grid grid-cols-[90px_1fr_28px] items-center gap-3">
              <dt className="truncate text-xs text-muted">{tWork(`taskStatus.${key}`)}</dt>
              <dd className="h-2 bg-line">
                <span className="block h-full" style={{ width: `${(value / largest) * 100}%`, background: colour }} />
              </dd>
              <dd className="font-display text-sm font-bold text-navy">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
