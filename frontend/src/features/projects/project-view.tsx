"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Layers, Plus, UserRound } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { tabBarClassName, tabClassName } from "@/components/ui/page-tabs";
import { SelectField } from "@/components/ui/select-field";
import {
  PROJECT_STATUSES,
  SUBSYSTEM_STATUSES,
  tickStep,
  updateProject,
  updateSubsystemStatus,
  type ProjectDetail,
  type ProjectStatus,
  type StepState,
  type Subsystem,
  type SubsystemStatus,
} from "@/features/work/api";
import { CategoryBadge, ProjectHealthBadge, ProjectStatusBadge, SubsystemStatusBadge } from "@/features/work/badges";
import { LifecycleSteps, ProgressBar } from "@/features/work/lifecycle-steps";
import { ProjectKey } from "./project-key";
import { refreshWork, useProject, useSubsystems, useTasks, workKeys } from "@/features/work/queries";
import { TaskBoard, useStartTask } from "@/features/work/task-board";
import { Link } from "@/i18n/navigation";
import { getDirection } from "@/i18n/routing";
import { errorText } from "@/lib/error-text";
import { buttonClassName } from "@/components/ui/button";

type Tab = "tasks" | "subsystems" | "team";
const TABS: readonly string[] = ["tasks", "subsystems", "team"];

/** A project: its details, its tasks (kanban), its subsystems with their lifecycle, its team. */
export function ProjectView() {
  const t = useTranslations("Projects");
  const tErrors = useTranslations("Errors");
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const project = useProject(Number(id));
  // ?tab=subsystems: the link of a notification about a subsystem opens its tab.
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = params.get("tab");
    return wanted && TABS.includes(wanted) ? (wanted as Tab) : "tasks";
  });

  if (project.isError) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <BackToProjects />
        <Alert tone="error">{errorText(project.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!project.data) {
    return <ProjectPlaceholder />;
  }
  const data = project.data;
  const tabs: { key: Tab; label: string }[] = [
    { key: "tasks", label: t("tabTasks") },
    {
      key: "subsystems",
      label: t("tabSubsystems", { count: data.subsystems_count, shown: String(data.subsystems_count) }),
    },
    { key: "team", label: t("tabTeam") },
  ];

  /** Arrow keys go from tab to tab (the other way round in Arabic); Home and End, to the ends. */
  function moveBetweenTabs(event: KeyboardEvent<HTMLButtonElement>) {
    const index = tabs.findIndex(({ key }) => key === tab);
    const forward = getDirection(locale) === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backward = forward === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    const next =
      event.key === forward
        ? (index + 1) % tabs.length
        : event.key === backward
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null) {
      return;
    }
    event.preventDefault();
    setTab(tabs[next].key);
    document.getElementById(`tab-${tabs[next].key}`)?.focus();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <BackToProjects />
      <ProjectHeader project={data} />
      <div role="tablist" aria-label={t("sections")} className={tabBarClassName}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={moveBetweenTabs}
            className={tabClassName(tab === key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "tasks" ? <ProjectTasks project={data} /> : null}
        {tab === "subsystems" ? <ProjectSubsystems project={data} /> : null}
        {tab === "team" ? <ProjectTeam project={data} /> : null}
      </div>
    </div>
  );
}

function BackToProjects() {
  const t = useTranslations("Projects");
  return <BackLink href="/projects">{t("backToProjects")}</BackLink>;
}

function ProjectPlaceholder() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" aria-hidden="true">
      <div className="h-5 w-32 animate-pulse rounded bg-line" />
      <Card>
        <LinesPlaceholder lines={3} />
      </Card>
    </div>
  );
}

