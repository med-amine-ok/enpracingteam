"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Boxes,
  CalendarDays,
  FileText,
  FolderKanban,
  HandHeart,
  ListChecks,
  Network,
  OctagonX,
  ShieldAlert,
  ShoppingCart,
  Trophy,
  UserRound,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { LoadError } from "@/components/ui/load-error";
import { useMe } from "@/features/auth/use-me";
import { MeetingBadges, useWhen } from "@/features/meetings/meeting-parts";
import { useMeetings } from "@/features/meetings/queries";
import type { Project, Task } from "@/features/work/api";
import { useProjects, useTasks } from "@/features/work/queries";
import { Link } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";
import { useOrgUnits } from "@/features/members/use-members";
import { livery, liveryOfMemberships } from "@/lib/livery";

const OPEN_STATUSES = ["planned", "in_progress", "needs_revision"];

/** The share of a project's tasks done, in %. */
function progressOf(project: Project) {
  return project.tasks_total ? Math.round((project.tasks_done / project.tasks_total) * 100) : 0;
}

/** Red under half, amber under three quarters, green above, as in the Figma. */
function progressColour(value: number) {
  return value < 50 ? "var(--color-racing)" : value < 75 ? "var(--color-amber)" : "var(--color-green)";
}

/** The home page, as the Figma's dashboard: the command centre, key figures, my tasks, sessions, projects. */
export function HomeDashboard() {
  const t = useTranslations("Home");
  const tasks = useTasks({ assignee: "me" });
  const projects = useProjects();
  const open = tasks.data?.filter((task) => OPEN_STATUSES.includes(task.status)) ?? [];
  const active = projects.data?.filter((project) => project.status === "active") ?? [];
  const average = active.length
    ? Math.round(active.reduce((sum, project) => sum + progressOf(project), 0) / active.length)
    : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <Hero openTasks={tasks.data ? String(open.length) : "—"} progress={projects.data ? `${average}%` : "—"} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("kpiOpen")}
          value={tasks.data ? open.length : "—"}
          hint={t("kpiOpenHint")}
          icon={<ListChecks />}
          href="/tasks"
        />
        <KpiCard
          label={t("kpiOverdue")}
          value={tasks.data ? open.filter((task) => task.is_overdue).length : "—"}
          hint={t("kpiOverdueHint")}
          icon={<AlertTriangle />}
          accent="var(--color-amber)"
          href="/tasks"
        />
        <KpiCard
          label={t("kpiBlocked")}
          value={tasks.data ? open.filter((task) => task.is_blocked).length : "—"}
          hint={t("kpiBlockedHint")}
          icon={<OctagonX />}
          href="/tasks"
        />
        <KpiCard
          label={t("kpiProjects")}
          value={projects.data ? active.length : "—"}
          hint={projects.data ? t("kpiProjectsHint", { count: projects.data.length }) : undefined}
          icon={<FolderKanban />}
          accent="var(--color-green)"
          href="/projects"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <MyTasks
            tasks={tasks.data ? open : undefined}
            error={tasks.error}
            overdue={open.filter((task) => task.is_overdue).length}
          />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <NextMeeting />
          <ProjectsProgress projects={projects.data ? active : undefined} error={projects.error} />
        </div>
      </div>

      <section className="space-y-4" aria-labelledby="shortcuts-title">
        <h2
          id="shortcuts-title"
          className="flex items-center gap-2.5 font-display text-xl font-bold tracking-wider text-navy uppercase"
        >
          <span className="h-5 w-1 rounded-full bg-racing" aria-hidden="true" />
          {t("shortcutsTitle")}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Shortcut href="/profile" icon={<UserRound />} title={t("shortcutProfile")} text={t("shortcutProfileText")} />
          <Shortcut
            href="/directory"
            icon={<Users />}
            title={t("shortcutDirectory")}
            text={t("shortcutDirectoryText")}
          />
          <Shortcut
            href="/org-chart"
            icon={<Network />}
            title={t("shortcutOrgChart")}
            text={t("shortcutOrgChartText")}
          />
          <Shortcut
            href="/projects"
            icon={<FolderKanban />}
            title={t("shortcutProjects")}
            text={t("shortcutProjectsText")}
          />
          <Shortcut href="/tasks" icon={<ListChecks />} title={t("shortcutTasks")} text={t("shortcutTasksText")} />
          <Shortcut
            href="/meetings"
            icon={<CalendarDays />}
            title={t("shortcutMeetings")}
            text={t("shortcutMeetingsText")}
          />
          <Shortcut
            href="/documents"
            icon={<FileText />}
            title={t("shortcutDocuments")}
            text={t("shortcutDocumentsText")}
          />
          <Shortcut href="/workshop" icon={<Wrench />} title={t("shortcutWorkshop")} text={t("shortcutWorkshopText")} />
          <Shortcut href="/ranking" icon={<Trophy />} title={t("shortcutRanking")} text={t("shortcutRankingText")} />
          <Shortcut
            href="/discipline"
            icon={<ShieldAlert />}
            title={t("shortcutDiscipline")}
            text={t("shortcutDisciplineText")}
          />
          <Shortcut
            href="/engagement"
            icon={<HandHeart />}
            title={t("shortcutEngagement")}
            text={t("shortcutEngagementText")}
          />
          <Shortcut href="/assistant" icon={<Bot />} title={t("shortcutAssistant")} text={t("shortcutAssistantText")} />
          <Shortcut
            href="/purchasing"
            icon={<ShoppingCart />}
            title={t("shortcutPurchasing")}
            text={t("shortcutPurchasingText")}
          />
          <Shortcut href="/stock" icon={<Boxes />} title={t("shortcutStock")} text={t("shortcutStockText")} />
          <Shortcut href="/finance" icon={<Wallet />} title={t("shortcutFinance")} text={t("shortcutFinanceText")} />
          <Shortcut
            href="/notifications"
            icon={<Bell />}
            title={t("shortcutNotifications")}
            text={t("shortcutNotificationsText")}
          />
        </ul>
      </section>
    </div>
  );
}

