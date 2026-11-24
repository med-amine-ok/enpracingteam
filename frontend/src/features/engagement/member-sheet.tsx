"use client";

import { useMemberAdding, useUnitLivery } from "@/features/members/use-members";
import {
  AlertTriangle,
  Briefcase,
  CalendarDays,
  GraduationCap,
  HandHeart,
  Link2,
  Pencil,
  ShieldAlert,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Image from "next/image";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { useMe } from "@/features/auth/use-me";
import { StatusBadge } from "@/features/members/member-badges";
import { currentMemberships } from "@/features/members/memberships";
import { useScore } from "@/features/ranking/ranking-parts";
import { MemberHealthBadge } from "@/features/team/team-parts";
import { Link } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { initials } from "@/lib/initials";
import { safeWebUrl } from "@/lib/links";
import type { MemberSheet } from "./api";
import { TrainingStatusBadge, VolunteeringStatusBadge, useDay, useMonth } from "./engagement-parts";
import { GoalRow } from "./objectives-page";
import { useLeads, useMemberSheet } from "./queries";

/** Team Manager – ERP Requirements §2: all a member's season on one page, for them, their heads, the TM and the Bureau. */
export function MemberSheetView() {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const leads = useLeads();
  const sheet = useMemberSheet(Number(id));
  const adding = useMemberAdding();
  const tDirectory = useTranslations("Directory");
  const back = me.data && String(me.data.id) === id ? "/profile" : leads ? "/engagement/team" : "/";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink href={back}>
          {t(back === "/profile" ? "backProfile" : back === "/" ? "backHome" : "backTeam")}
        </BackLink>
        {/* The Board and the Team Manager edit the members (decision D-025). */}
        {adding.data?.can_manage ? (
          <Link href={`/members/${id}/edit`} className={buttonClassName("secondary", "sm")}>
            <Pencil className="size-4" aria-hidden="true" />
            {tDirectory("editMember")}
          </Link>
        ) : null}
      </div>
      {sheet.isError ? (
        <Alert tone="error">{errorText(sheet.error, tErrors)}</Alert>
      ) : !sheet.data ? (
        <Card>
          <LinesPlaceholder lines={5} />
        </Card>
      ) : (
        <SheetContent sheet={sheet.data} />
      )}
    </div>
  );
}

