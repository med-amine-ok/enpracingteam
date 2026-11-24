"use client";

import { useUnitLivery } from "@/features/members/use-members";
import { FolderKanban, FolderPlus, Layers, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { PROJECT_HEALTHS, type Project, type ProjectHealth } from "@/features/work/api";
import { CategoryBadge, ProjectHealthBadge } from "@/features/work/badges";
import { ProgressBar } from "@/features/work/lifecycle-steps";
import { useProjectCreating, useProjects } from "@/features/work/queries";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { ProjectRoadmap, progressOf } from "./project-roadmap";

export function ProjectsList() {
  const t = useTranslations("Projects");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [view, setView] = useState<"cards" | "roadmap">("cards");
  const [health, setHealth] = useState<ProjectHealth | "">("");
  const projects = useProjects(scope === "mine" ? { mine: true } : {});
  const creating = useProjectCreating();
  const shown = projects.data?.filter((project) => !health || project.health === health) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("intro")}>
        {creating.data?.can_create ? (
          <Link href="/projects/new" className={buttonClassName("primary", "md")}>
            <FolderPlus className="size-4" aria-hidden="true" />
            {t("newProject")}
          </Link>
        ) : null}
      </PageHeader>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={t("scopeLabel")}
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: t("all") },
              { value: "mine", label: t("mine") },
            ]}
          />
          <Segmented
            label={t("viewLabel")}
            value={view}
            onChange={setView}
            options={[
              { value: "cards", label: t("view.cards") },
              { value: "roadmap", label: t("view.roadmap") },
            ]}
          />
        </div>
        <div role="group" aria-label={t("healthLabel")} className="flex flex-wrap gap-2">
          {(["", ...PROJECT_HEALTHS] as const).map((value) => (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={health === value}
              onClick={() => setHealth(value)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-2xs font-semibold tracking-widest uppercase transition-colors",
                health === value
                  ? "border-racing bg-racing text-white"
                  : "border-line bg-surface text-muted hover:border-racing hover:text-racing",
              )}
            >
              {value ? tWork(`projectHealth.${value}`) : t("allHealths")}
            </button>
          ))}
        </div>
      </div>

      {projects.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(projects.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => projects.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !projects.data ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="h-48 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
          <FolderKanban className="size-8 text-muted" aria-hidden="true" />
          <p className="font-medium text-ink">{t("empty")}</p>
        </div>
      ) : view === "roadmap" ? (
        <ProjectRoadmap projects={shown} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const unitLivery = useUnitLivery();
  const t = useTranslations("Projects");
  const colours = unitLivery(project.org_unit.code);
  const progress = progressOf(project);
  return (
    <li>
      <Link
        href={`/projects/${project.id}`}
        className="group relative flex h-full flex-col gap-4 overflow-hidden rounded-lg border border-line bg-surface p-5 pt-6 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover"
      >
        <span className="absolute inset-x-0 top-0 h-1" style={{ background: colours.color }} aria-hidden="true" />
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <CategoryBadge category={project.category} />
            <ProjectHealthBadge health={project.health} />
          </div>
          {/* Project names are data, shown as saved in the ERP. */}
          <h2 dir="auto" className="text-start font-display text-xl font-bold tracking-wide text-navy uppercase">
            {project.name}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3.5" aria-hidden="true" />
              <bdi>{project.org_unit.name}</bdi>
            </span>
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5" aria-hidden="true" />
              {project.project_manager
                ? `${project.project_manager.first_name} ${project.project_manager.last_name}`
                : t("noManager")}
            </span>
          </p>
        </div>
        <div className="mt-auto space-y-2">
          <p className="font-display text-4xl leading-none font-bold text-navy" aria-hidden="true">
            {progress}%
          </p>
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
          {project.subsystems_count > 0 ? (
            <p className="text-xs text-muted">
              {t("subsystems", { count: project.subsystems_count, shown: String(project.subsystems_count) })}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
