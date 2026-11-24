"use client";

import { Link } from "@/i18n/navigation";
import { ChevronDown, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useId, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useMembers, useOrgUnits, useUnitLivery } from "@/features/members/use-members";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { buildOrgChart, type UnitNode, type UnitPerson } from "./tree";

/** The organisation of the team: every unit, its leaders and its members. */
export function OrgChart() {
  const t = useTranslations("OrgChart");
  const tErrors = useTranslations("Errors");
  const members = useMembers();
  const units = useOrgUnits();
  const tree = useMemo(
    () => (members.data && units.data ? buildOrgChart(units.data, members.data, clubToday(new Date())) : null),
    [members.data, units.data],
  );
  const error = members.error ?? units.error;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("intro")} />
      {error ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(error, tErrors)}</Alert>
          <Button
            variant="secondary"
            onClick={() => {
              members.refetch();
              units.refetch();
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : !tree ? (
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </div>
      ) : (
        <>
          <Departments nodes={departmentsOf(tree)} />
          <ul className="space-y-4">
            {tree.map((node) => (
              <UnitBranch key={node.unit.id} node={node} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The club's departments, in the tree's order. */
function departmentsOf(nodes: UnitNode[]): UnitNode[] {
  return nodes.flatMap((node) => [
    ...(node.unit.type === "club_department" ? [node] : []),
    ...departmentsOf(node.children),
  ]);
}

/** The Figma's "écuries départementales": each department in its Formula 1 livery, leading to its branch below. */
function Departments({ nodes }: { nodes: UnitNode[] }) {
  const unitLivery = useUnitLivery();
  const t = useTranslations("OrgChart");
  if (nodes.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="departments-title" className="space-y-4">
      <div>
        <p className="eyebrow">{t("departmentsEyebrow")}</p>
        <h2
          id="departments-title"
          className="mt-0.5 font-display text-xl font-extrabold tracking-wide text-navy uppercase"
        >
          {t("departmentsTitle")}
        </h2>
      </div>
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {nodes.map((node) => {
          const colours = unitLivery(node.unit.code);
          const leader = node.people.find((person) => person.membership.role.is_leadership);
          return (
            <li key={node.unit.id}>
              <Link
                href={`/org-chart/${node.unit.id}`}
                className="group relative block min-h-44 overflow-hidden rounded-lg p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
                style={{
                  background: `linear-gradient(135deg, ${colours.shade} 0%, ${colours.color} 78%)`,
                  color: colours.foreground,
                }}
              >
                <Image
                  src="/racing/drs-pattern.webp"
                  alt=""
                  width={1200}
                  height={197}
                  className="pointer-events-none absolute end-0 -bottom-2 h-28 w-auto max-w-none opacity-25"
                />
                {colours.car ? (
                  <Image
                    src={colours.car}
                    alt=""
                    width={1018}
                    height={224}
                    className="pointer-events-none absolute start-4 bottom-6 w-[66%] object-contain transition-transform duration-300 group-hover:translate-x-2"
                  />
                ) : null}
                <span className="relative z-10 flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <bdi className="block text-lg leading-6 font-semibold underline-offset-4 group-hover:underline">
                      {node.unit.name}
                    </bdi>
                    <span className="mt-1 block text-xs font-bold tracking-wider uppercase opacity-70">
                      {colours.team}
                    </span>
                    {leader ? (
                      <span className="mt-2 block text-xs opacity-85">
                        {leader.member.first_name} {leader.member.last_name}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-full p-1.5"
                    style={{ background: colours.shade }}
                    aria-hidden="true"
                  >
                    <Image src={colours.logo} alt="" width={48} height={48} className="size-full object-contain" />
                  </span>
                </span>
                <span className="absolute end-4 bottom-3 z-20 rounded-md bg-black/20 px-3 py-1 text-end backdrop-blur-sm">
                  <span className="block font-display text-xl leading-none font-bold">{node.total}</span>
                  <span className="block text-2xs font-semibold tracking-widest uppercase opacity-70">
                    {t("membersShort")}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function UnitBranch({ node }: { node: UnitNode }) {
  const unitLivery = useUnitLivery();
  const t = useTranslations("OrgChart");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const leaders = node.people.filter((person) => person.membership.role.is_leadership);
  // The leaders are already shown: the list only adds the others.
  const others = node.people.filter((person) => !person.membership.role.is_leadership);
  const isRoot = node.unit.type === "root";
  const colours = unitLivery(node.unit.code);

  return (
    <li id={`unit-${node.unit.id}`} className="scroll-mt-24">
      <div
        className={cn(
          "rounded-lg border bg-surface p-4 shadow-card sm:p-5",
          isRoot ? "border-navy/20 bg-navy text-white" : "border-s-4 border-line",
        )}
        style={isRoot ? undefined : { borderInlineStartColor: colours.color }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className={cn(
                "text-xs font-semibold uppercase ltr:tracking-wide",
                isRoot ? "text-white/60" : "text-racing",
              )}
            >
              {t(`types.${node.unit.type}`)}
            </p>
            {/* Unit names are data, shown as saved in the ERP. */}
            <h2
              className={cn(
                "font-display text-lg font-bold tracking-wide uppercase",
                isRoot ? "text-white" : "text-navy",
              )}
            >
              {node.unit.name}
            </h2>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              isRoot ? "bg-white/10 text-white" : "bg-canvas text-muted",
            )}
          >
            <Users className="size-3.5" aria-hidden="true" />
            {t("total", { count: node.total, shown: String(node.total) })}
          </span>
        </div>

        {leaders.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label={t("leaders")}>
            {leaders.map((person) => (
              <PersonChip key={person.membership.id} person={person} />
            ))}
          </ul>
        ) : null}

        {others.length > 0 ? (
          <div className="mt-3">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-navy hover:underline"
            >
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
              {open
                ? t("hideMembers")
                : t(leaders.length > 0 ? "showOthers" : "showMembers", { shown: String(others.length) })}
            </button>
            {open ? (
              <ul id={listId} className="mt-3 grid gap-2 sm:grid-cols-2">
                {others.map((person) => (
                  <li key={person.membership.id} className="flex items-center gap-3 rounded-lg bg-canvas px-3 py-2">
                    <Avatar
                      firstName={person.member.first_name}
                      lastName={person.member.last_name}
                      seed={person.member.id}
                      size="sm"
                    />
                    <span className="min-w-0 text-sm leading-tight">
                      <span className="block truncate font-medium text-ink">
                        {person.member.first_name} {person.member.last_name}
                      </span>
                      <span className="block truncate text-xs text-muted">{person.membership.role.name}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {node.children.length > 0 ? (
        <ul className="ms-3 mt-4 space-y-4 border-s-2 border-line ps-4 sm:ms-6 sm:ps-6">
          {node.children.map((child) => (
            <UnitBranch key={child.unit.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PersonChip({ person }: { person: UnitPerson }) {
  return (
    <li className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 ps-1 pe-3">
      <Avatar
        firstName={person.member.first_name}
        lastName={person.member.last_name}
        seed={person.member.id}
        size="sm"
      />
      <span className="min-w-0 text-xs leading-tight">
        <span className="block font-medium text-ink">
          {person.member.first_name} {person.member.last_name}
        </span>
        <span className="block text-muted">{person.membership.role.name}</span>
      </span>
    </li>
  );
}
