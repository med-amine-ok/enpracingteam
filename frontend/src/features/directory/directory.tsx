"use client";

import {
  Briefcase,
  ClipboardList,
  FolderKanban,
  LayoutGrid,
  Link2,
  List,
  Mail,
  Phone,
  Search,
  UserPlus,
  UserRoundSearch,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useDeferredValue, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import { useFollowedMembers, useLeads } from "@/features/engagement/queries";
import type { Member, OrgUnit } from "@/features/members/api";
import { MembershipBadges, StatusBadge } from "@/features/members/member-badges";
import { currentMemberships } from "@/features/members/memberships";
import { filterMembers, type StatusFilter } from "@/features/members/search";
import { useMemberAdding, useMembers, useOrgUnits, useUnitLivery } from "@/features/members/use-members";
import { Link } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { safeWebUrl, telHref } from "@/lib/links";
import { cn } from "@/lib/utils";

const STATUSES: StatusFilter[] = ["active", "on_leave", "alumni", "all"];

/** Every member of the team, as the Figma's driver cards (or a list): search, filter by unit and status, contact. */
export function Directory() {
  const t = useTranslations("Directory");
  const tMember = useTranslations("Member");
  const tErrors = useTranslations("Errors");
  const members = useMembers();
  const units = useOrgUnits();
  const me = useMe();
  const followed = useFollowedMembers(useLeads());
  const adding = useMemberAdding();
  // The full sheet: one's own, and those of the members one heads (everyone for the Team Manager and the Bureau).
  const sheets = useMemo(
    () => new Set([...(followed.data ?? []).map((member) => member.id), ...(me.data ? [me.data.id] : [])]),
    [followed.data, me.data],
  );
  const [query, setQuery] = useState("");
  const [unitId, setUnitId] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [view, setView] = useState<"grid" | "list">("grid");
  // Typing stays fluid: the list follows a moment later.
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(
    () =>
      members.data ? filterMembers(members.data, { query: deferredQuery, unitId, status }, clubToday(new Date())) : [],
    [members.data, deferredQuery, unitId, status],
  );
  const sortedUnits = useMemo(
    () => [...(units.data ?? [])].filter((unit) => unit.is_active !== false).sort(byName),
    [units.data],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("intro")}>
        {adding.data?.can_add ? (
          <Link href="/directory/new" className={buttonClassName("primary", "md")}>
            <UserPlus className="size-4" aria-hidden="true" />
            {t("addMember")}
          </Link>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 shadow-card sm:grid-cols-2 sm:p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <div className="sm:col-span-2 lg:col-span-1">
          <TextField
            label={t("searchLabel")}
            type="search"
            icon={<Search />}
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SelectField
          label={t("unitLabel")}
          value={unitId ?? ""}
          onChange={(event) => setUnitId(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">{t("allUnits")}</option>
          {sortedUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("statusLabel")}
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
        >
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value === "all" ? t("allStatuses") : tMember(`statuses.${value}`)}
            </option>
          ))}
        </SelectField>
        <div role="group" aria-label={t("view")} className="flex h-11 border border-line">
          {(
            [
              ["grid", LayoutGrid, t("viewGrid")],
              ["list", List, t("viewList")],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              aria-label={label}
              title={label}
              onClick={() => setView(value)}
              className={cn(
                "grid w-11 place-items-center transition-colors",
                view === value ? "bg-navy text-white" : "bg-surface text-muted hover:text-ink",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {members.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(members.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => members.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !members.data ? (
        <CardsPlaceholder />
      ) : (
        <>
          <p role="status" className="eyebrow">
            {t("count", { count: results.length, shown: String(results.length) })}
          </p>
          {results.length === 0 ? (
            <div className="grid place-items-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center">
              <UserRoundSearch className="size-8 text-muted" aria-hidden="true" />
              <p className="font-medium text-ink">{t("emptyTitle")}</p>
              <p className="text-sm text-muted">{t("emptyHint")}</p>
            </div>
          ) : view === "grid" ? (
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((member) => (
                <DriverCard key={member.id} member={member} sheet={sheets.has(member.id)} />
              ))}
            </ul>
          ) : (
            <MemberTable members={results} sheets={sheets} />
          )}
        </>
      )}
    </div>
  );
}

/** A member as the Figma's driver card: their department's livery, its team's car and logo, then how to reach them. */
function DriverCard({ member, sheet }: { member: Member; sheet: boolean }) {
  const unitLivery = useUnitLivery();
  const t = useTranslations("Directory");
  const [primary, ...others] = currentMemberships(member.memberships, clubToday(new Date()));
  const colours = unitLivery(primary?.org_unit.code);
  const name = `${member.first_name} ${member.last_name}`;
  const skills = member.skill
    ? member.skill
        .split(/[,;\n]/)
        .map((skill) => skill.trim())
        .filter(Boolean)
        .slice(0, 2)
    : [];

  return (
    <li className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover">
      <div
        className="relative h-44 overflow-hidden p-4"
        style={
          {
            background: `linear-gradient(105deg, ${colours.shade} 8%, ${colours.color} 100%)`,
            color: colours.foreground,
          } as CSSProperties
        }
      >
        <Image
          src="/racing/speed-pattern.webp"
          alt=""
          width={1282}
          height={632}
          className="pointer-events-none absolute -start-6 top-1/2 h-[124%] w-auto max-w-none -translate-y-1/2 opacity-20"
        />
        {colours.car ? (
          <Image
            src={colours.car}
            alt=""
            width={1018}
            height={224}
            className="pointer-events-none absolute start-3 -bottom-1 w-[74%] object-contain opacity-30 transition-all duration-300 group-hover:translate-x-2 group-hover:opacity-45"
          />
        ) : null}
        <svg
          viewBox="0 0 100 140"
          className="pointer-events-none absolute end-3 -bottom-12 h-48 w-32 fill-current opacity-30 transition-transform duration-300 group-hover:scale-105"
          aria-hidden="true"
        >
          <circle cx="50" cy="28" r="20" />
          <path d="M9 140c1-45 9-72 25-82 5-3 10-5 16-5s11 2 16 5c16 10 24 37 25 82H9Z" />
        </svg>
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl leading-6">
              <span className="block truncate font-normal underline decoration-1 underline-offset-4">
                {member.first_name}
              </span>{" "}
              <span className="block truncate font-semibold underline decoration-1 underline-offset-4">
                {member.last_name}
              </span>
            </h2>
            <p className="mt-1 text-sm font-semibold">{colours.team}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className="grid size-10 place-items-center rounded-full p-1.5"
              style={{ background: colours.shade }}
              aria-hidden="true"
            >
              <Image src={colours.logo} alt="" width={48} height={48} className="size-full object-contain" />
            </span>
            {member.race_number ? (
              <p className="font-display text-3xl leading-none font-bold">
                <span className="sr-only">{t("raceNumber")} </span>
                {member.race_number}
              </p>
            ) : null}
          </div>
        </div>
        <div className="absolute start-4 bottom-4 z-10 max-w-[64%] space-y-1.5">
          <p className="truncate font-display text-base leading-tight font-bold">
            {primary ? <bdi>{primary.role.name}</bdi> : t("noUnit")}
          </p>
          {skills.length ? (
            <p className="flex flex-wrap gap-1.5">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-sm border border-current/40 px-2 py-0.5 text-2xs font-bold tracking-wider uppercase"
                >
                  {skill}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          {primary ? (
            <p className="min-w-0 truncate text-sm text-muted">
              {primary.role.name} · {primary.org_unit.name}
            </p>
          ) : (
            <p className="text-sm text-muted">{t("noUnit")}</p>
          )}
          {member.status && member.status !== "active" ? <StatusBadge status={member.status} /> : null}
        </div>
        {member.alumni_profile ? <AlumniLine profile={member.alumni_profile} /> : null}
        {primary ? (
          <div className="flex flex-wrap gap-2">
            <MembershipBadges membership={primary} />
            {others.map((membership) => (
              <span key={membership.id} className="rounded-full bg-canvas px-2.5 py-0.5 text-xs text-muted">
                {/* A position in the club (decision D-025): its role says it (President...); elsewhere, the unit. */}
                <bdi>
                  {membership.org_unit.type === "governing_body" ? membership.role.name : membership.org_unit.name}
                </bdi>
              </span>
            ))}
          </div>
        ) : null}
        {member.projects.length ? (
          <ul className="flex flex-wrap gap-2" aria-label={t("projectsOf", { name })}>
            {member.projects.map((project) => (
              <li
                key={project.id}
                className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs text-ink"
              >
                <FolderKanban className="size-3 text-muted" aria-hidden="true" />
                <bdi>{project.name}</bdi>
                {project.manages ? <span className="text-muted">· {t("projectManager")}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <ContactLinks member={member} name={name} sheet={sheet} />
      </div>
    </li>
  );
}

function AlumniLine({ profile }: { profile: NonNullable<Member["alumni_profile"]> }) {
  const t = useTranslations("Directory");
  const work = [profile.current_position, profile.current_company].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
      {work ? (
        <p className="flex min-w-0 items-center gap-1.5">
          <Briefcase className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
          <bdi className="truncate">{work}</bdi>
        </p>
      ) : null}
      {profile.willing_to_mentor ? <Badge tone="success">{t("mentor")}</Badge> : null}
    </div>
  );
}

function ContactLinks({ member, name, sheet }: { member: Member; name: string; sheet: boolean }) {
  const t = useTranslations("Directory");
  const phone = telHref(member.phone);
  const facebook = safeWebUrl(member.facebook_url);
  return (
    <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
      <ContactLink
        href={`mailto:${member.email}`}
        icon={<Mail />}
        label={t("emailMember", { name })}
        text={t("email")}
      />
      {phone ? <ContactLink href={phone} icon={<Phone />} label={t("callMember", { name })} text={t("call")} /> : null}
      {facebook ? (
        <ContactLink href={facebook} icon={<Link2 />} label={t("facebookMember", { name })} text="Facebook" external />
      ) : null}
      {sheet ? (
        <Link
          href={`/members/${member.id}`}
          aria-label={t("sheetOf", { name })}
          title={t("sheetOf", { name })}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-2xs font-bold tracking-wider text-ink uppercase transition-colors hover:border-racing hover:text-racing"
        >
          <ClipboardList className="size-3.5" aria-hidden="true" />
          {t("sheet")}
        </Link>
      ) : null}
    </div>
  );
}

/** The Figma's list view: one line per member, their department's colour on the role. */
function MemberTable({ members, sheets }: { members: Member[]; sheets: Set<number> }) {
  const unitLivery = useUnitLivery();
  const t = useTranslations("Directory");
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full min-w-[720px] text-start">
        <thead>
          <tr className="border-b border-line bg-canvas">
            {[t("columnNumber"), t("columnName"), t("columnRole"), t("columnUnit"), t("columnStatus"), ""].map(
              (label, index) => (
                <th
                  key={index}
                  className="px-4 py-3 text-start text-2xs font-semibold tracking-widest text-muted uppercase"
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const [primary] = currentMemberships(member.memberships, clubToday(new Date()));
            const colours = unitLivery(primary?.org_unit.code);
            const name = `${member.first_name} ${member.last_name}`;
            return (
              <tr key={member.id} className="border-b border-line last:border-0 hover:bg-canvas">
                <td className="px-4 py-3 font-display text-sm font-bold" style={{ color: colours.text }}>
                  {member.race_number ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span className="font-display font-light text-muted">{member.first_name} </span>
                  <span className="font-display font-bold text-navy uppercase">{member.last_name}</span>
                </td>
                <td className="px-4 py-3 text-sm text-muted">{primary ? <bdi>{primary.role.name}</bdi> : "—"}</td>
                <td className="px-4 py-3">
                  <span className="text-xs font-semibold tracking-wide" style={{ color: colours.text }}>
                    {primary ? <bdi>{primary.org_unit.name}</bdi> : t("noUnit")}
                  </span>
                </td>
                <td className="px-4 py-3">{member.status ? <StatusBadge status={member.status} /> : null}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <ContactLink
                      href={`mailto:${member.email}`}
                      icon={<Mail />}
                      label={t("emailMember", { name })}
                      text={t("email")}
                    />
                    {sheets.has(member.id) ? (
                      <Link
                        href={`/members/${member.id}`}
                        aria-label={t("sheetOf", { name })}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-2xs font-bold tracking-wider text-ink uppercase hover:border-racing hover:text-racing"
                      >
                        <ClipboardList className="size-3.5" aria-hidden="true" />
                        {t("sheet")}
                      </Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type ContactLinkProps = { href: string; icon: ReactNode; label: string; text: string; external?: boolean };

function ContactLink({ href, icon, label, text, external }: ContactLinkProps) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-2xs font-bold tracking-wider text-ink uppercase transition-colors hover:border-racing hover:text-racing [&>svg]:size-3.5"
    >
      {icon}
      {text}
    </a>
  );
}

function CardsPlaceholder() {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="h-72 animate-pulse rounded-lg border border-line bg-surface" />
      ))}
    </ul>
  );
}

function byName(a: OrgUnit, b: OrgUnit) {
  return a.name.localeCompare(b.name);
}
