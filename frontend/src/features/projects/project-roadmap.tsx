"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useUnitLivery } from "@/features/members/use-members";
import type { Project } from "@/features/work/api";
import { ProjectHealthBadge } from "@/features/work/badges";
import { Link } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";

const DAY = 86_400_000;

function time(day: string) {
  return new Date(`${day}T12:00:00Z`).getTime();
}

/** The months between two days ("2026-10", with their first day and their length), for the timeline's scale. */
function monthsBetween(first: number, last: number) {
  const months: { key: string; start: number; days: number }[] = [];
  const cursor = new Date(first);
  cursor.setUTCDate(1);
  cursor.setUTCHours(12, 0, 0, 0);
  while (cursor.getTime() <= last) {
    const start = cursor.getTime();
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    months.push({
      key: new Date(start).toISOString().slice(0, 7),
      start,
      days: Math.round((cursor.getTime() - start) / DAY),
    });
  }
  return months;
}

export function progressOf(project: Project) {
  return project.tasks_total ? Math.round((project.tasks_done / project.tasks_total) * 100) : 0;
}

/** The Figma's roadmap: each project with its dates as a bar on the months' scale, its progress inside it, and
 * today. Drawn once the projects are loaded, in the browser: "today" is never frozen at build time. */
export function ProjectRoadmap({ projects }: { projects: Project[] }) {
  const t = useTranslations("Projects");
  const format = useFormatter();
  const unitLivery = useUnitLivery();
  const dated = projects.filter((project) => project.start_date && project.end_date);
  const undated = projects.filter((project) => !project.start_date || !project.end_date);
  if (dated.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
        {t("roadmapEmpty")}
      </p>
    );
  }
  const first = Math.min(...dated.map((project) => time(project.start_date!)));
  const last = Math.max(...dated.map((project) => time(project.end_date!)));
  const months = monthsBetween(first, last);
  const start = months[0].start;
  const end = months[months.length - 1].start + months[months.length - 1].days * DAY;
  const span = end - start;
  const share = (value: number) => `${((value - start) / span) * 100}%`;
  const today = time(clubToday(new Date()));
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", numberingSystem: "latn" });

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[14rem_1fr] border-b border-line bg-canvas">
            <span className="px-4 py-2 text-2xs font-semibold tracking-widest text-muted uppercase">
              {t("roadmapProject")}
            </span>
            <ol className="relative flex">
              {months.map((month) => (
                <li
                  key={month.key}
                  className="min-w-0 truncate border-s border-line px-2 py-2 text-2xs font-semibold tracking-wider text-muted uppercase"
                  style={{ flex: `${month.days} 1 0` }}
                >
                  {format.dateTime(new Date(`${month.key}-15T12:00:00Z`), {
                    month: "short",
                    year: "2-digit",
                    numberingSystem: "latn",
                  })}
                </li>
              ))}
            </ol>
          </div>
          <ul>
            {dated.map((project) => {
              const colours = unitLivery(project.org_unit.code);
              const from = time(project.start_date!);
              const to = time(project.end_date!) + DAY;
              const progress = progressOf(project);
              return (
                <li key={project.id} className="grid grid-cols-[14rem_1fr] border-b border-line last:border-0">
                  <div className="min-w-0 space-y-1 px-4 py-3">
                    <Link
                      href={`/projects/${project.id}`}
                      dir="auto"
                      className="block truncate font-display text-sm font-bold tracking-wide text-navy uppercase hover:underline"
                    >
                      {project.name}
                    </Link>
                    <ProjectHealthBadge health={project.health} />
                  </div>
                  <div className="relative min-h-16">
                    {today >= start && today <= end ? (
                      <span
                        className="absolute inset-y-0 w-px bg-racing"
                        style={{ insetInlineStart: share(today) }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <div
                      role="img"
                      aria-label={t("roadmapBar", {
                        name: project.name,
                        start: day(project.start_date!),
                        end: day(project.end_date!),
                        progress: String(progress),
                      })}
                      className="absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded-sm"
                      style={{
                        insetInlineStart: share(from),
                        width: `${((to - from) / span) * 100}%`,
                        background: `color-mix(in srgb, ${colours.color} 22%, white)`,
                        border: `1px solid ${colours.color}`,
                      }}
                    >
                      <span className="block h-full" style={{ width: `${progress}%`, background: colours.color }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">
        <span className="inline-block h-3 w-px bg-racing" aria-hidden="true" />
        {t("roadmapToday", { date: day(clubToday(new Date())) })}
      </p>
      {undated.length > 0 ? (
        <p className="text-sm text-muted">
          {t("roadmapUndated", { names: undated.map((project) => project.name).join(", ") })}
        </p>
      ) : null}
    </div>
  );
}
