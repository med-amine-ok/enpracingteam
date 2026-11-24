"use client";

import { useUnitLivery } from "@/features/members/use-members";
import { Download, Printer, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import type { Task, TaskHealth, TaskStatus } from "@/features/work/api";
import { HealthBadge, PriorityBadge, TaskStatusBadge } from "@/features/work/badges";
import { ProgressBar } from "@/features/work/lifecycle-steps";
import { Link } from "@/i18n/navigation";
import { downloadFile, toCsv } from "@/lib/csv";
import { clubToday } from "@/lib/dates";

type Unit = Task["unit"];
type Person = Task["assignees"][number]["member"];

const HEALTHS: TaskHealth[] = ["overdue", "at_risk", "due_soon", "on_track", "done_on_time", "done_late"];
const STATUSES: TaskStatus[] = ["planned", "in_progress", "needs_revision", "submitted", "validated"];
const ACTIVE: TaskStatus[] = ["in_progress", "needs_revision", "submitted"];

/** The main person of a task: its first assignee (the API lists the main one first). */
export function responsibleOf(task: Task): Person | null {
  return task.assignees[0]?.member ?? null;
}

function average(tasks: Task[]) {
  return tasks.length ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length) : 0;
}

function figures(tasks: Task[]) {
  return {
    total: tasks.length,
    active: tasks.filter((task) => ACTIVE.includes(task.status)).length,
    overdue: tasks.filter((task) => task.health === "overdue").length,
    done: tasks.filter((task) => task.status === "validated").length,
    progress: average(tasks),
  };
}

/** The tasks of each team (its unit), largest team first. */
export function byUnit(tasks: Task[]) {
  const groups = new Map<number, { unit: Unit; tasks: Task[] }>();
  for (const task of tasks) {
    const group = groups.get(task.unit.id) ?? { unit: task.unit, tasks: [] };
    group.tasks.push(task);
    groups.set(task.unit.id, group);
  }
  return [...groups.values()].sort((a, b) => b.tasks.length - a.tasks.length);
}