function ProjectHeader({ project }: { project: ProjectDetail }) {
  const t = useTranslations("Projects");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const changeStatus = useMutation({
    mutationFn: (status: ProjectStatus) => updateProject(project.id, { status }),
    onSettled: () => refreshWork(queryClient),
  });
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <CategoryBadge category={project.category} />
            <ProjectStatusBadge status={project.status} />
            {project.status === "active" ? <ProjectHealthBadge health={project.health} /> : null}
            {project.key ? (
              <span className="font-display text-sm font-bold tracking-wider text-racing" dir="ltr">
                <span className="sr-only">{t("keyLabel")} </span>
                {project.key}
              </span>
            ) : null}
          </div>
          <h1 dir="auto" className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl rtl:text-right">
            {project.name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Layers className="size-4" aria-hidden="true" />
              <bdi>{project.org_unit.name}</bdi>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-4" aria-hidden="true" />
              {project.project_manager
                ? t("managedBy", {
                    name: `${project.project_manager.first_name} ${project.project_manager.last_name}`,
                  })
                : t("noManager")}
            </span>
            {project.start_date || project.end_date ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange className="size-4" aria-hidden="true" />
                {t("dates", {
                  start: project.start_date ? date(project.start_date) : "…",
                  end: project.end_date ? date(project.end_date) : "…",
                })}
              </span>
            ) : null}
          </p>
        </div>
        {project.permissions.edit ? (
          <div className="w-full space-y-4 sm:w-60">
            <SelectField
              label={t("statusLabel")}
              value={project.status}
              disabled={changeStatus.isPending}
              onChange={(event) => changeStatus.mutate(event.target.value as ProjectStatus)}
            >
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {tWork(`projectStatus.${status}`)}
                </option>
              ))}
            </SelectField>
            <ProjectKey project={project} />
          </div>
        ) : null}
      </div>
      {changeStatus.isError ? <Alert tone="error">{errorText(changeStatus.error, tErrors)}</Alert> : null}
      {project.description ? (
        <p dir="auto" className="max-w-3xl text-sm whitespace-pre-line text-ink">
          {project.description}
        </p>
      ) : null}
      <div className="max-w-md space-y-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-ink">
            {t("tasksDone", { done: String(project.tasks_done), total: String(project.tasks_total) })}
          </span>
          {project.tasks_blocked > 0 ? (
            <span className="text-xs font-medium text-racing-strong">
              {t("blocked", { count: project.tasks_blocked, shown: String(project.tasks_blocked) })}
            </span>
          ) : null}
        </div>
        <ProgressBar done={project.tasks_done} total={project.tasks_total} label={t("progressLabel")} />
      </div>
    </section>
  );
}

function ProjectTasks({ project }: { project: ProjectDetail }) {
  const t = useTranslations("Projects");
  const tErrors = useTranslations("Errors");
  // The board shows the tasks; their subtasks are in each task's page.
  const filters = { project: project.id, parent: "none" };
  const tasks = useTasks(filters);
  const start = useStartTask(workKeys.tasks(filters));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t("boardIntro")}</p>
        {project.permissions.create_task ? (
          <Link
            href={{ pathname: "/tasks/new", query: { project: project.id } }}
            className={buttonClassName("primary", "sm")}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("newTask")}
          </Link>
        ) : null}
      </div>
      {start.isError ? <Alert tone="error">{errorText(start.error, tErrors)}</Alert> : null}
      {tasks.isError ? (
        <Alert tone="error">{errorText(tasks.error, tErrors)}</Alert>
      ) : !tasks.data ? (
        <LinesPlaceholder lines={4} />
      ) : (
        <TaskBoard tasks={tasks.data} onStart={(task) => start.mutate(task)} />
      )}
    </div>
  );
}

function ProjectSubsystems({ project }: { project: ProjectDetail }) {
  const t = useTranslations("Projects");
  const tErrors = useTranslations("Errors");
  const subsystems = useSubsystems(project.id);

  if (subsystems.isError) {
    return <Alert tone="error">{errorText(subsystems.error, tErrors)}</Alert>;
  }
  if (!subsystems.data) {
    return <LinesPlaceholder lines={4} />;
  }
  if (subsystems.data.length === 0) {
    return <p className="text-sm text-muted">{t("noSubsystems")}</p>;
  }
  const names = new Map(subsystems.data.map((subsystem) => [subsystem.id, subsystem.name]));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("lifecycleIntro")}</p>
      {subsystems.data.map((subsystem) => (
        <SubsystemCard
          key={subsystem.id}
          subsystem={subsystem}
          parentName={subsystem.parent_id ? names.get(subsystem.parent_id) : undefined}
        />
      ))}
    </div>
  );
}