function SheetContent({ sheet }: { sheet: MemberSheet }) {
  const unitLivery = useUnitLivery();
  const t = useTranslations("Engagement");
  const tWork = useTranslations("Work");
  const tMeetings = useTranslations("Meetings");
  const tRanking = useTranslations("Ranking");
  const tDiscipline = useTranslations("Discipline");
  const tDirectory = useTranslations("Directory");
  const format = useFormatter();
  const day = useDay();
  const month = useMonth();
  const score = useScore();
  const { member } = sheet;
  const memberships = currentMemberships(member.memberships, clubToday(new Date()));
  const primary = memberships.find((membership) => membership.is_primary) ?? memberships[0];
  const colours = unitLivery(primary?.org_unit.code);
  const percent = (value: number | null) =>
    value == null ? "—" : `${format.number(value, { maximumFractionDigits: 0, numberingSystem: "latn" })} %`;
  const dateTime = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });

  return (
    <>
      {/* The Figma's member detail: a header in the livery of the member's department, their team's car. */}
      <section
        className="relative overflow-hidden rounded-lg shadow-card"
        style={{
          background: `linear-gradient(135deg, ${colours.shade} 0%, ${colours.color} 80%)`,
          color: colours.foreground,
        }}
      >
        <Image
          src="/racing/speed-pattern.webp"
          alt=""
          width={1282}
          height={632}
          className="pointer-events-none absolute inset-y-0 end-0 h-full w-auto max-w-none opacity-20"
        />
        {member.race_number ? (
          <span
            className="pointer-events-none absolute end-6 top-2 font-display text-[120px] leading-none font-extrabold opacity-15 select-none"
            aria-hidden="true"
          >
            {member.race_number}
          </span>
        ) : null}
        {colours.car ? (
          <Image
            src={colours.car}
            alt=""
            width={1018}
            height={224}
            className="pointer-events-none absolute end-4 -bottom-2 hidden w-[40%] object-contain opacity-90 md:block"
          />
        ) : null}
        <div className="relative z-10 flex flex-wrap items-end gap-6 px-6 py-7 sm:px-8 md:max-w-[64%]">
          <span
            className="grid size-20 shrink-0 place-items-center rounded-full bg-black/25 font-display text-2xl font-extrabold text-white ring-4 ring-white/20"
            aria-hidden="true"
          >
            {initials(member.first_name, member.last_name)}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            {primary ? (
              <p className="text-2xs font-bold tracking-widest uppercase opacity-70">
                <bdi>{primary.org_unit.name}</bdi>
              </p>
            ) : null}
            <h1 className="font-display text-4xl leading-none font-extrabold tracking-wide uppercase">
              <span className="font-light opacity-75">{member.first_name}</span> {member.last_name}
            </h1>
            {primary ? (
              <p className="text-sm font-medium opacity-85">
                <bdi>{primary.role.name}</bdi>
              </p>
            ) : null}
            <p className="text-xs font-semibold opacity-65">
              {colours.team}
              {member.race_number ? ` · ${t("raceNumber", { number: String(member.race_number) })}` : null}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <StatusBadge status={member.status} />
              {sheet.health.status ? <MemberHealthBadge status={sheet.health.status} /> : null}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
          <p className="eyebrow mb-1">{t("studies")}</p>
          <p className="text-sm font-medium text-navy">
            {member.study_level ? t(`studyLevel.${member.study_level}`) : t("studyUnknown")}
            {member.study_field ? (
              <>
                {" · "}
                <bdi>{member.study_field}</bdi>
              </>
            ) : null}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
          <p className="eyebrow mb-1">{t("currentUnits")}</p>
          <p className="text-sm font-medium text-navy">
            {memberships.length > 0
              ? memberships.map((membership, index) => (
                  <span key={membership.id}>
                    {index > 0 ? " · " : null}
                    <bdi>{membership.org_unit.name}</bdi> (<bdi>{membership.role.name}</bdi>)
                  </span>
                ))
              : "—"}
          </p>
        </div>
        {/* The projects under way or planned they work on or manage (decision D-025). */}
        <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
          <p className="eyebrow mb-1">{t("currentProjects")}</p>
          <p className="text-sm font-medium text-navy">
            {member.projects.length > 0
              ? member.projects.map((project, index) => (
                  <span key={project.id}>
                    {index > 0 ? " · " : null}
                    <Link href={`/projects/${project.id}`} className="hover:underline">
                      <bdi>{project.name}</bdi>
                    </Link>
                    {project.manages ? ` (${tDirectory("projectManager")})` : null}
                  </span>
                ))
              : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
          <p className="eyebrow mb-1">{t("activity")}</p>
          <p className="text-sm font-medium text-navy">
            {sheet.health.last_activity
              ? t("lastActivity", { date: dateTime(sheet.health.last_activity) })
              : t("noActivity")}
          </p>
        </div>
      </div>

      {member.alumni_profile ? <AlumniCard profile={member.alumni_profile} colour={colours.color} /> : null}

      <Card title={t("sheetGoalsTitle", { season: `${sheet.season}-${sheet.season + 1}` })}>
        {sheet.objectives.length === 0 ? (
          <p className="text-sm text-muted">{t("noGoals")}</p>
        ) : (
          <ul className="space-y-3">
            {sheet.objectives.map((goal) => (
              <GoalRow key={goal.id} goal={goal} />
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title={t("sheetTasksTitle")}>
          <Figures
            items={[
              [t("openTasks"), String(sheet.tasks.open)],
              [t("overdueTasks"), String(sheet.tasks.overdue)],
              [t("validatedTasks"), String(sheet.tasks.validated_recently)],
            ]}
          />
          {sheet.tasks.current.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {sheet.tasks.current.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/tasks/${task.id}`} dir="auto" className="min-w-0 flex-1 text-ink hover:underline">
                    {task.title}
                  </Link>
                  <Badge tone="neutral">{tWork(`taskStatus.${task.status}`)}</Badge>
                  {task.overdue ? (
                    <Badge tone="danger">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      {t("late")}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title={t("sheetPresenceTitle")}>
          <Figures
            items={[
              [t("presenceMonth"), percent(sheet.presence.month)],
              [t("presenceSeason"), percent(sheet.presence.season)],
            ]}
          />
          {sheet.presence.recent.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {sheet.presence.recent.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <CalendarDays className="size-4 text-muted" aria-hidden="true" />
                  <Link href={`/meetings/${session.id}`} dir="auto" className="min-w-0 flex-1 text-ink hover:underline">
                    {session.title}
                  </Link>
                  <span className="text-xs text-muted">{dateTime(session.starts_at)}</span>
                  <Badge
                    tone={session.status === "absent" ? "danger" : session.status === "late" ? "warning" : "success"}
                  >
                    {tMeetings(`attendance.${session.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title={t("sheetContributionsTitle")}>
          <Figures items={[[t("seasonPoints"), String(sheet.contributions.season_points)]]} />
          {sheet.contributions.scores.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {sheet.contributions.scores.map((row) => (
                <li key={row.month} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 text-ink">{month(row.month)}</span>
                  <span className="text-muted">{t("scoreValue", { value: score(row.final) })}</span>
                  {row.category ? <Badge tone="info">{tRanking(`categoryName.${row.category}`)}</Badge> : null}
                  {row.rank != null ? (
                    <span className="text-xs text-muted">{t("rank", { rank: row.rank })}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">{t("noScores")}</p>
          )}
        </Card>

        <Card title={t("sheetWarningsTitle")}>
          {sheet.warnings.length === 0 ? (
            <p className="text-sm text-muted">{t("noWarnings")}</p>
          ) : (
            <ul className="space-y-2">
              {sheet.warnings.map((warning) => (
                <li key={warning.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <ShieldAlert className="size-4 text-racing" aria-hidden="true" />
                  <Link href={`/discipline/warnings/${warning.id}`} className="text-ink hover:underline">
                    {t("warningNumber", { level: warning.level })}
                  </Link>
                  <Badge tone="neutral">{tDiscipline(`ground.${warning.ground}`)}</Badge>
                  <span className="text-xs text-muted">{dateTime(warning.issued_at)}</span>
                  {warning.status === "cancelled" ? <Badge tone="warning">{t("cancelledWarning")}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("sheetTrainingsTitle")}>
          {sheet.trainings.length === 0 ? (
            <p className="text-sm text-muted">{t("noTrainings")}</p>
          ) : (
            <ul className="space-y-2">
              {sheet.trainings.map((training) => (
                <li key={training.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <GraduationCap className="size-4 text-navy" aria-hidden="true" />
                  <span dir="auto" className="min-w-0 flex-1 text-ink">
                    {training.topic}
                  </span>
                  <TrainingStatusBadge status={training.status} />
                  {training.followed_on ? (
                    <span className="text-xs text-muted">{day(training.followed_on)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("sheetVolunteeringTitle")}>
          {sheet.volunteering.months_covered.length > 0 ? (
            <p className="mb-3 text-sm text-ink">
              {t("monthsCovered", { months: sheet.volunteering.months_covered.map(month).join(", ") })}
            </p>
          ) : null}
          {sheet.volunteering.activities.length === 0 ? (
            <p className="text-sm text-muted">{t("noActivities")}</p>
          ) : (
            <ul className="space-y-2">
              {sheet.volunteering.activities.map((activity) => (
                <li key={activity.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <HandHeart className="size-4 text-racing" aria-hidden="true" />
                  <span dir="auto" className="min-w-0 flex-1 text-ink">
                    {activity.title}
                  </span>
                  <span className="text-xs text-muted">{day(activity.date)}</span>
                  <VolunteeringStatusBadge status={activity.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/** A few figures side by side: a label above a large number. */
/** The Figma's alumni card: where a former member works now, and whether they mentor the team. */
function AlumniCard({
  profile,
  colour,
}: {
  profile: NonNullable<MemberSheet["member"]["alumni_profile"]>;
  colour: string;
}) {
  const t = useTranslations("Engagement");
  const linkedin = safeWebUrl(profile.linkedin_url);
  const items: [string, ReactNode][] = [
    [t("alumniYear"), profile.graduation_year ?? "—"],
    [t("alumniCompany"), profile.current_company ? <bdi>{profile.current_company}</bdi> : "—"],
    [t("alumniPosition"), profile.current_position ? <bdi>{profile.current_position}</bdi> : "—"],
    [
      t("alumniMentor"),
      <Badge key="mentor" tone={profile.willing_to_mentor ? "success" : "neutral"}>
        {t(profile.willing_to_mentor ? "alumniMentorYes" : "alumniMentorNo")}
      </Badge>,
    ],
  ];
  return (
    <section
      aria-labelledby="alumni-title"
      className="rounded-lg border border-s-4 border-line bg-surface p-5 shadow-card"
      style={{ borderInlineStartColor: colour }}
    >
      <h2 id="alumni-title" className="eyebrow mb-3 flex items-center gap-2">
        <Briefcase className="size-3.5" aria-hidden="true" />
        {t("alumniTitle")}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-2xs tracking-widest text-muted uppercase">{label}</dt>
            <dd className="mt-0.5 font-semibold text-navy">{value}</dd>
          </div>
        ))}
      </dl>
      {linkedin ? (
        <a
          href={linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-racing hover:underline"
        >
          <Link2 className="size-3.5" aria-hidden="true" />
          {t("alumniLinkedin")}
        </a>
      ) : null}
    </section>
  );
}

function Figures({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-3 gap-3">
      {items.map(([label, value]) => (
        <div key={label} className="space-y-0.5">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="text-xl font-semibold text-ink tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
