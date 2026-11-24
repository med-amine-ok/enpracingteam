"use client";

import { ChevronRight, FolderKanban } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { useMembers, useOrgUnits, useUnitLivery } from "@/features/members/use-members";
import { progressOf } from "@/features/projects/project-roadmap";
import type { Project } from "@/features/work/api";
import { ProjectHealthBadge } from "@/features/work/badges";
import { ProgressBar } from "@/features/work/lifecycle-steps";
import { useProjects } from "@/features/work/queries";
import { Link } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { buildOrgChart, type UnitNode, type UnitPerson } from "./tree";

function find(nodes: UnitNode[], id: number): UnitNode | null {
  for (const node of nodes) {
    if (node.unit.id === id) {
      return node;
    }
    const below = find(node.children, id);
    if (below) {
      return below;
    }
  }
  return null;
}

/** The people of a unit and of every unit below it, each once (their membership in the highest unit). */
function everyone(node: UnitNode): UnitPerson[] {
  const seen = new Map<number, UnitPerson>();
  const visit = (current: UnitNode) => {
    for (const person of current.people) {
      if (!seen.has(person.member.id)) {
        seen.set(person.member.id, person);
      }
    }
    current.children.forEach(visit);
  };
  visit(node);
  return [...seen.values()];
}

function unitIds(node: UnitNode): number[] {
  return [node.unit.id, ...node.children.flatMap(unitIds)];
}

/** A department's page, as in the team's Figma (decision D-022): its livery, what it does, its heads, its members
 * (main, then junior), its projects and the units below it. */
export function UnitPage() {
  const t = useTranslations("OrgChart");
  const tErrors = useTranslations("Errors");
  const { id } = useParams<{ id: string }>();
  const units = useOrgUnits();
  const members = useMembers();
  const projects = useProjects();
  const error = units.error ?? members.error;

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <Alert tone="error">{errorText(error, tErrors)}</Alert>
      </div>
    );
  }
  if (!units.data || !members.data) {
    return (
      <div className="mx-auto max-w-5xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={5} />
        </Card>
      </div>
    );
  }
  // Drawn once the data is in, in the browser: "today" is never frozen at build time.
  const node = find(buildOrgChart(units.data, members.data, clubToday(new Date())), Number(id));
  if (!node) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <BackLink href="/org-chart">{t("title")}</BackLink>
        <Alert tone="error">{t("unitNotFound")}</Alert>
      </div>
    );
  }
  const ids = new Set(unitIds(node));
  return (
    <UnitContent
      node={node}
      projects={projects.data?.filter((project) => ids.has(project.org_unit.id))}
      projectsError={projects.error}
    />
  );
}

function UnitContent({
  node,
  projects,
  projectsError,
}: {
  node: UnitNode;
  projects: Project[] | undefined;
  projectsError: Error | null;
}) {
  const t = useTranslations("OrgChart");
  const unitLivery = useUnitLivery();
  const colours = unitLivery(node.unit.code);
  const people = everyone(node);
  const heads = node.people.filter((person) => person.membership.role.is_leadership);
  const rest = people.filter((person) => !heads.some((head) => head.member.id === person.member.id));
  const groups = [
    { key: "main", people: rest.filter((person) => person.membership.member_level === "main") },
    { key: "junior", people: rest.filter((person) => person.membership.member_level === "junior") },
    { key: "other", people: rest.filter((person) => !person.membership.member_level) },
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <BackLink href="/org-chart">{t("title")}</BackLink>
      <section
        className="relative overflow-hidden rounded-lg p-6 shadow-card sm:p-8"
        style={{
          background: `linear-gradient(135deg, ${colours.shade} 0%, ${colours.color} 80%)`,
          color: colours.foreground,
        }}
      >
        {colours.car ? (
          <Image
            src={colours.car}
            alt=""
            width={1018}
            height={224}
            className="pointer-events-none absolute -end-8 bottom-2 hidden w-[48%] object-contain md:block rtl:-scale-x-100"
          />
        ) : null}
        <div className="relative max-w-xl space-y-3">
          <p className="text-2xs font-bold tracking-[0.2em] uppercase opacity-80">
            {t("unitEyebrow", { type: t(`types.${node.unit.type}`), team: colours.team })}
          </p>
          <h1 className="font-display text-4xl leading-tight font-extrabold tracking-wide uppercase">
            <bdi>{node.unit.name}</bdi>
          </h1>
          {node.unit.description ? (
            <p dir="auto" className="text-sm whitespace-pre-line opacity-90">
              {node.unit.description}
            </p>
          ) : null}
          <p className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold">{node.total}</span>
            <span className="text-sm opacity-80">{t("membersShort")}</span>
          </p>
        </div>
      </section>

      {heads.length > 0 ? (
        <Card title={t("headsTitle")}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {heads.map(({ member, membership }) => (
              <li key={member.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
                <Avatar firstName={member.first_name} lastName={member.last_name} seed={member.id} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-navy">
                    {member.first_name} {member.last_name}
                  </span>
                  <bdi className="block truncate text-xs text-muted">{membership.role.name}</bdi>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={t("membersTitle", { count: rest.length, shown: String(rest.length) })}>
        {rest.length === 0 ? (
          <p className="text-sm text-muted">{t("noMembers")}</p>
        ) : (
          <div className="space-y-5">
            {groups
              .filter((group) => group.people.length > 0)
              .map((group) => (
                <section key={group.key} aria-label={t(`level.${group.key}`)} className="space-y-2">
                  <h3 className="eyebrow" style={{ color: colours.text }}>
                    {t(`level.${group.key}`)} · {group.people.length}
                  </h3>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {group.people.map(({ member, membership }) => (
                      <li key={member.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
                        <Avatar firstName={member.first_name} lastName={member.last_name} seed={member.id} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-navy">
                            {member.first_name} {member.last_name}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            <bdi>{membership.role.name}</bdi>
                            {membership.org_unit.id !== node.unit.id ? (
                              <>
                                {" · "}
                                <bdi>{membership.org_unit.name}</bdi>
                              </>
                            ) : null}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </Card>

      <Card title={t("projectsTitle")}>
        {projectsError ? (
          <LoadError error={projectsError} />
        ) : !projects ? (
          <LinesPlaceholder lines={2} />
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted">{t("noProjects")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="block space-y-2 rounded-lg border border-line p-4 transition-colors hover:border-navy/30"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderKanban className="size-4 shrink-0 text-muted" aria-hidden="true" />
                      <span dir="auto" className="truncate font-display font-bold tracking-wide text-navy uppercase">
                        {project.name}
                      </span>
                    </span>
                    <ProjectHealthBadge health={project.health} />
                  </span>
                  <ProgressBar
                    done={progressOf(project)}
                    total={100}
                    label={t("projectProgress", { name: project.name })}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {node.children.length > 0 ? (
        <Card title={t("subUnitsTitle")}>
          <ul className="divide-y divide-line">
            {node.children.map((child) => (
              <li key={child.unit.id}>
                <Link href={`/org-chart/${child.unit.id}`} className="flex items-center gap-3 py-2.5 hover:text-racing">
                  <bdi className="min-w-0 flex-1 truncate font-medium text-ink">{child.unit.name}</bdi>
                  <span className="text-xs text-muted">
                    {t("total", { count: child.total, shown: String(child.total) })}
                  </span>
                  <ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