function SubsystemCard({ subsystem, parentName }: { subsystem: Subsystem; parentName?: string }) {
  const t = useTranslations("Projects");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const tMember = useTranslations("Member");
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (state: StepState) => tickStep(subsystem.id, state.step.id, !state.is_complete),
    onSuccess: () => refreshWork(queryClient),
  });
  const changeStatus = useMutation({
    mutationFn: (status: SubsystemStatus) => updateSubsystemStatus(subsystem.id, status),
    onSuccess: () => refreshWork(queryClient),
  });
  const canTickSomething = subsystem.steps.some((state) => state.can_tick);

  return (
    <article
      aria-labelledby={`subsystem-${subsystem.id}`}
      className="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {parentName ? (
            <p className="text-xs text-muted">
              <bdi>{parentName}</bdi> ›
            </p>
          ) : null}
          <h2 id={`subsystem-${subsystem.id}`} dir="auto" className="text-base font-semibold text-ink rtl:text-right">
            {subsystem.name}
          </h2>
          <p dir="auto" className="text-sm text-muted">
            {subsystem.org_unit.name}
          </p>
        </div>
        {subsystem.permissions.edit ? (
          // A label beside the list (wrapped, its options joined its name), and a name saying whose
          // status it is: every card has one.
          <div className="flex items-center gap-2 text-sm text-muted">
            <label htmlFor={`subsystem-status-${subsystem.id}`}>{t("subsystemStatus")}</label>
            <select
              id={`subsystem-status-${subsystem.id}`}
              aria-label={tWork("statusOf", { title: subsystem.name })}
              value={subsystem.status}
              disabled={changeStatus.isPending}
              onChange={(event) => changeStatus.mutate(event.target.value as SubsystemStatus)}
              className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink focus:border-navy focus:outline-none"
            >
              {SUBSYSTEM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {tWork(`subsystemStatus.${status}`)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <SubsystemStatusBadge status={subsystem.status} />
        )}
      </header>
      {subsystem.members.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("subsystemMembers")}>
          {subsystem.members.map(({ member, member_level }) => (
            <li key={member.id} className="flex items-center gap-2 rounded-full bg-canvas py-1 ps-1 pe-3 text-xs">
              <Avatar
                firstName={member.first_name}
                lastName={member.last_name}
                seed={member.id}
                size="sm"
                className="size-6 text-2xs"
              />
              <span className="font-medium text-ink">
                {member.first_name} {member.last_name}
              </span>
              <span className="text-muted">{tMember(`levels.${member_level}`)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {toggle.isError ? <Alert tone="error">{errorText(toggle.error, tErrors)}</Alert> : null}
      {changeStatus.isError ? <Alert tone="error">{errorText(changeStatus.error, tErrors)}</Alert> : null}
      <LifecycleSteps
        steps={subsystem.steps}
        onToggle={canTickSomething ? (state) => toggle.mutate(state) : undefined}
        busy={toggle.isPending}
      />
    </article>
  );
}

function ProjectTeam({ project }: { project: ProjectDetail }) {
  const t = useTranslations("Projects");
  if (project.team.length === 0) {
    return <p className="text-sm text-muted">{t("noTeam")}</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {project.team.map(({ id, member, role }) => (
        <li key={id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-xs">
          <Avatar firstName={member.first_name} lastName={member.last_name} seed={member.id} />
          <span className="min-w-0 text-sm leading-tight">
            <span className="block truncate font-medium text-ink">
              {member.first_name} {member.last_name}
            </span>
            {role ? <span className="block truncate text-xs text-muted">{role}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