/** The Figma's "command centre": night blue, a circuit, the car of the member's department. */
function Hero({ openTasks, progress }: { openTasks: string; progress: string }) {
  const t = useTranslations("Home");
  const { data: member } = useMe();
  const units = useOrgUnits();
  // Once the member is known, in the browser: "today" is never frozen at build time.
  const colours = member
    ? liveryOfMemberships(member.memberships, clubToday(new Date()), units.data)
    : livery("projet");
  const car = colours.car ?? "/racing/ferrari-car.webp";
  return (
    <section className="relative min-h-64 overflow-hidden rounded-lg bg-navy p-6 text-white shadow-card sm:p-8">
      <Image
        src="/racing/circuit-grey.svg"
        alt=""
        width={630}
        height={201}
        className="pointer-events-none absolute -end-8 top-4 hidden w-[58%] opacity-35 lg:block rtl:-scale-x-100"
      />
      <Image
        src="/racing/circuit-sign.svg"
        alt=""
        width={630}
        height={201}
        className="pointer-events-none absolute -end-8 top-4 hidden w-[58%] opacity-55 lg:block rtl:-scale-x-100"
      />
      <Image
        src={car}
        alt=""
        width={1018}
        height={224}
        priority
        className="pointer-events-none absolute end-5 -bottom-2 hidden w-[46%] object-contain drop-shadow-2xl md:block"
      />
      <div className="relative z-10 max-w-xl">
        <p className="mb-5 flex items-center gap-3">
          <span
            className="size-1.5 rounded-full bg-racing shadow-[0_0_0_5px_rgb(190_30_45_/_18%)]"
            aria-hidden="true"
          />
          <span className="text-2xs font-semibold tracking-[0.24em] text-white/50 uppercase">{t("heroEyebrow")}</span>
        </p>
        {member ? (
          <h1 className="font-display text-3xl leading-tight font-bold tracking-wide uppercase sm:text-4xl">
            {t("greeting", { name: member.first_name })}
          </h1>
        ) : (
          <div className="h-9 w-56 animate-pulse rounded bg-white/10" aria-hidden="true" />
        )}
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/55">{t("intro")}</p>
        <div className="mt-7 flex items-center gap-5">
          <div>
            <p className="font-display text-4xl font-bold">{progress}</p>
            <p className="text-2xs tracking-widest text-white/40 uppercase">{t("projectsProgress")}</p>
          </div>
          <div className="h-10 w-px bg-white/10" aria-hidden="true" />
          <div>
            <p className="font-display text-4xl font-bold">{openTasks}</p>
            <p className="text-2xs tracking-widest text-white/40 uppercase">{t("myOpenTasks")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  planned: "neutral",
  in_progress: "info",
  submitted: "warning",
  needs_revision: "danger",
  validated: "success",
};

const PRIORITY_TONES: Record<string, BadgeTone> = { high: "danger", medium: "warning", low: "neutral" };

/** My open tasks, the late ones first, as the Figma's "recent tasks". */
function MyTasks({ tasks, error, overdue }: { tasks: Task[] | undefined; error: Error | null; overdue: number }) {
  const t = useTranslations("Home");
  const tWork = useTranslations("Work");
  const shown = [...(tasks ?? [])].sort((a, b) => Number(b.is_overdue) - Number(a.is_overdue)).slice(0, 6);
  return (
    <Card
      title={t("myTasks")}
      action={
        <Link
          href="/tasks"
          className="shrink-0 text-2xs font-bold tracking-widest text-muted uppercase hover:text-racing"
        >
          {t("openBoard")}
        </Link>
      }
      className="p-0 sm:p-0 [&>header]:px-5 [&>header]:pt-5"
    >
      {error ? (
        <div className="px-5 pb-5">
          <LoadError error={error} />
        </div>
      ) : !tasks ? (
        <div className="px-5 pb-5">
          <LinesPlaceholder lines={4} />
        </div>
      ) : shown.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">{t("noOpenTasks")}</p>
      ) : (
        <>
          <ul>
            {shown.map((task) => (
              <li key={task.id} className="border-t border-line first:border-t-0">
                <Link
                  href={`/tasks/${task.id}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas"
                >
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-sm font-medium text-navy">
                      {task.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      <bdi>{task.project.name}</bdi>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {task.priority ? (
                      <Badge tone={PRIORITY_TONES[task.priority] ?? "neutral"}>
                        {tWork(`priority.${task.priority}`)}
                      </Badge>
                    ) : null}
                    <Badge tone={task.is_overdue ? "danger" : (STATUS_TONES[task.status] ?? "neutral")}>
                      {tWork(`taskStatus.${task.status}`)}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {overdue > 0 ? (
            <p className="border-t border-line px-5 py-3 text-sm font-medium text-racing-strong">
              {t("overdueTasks", { count: overdue, shown: String(overdue) })}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** The active projects with their progress, coloured as in the Figma. */
function ProjectsProgress({ projects, error }: { projects: Project[] | undefined; error: Error | null }) {
  const t = useTranslations("Home");
  return (
    <Card
      title={t("projectsTitle")}
      action={
        <Link
          href="/projects"
          className="shrink-0 text-2xs font-bold tracking-widest text-muted uppercase hover:text-racing"
        >
          {t("allProjects")}
        </Link>
      }
    >
      {error ? (
        <LoadError error={error} />
      ) : !projects ? (
        <LinesPlaceholder lines={3} />
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted">{t("noProjects")}</p>
      ) : (
        <ul className="space-y-4">
          {projects.map((project) => {
            const value = progressOf(project);
            return (
              <li key={project.id}>
                <Link href={`/projects/${project.id}`} className="block space-y-2 rounded-md hover:bg-canvas">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <bdi className="block truncate font-display text-sm font-bold tracking-wide text-navy uppercase">
                        {project.name}
                      </bdi>
                      {project.project_manager ? (
                        <span className="block text-xs text-muted">
                          {project.project_manager.first_name} {project.project_manager.last_name}
                        </span>
                      ) : null}
                    </span>
                    {project.tasks_blocked > 0 ? (
                      <Badge tone="danger">{t("blockedCount", { count: project.tasks_blocked })}</Badge>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <span
                      className="h-1.5 w-full overflow-hidden rounded-full bg-line"
                      role="progressbar"
                      aria-label={t("progressOf", { name: project.name })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={value}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${value}%`, background: progressColour(value) }}
                      />
                    </span>
                    <span className="w-10 text-end text-xs font-semibold text-muted tabular-nums">{value}%</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The viewer's next session: when, where, and whether it is mandatory. */
function NextMeeting() {
  const t = useTranslations("Home");
  const when = useWhen();
  const meetings = useMeetings("upcoming");
  const next = meetings.data?.find((meeting) => meeting.status === "planned");
  return (
    <Card
      title={t("nextMeeting")}
      action={
        <Link
          href="/meetings"
          className="shrink-0 text-2xs font-bold tracking-widest text-muted uppercase hover:text-racing"
        >
          {t("allMeetings")}
        </Link>
      }
    >
      {meetings.error ? (
        <LoadError error={meetings.error} />
      ) : !meetings.data ? (
        <LinesPlaceholder lines={2} />
      ) : next ? (
        <Link href={`/meetings/${next.id}`} className="block space-y-2 rounded-lg hover:bg-canvas">
          <span dir="auto" className="block font-medium text-ink">
            {next.title}
          </span>
          <MeetingBadges meeting={next} />
          <span className="block text-sm text-muted">{when(next.starts_at, next.ends_at)}</span>
          {next.location ? (
            <span dir="auto" className="block text-sm text-muted">
              {next.location}
            </span>
          ) : null}
        </Link>
      ) : (
        <p className="text-sm text-muted">{t("noMeeting")}</p>
      )}
    </Card>
  );
}

function Shortcut({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <li>
      <Link
        href={href}
        className="group flex h-full items-start gap-4 rounded-lg border border-line bg-surface p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-racing/30 hover:shadow-card-hover"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-navy text-white [&>svg]:size-5">
          {icon}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center gap-1.5 font-display text-base font-bold tracking-wide text-navy uppercase">
            {title}
            <ArrowRight
              className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-racing rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </span>
          <span className="block text-sm text-muted">{text}</span>
        </span>
      </Link>
    </li>
  );
}