/** The tasks of each person assigned to some, most loaded first. */
export function byPerson(tasks: Task[]) {
  const groups = new Map<number, { person: Person; tasks: Task[] }>();
  for (const task of tasks) {
    for (const { member } of task.assignees) {
      const group = groups.get(member.id) ?? { person: member, tasks: [] };
      group.tasks.push(task);
      groups.set(member.id, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.tasks.length - a.tasks.length);
}

/** The Figma's work orders table: reference and title, team, responsible, state, progress, due date, health. */
export function TaskTable({ tasks }: { tasks: Task[] }) {
  const t = useTranslations("Tasks");
  const format = useFormatter();
  const day = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });
  const columns = ["colTask", "colTeam", "colResponsible", "colStatus", "colProgress", "colDue", "colHealth"] as const;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card print:overflow-visible print:shadow-none">
      <table className="w-full min-w-[880px] text-start text-sm print:min-w-0">
        <thead>
          <tr className="border-b border-line bg-canvas">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-4 py-3 text-start text-2xs font-semibold tracking-widest whitespace-nowrap text-muted uppercase"
              >
                {t(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const person = responsibleOf(task);
            return (
              <tr key={task.id} className="border-b border-line last:border-0 hover:bg-canvas">
                <td className="max-w-72 px-4 py-3">
                  <p className="font-display text-xs font-bold tracking-wider text-racing" dir="ltr">
                    {task.reference}
                  </p>
                  <Link
                    href={`/tasks/${task.id}`}
                    dir="auto"
                    className="block truncate font-semibold text-navy hover:underline"
                  >
                    {task.title}
                  </Link>
                  {task.current_phase ? (
                    <p dir="auto" className="truncate text-2xs text-muted">
                      {task.current_phase}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  <bdi>{task.unit.name}</bdi>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {person ? `${person.first_name} ${person.last_name}` : t("nobodyAssigned")}
                </td>
                <td className="px-4 py-3">
                  <TaskStatusBadge status={task.status} />
                </td>
                <td className="min-w-32 px-4 py-3">
                  <span className="font-display text-sm font-bold text-navy tabular-nums">{task.progress} %</span>
                  <ProgressBar done={task.progress} total={100} label={t("progressOfTask", { title: task.title })} />
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-muted">
                  {task.due_date ? day(task.due_date) : "—"}
                </td>
                <td className="px-4 py-3">
                  <HealthBadge health={task.health} />
                  <span className="ms-1.5">
                    <PriorityBadge priority={task.priority} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One card per team: its tasks, those under way and late, its average progress (the Figma's "Teams"). */
export function TeamsView({ tasks, onOpen }: { tasks: Task[]; onOpen: (unit: Unit) => void }) {
  const unitLivery = useUnitLivery();
  const t = useTranslations("Tasks");
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {byUnit(tasks).map(({ unit, tasks: own }) => {
        const colours = unitLivery(unit.code);
        const numbers = figures(own);
        return (
          <li
            key={unit.id}
            className="space-y-4 rounded-lg border border-t-4 border-line bg-surface p-5 shadow-card"
            style={{ borderTopColor: colours.color }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-display text-lg font-bold text-navy uppercase">
                  <bdi>{unit.name}</bdi>
                </h3>
                <p className="text-xs text-muted">{colours.team}</p>
              </div>
              <span className="font-display text-3xl leading-none font-bold text-navy tabular-nums">
                {numbers.progress} %
              </span>
            </div>
            <ProgressBar done={numbers.progress} total={100} label={t("progressOfTeam", { team: unit.name })} />
            <Figures numbers={numbers} />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onOpen(unit)}
              aria-label={t("openTeam", { team: unit.name })}
            >
              {t("seeTasks")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** One card per person assigned: their tasks, under way, late and validated (the Figma's "People"). */
export function PeopleView({ tasks, onOpen }: { tasks: Task[]; onOpen: (person: Person) => void }) {
  const t = useTranslations("Tasks");
  const people = byPerson(tasks);
  if (people.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
        {t("nobodyOnTasks")}
      </p>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {people.map(({ person, tasks: own }) => {
        const name = `${person.first_name} ${person.last_name}`;
        const numbers = figures(own);
        return (
          <li key={person.id} className="space-y-4 rounded-lg border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center gap-3">
              <Avatar firstName={person.first_name} lastName={person.last_name} seed={person.id} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold text-navy">{name}</h3>
                <p className="text-xs text-muted">{t("averageProgress", { progress: String(numbers.progress) })}</p>
              </div>
            </div>
            <Figures numbers={numbers} />
            <Button size="sm" variant="secondary" onClick={() => onOpen(person)} aria-label={t("openPerson", { name })}>
              {t("seeTasks")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Figures({ numbers }: { numbers: ReturnType<typeof figures> }) {
  const t = useTranslations("Tasks");
  const items = [
    ["figureTotal", numbers.total],
    ["figureActive", numbers.active],
    ["figureOverdue", numbers.overdue],
    ["figureDone", numbers.done],
  ] as const;
  return (
    <dl className="grid grid-cols-4 gap-2 border-y border-line py-3 text-center">
      {items.map(([key, value]) => (
        <div key={key}>
          <dd
            className={
              key === "figureOverdue" && value > 0
                ? "font-display text-xl font-bold text-racing"
                : "font-display text-xl font-bold text-navy"
            }
          >
            {value}
          </dd>
          <dt className="text-2xs tracking-wider text-muted uppercase">{t(key)}</dt>
        </div>
      ))}
    </dl>
  );
}

/** The Figma's report: the tasks filtered by team, state and health, to print or to export for a spreadsheet. */
export function ReportView({ tasks }: { tasks: Task[] }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const format = useFormatter();
  const [unit, setUnit] = useState("");
  const [status, setStatus] = useState("");
  const [health, setHealth] = useState("");
  const shown = tasks.filter(
    (task) =>
      (!unit || String(task.unit.id) === unit) &&
      (!status || task.status === status) &&
      (!health || task.health === health),
  );
  const numbers = figures(shown);

  function exportCsv() {
    const header = [
      "colReference",
      "colTitle",
      "colTeam",
      "colResponsible",
      "colStatus",
      "colProgress",
      "colDue",
      "colHealth",
      "colPriority",
    ] as const;
    const rows = shown.map((task) => {
      const person = responsibleOf(task);
      return [
        task.reference,
        task.title,
        task.unit.name,
        person ? `${person.first_name} ${person.last_name}` : "",
        tWork(`taskStatus.${task.status}`),
        `${task.progress} %`,
        task.due_date ?? "",
        tWork(`health.${task.health}`),
        task.priority ? tWork(`priority.${task.priority}`) : "",
      ];
    });
    const today = clubToday(new Date());
    downloadFile(`${t("csvName")}-${today}.csv`, toCsv([header.map((key) => t(key)), ...rows]));
  }

  return (
    <div className="space-y-4">
      <div className="print-hidden grid gap-3 sm:grid-cols-3">
        <SelectField label={t("colTeam")} value={unit} onChange={(event) => setUnit(event.target.value)}>
          <option value="">{t("allTeams")}</option>
          {byUnit(tasks).map(({ unit: option }) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("colStatus")} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {tWork(`taskStatus.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("colHealth")} value={health} onChange={(event) => setHealth(event.target.value)}>
          <option value="">{t("allHealths")}</option>
          {HEALTHS.map((value) => (
            <option key={value} value={value}>
              {tWork(`health.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {t("reportSummary", {
            count: numbers.total,
            shown: String(numbers.total),
            overdue: String(numbers.overdue),
            progress: String(numbers.progress),
          })}
          <span className="hidden print:inline">
            {" · "}
            {format.dateTime(new Date(), { dateStyle: "long", numberingSystem: "latn" })}
          </span>
        </p>
        <div className="print-hidden flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            {t("print")}
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={shown.length === 0}>
            <Download className="size-4" aria-hidden="true" />
            {t("exportCsv")}
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
          <Users className="mx-auto mb-2 size-5" aria-hidden="true" />
          {t("reportEmpty")}
        </p>
      ) : (
        <TaskTable tasks={shown} />
      )}
    </div>
  );
}
