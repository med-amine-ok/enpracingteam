"use client";

import { ClipboardList, Link2, Mail, Phone, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { Me } from "@/features/auth/api";
import { useMe } from "@/features/auth/use-me";
import type { Membership } from "@/features/members/api";
import { MembershipBadges, StatusBadge } from "@/features/members/member-badges";
import { currentMemberships, pastMemberships } from "@/features/members/memberships";
import { clubToday } from "@/lib/dates";
import { Link } from "@/i18n/navigation";
import { safeWebUrl, telHref } from "@/lib/links";
import { AlumniPreference } from "./alumni-preference";
import { LanguagePreference } from "./language-preference";
import { EmailPreference } from "./email-preference";
import { RaceNumberPreference } from "./race-number";
import { StudyPreference } from "./study-preference";
import { PresenceCard } from "@/features/meetings/presence-card";
import { buttonClassName } from "@/components/ui/button";

export function ProfileView() {
  const t = useTranslations("Profile");
  const { data: member } = useMe();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t("title")} description={t("intro")} />
      {member ? (
        <ProfileContent member={member} />
      ) : (
        <Card>
          <LinesPlaceholder lines={3} />
        </Card>
      )}
    </div>
  );
}

// Drawn only in the browser, once the API has answered: "today" is never frozen at build time.
function ProfileContent({ member }: { member: Me }) {
  const t = useTranslations("Profile");
  const format = useFormatter();
  const today = clubToday(new Date());
  const current = currentMemberships(member.memberships, today);
  const past = pastMemberships(member.memberships, today);
  const phone = telHref(member.phone);
  const facebook = safeWebUrl(member.facebook_url);
  // Latin digits, as written in Algeria, also on Arabic pages.
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "long", numberingSystem: "latn" });

  return (
    <>
      <section className="flex flex-wrap items-center gap-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <Avatar firstName={member.first_name} lastName={member.last_name} seed={member.id} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-ink">
              {member.first_name} {member.last_name}
            </h2>
            <StatusBadge status={member.status} />
          </div>
          <p className="text-sm [overflow-wrap:anywhere] text-muted">
            <bdi>{member.email}</bdi>
          </p>
          {member.join_date ? (
            <p className="text-sm text-muted">{t("joined", { date: date(member.join_date) })}</p>
          ) : null}
        </div>
        <Link href={`/members/${member.id}`} className={buttonClassName("secondary", "sm")}>
          <ClipboardList className="size-4" aria-hidden="true" />
          {t("fullSheet")}
        </Link>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title={t("contactTitle")} description={t("contactNote")}>
          <dl className="space-y-4 text-sm">
            <Detail icon={<Mail />} label={t("email")}>
              <a href={`mailto:${member.email}`} className="text-navy underline-offset-2 hover:underline">
                <bdi className="[overflow-wrap:anywhere]">{member.email}</bdi>
              </a>
            </Detail>
            <Detail icon={<Phone />} label={t("phone")}>
              {phone ? (
                <a href={phone} dir="ltr" className="text-navy underline-offset-2 hover:underline">
                  {member.phone}
                </a>
              ) : (
                <NotProvided />
              )}
            </Detail>
            <Detail icon={<Link2 />} label={t("facebook")}>
              {facebook ? (
                <a
                  href={facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-navy underline-offset-2 hover:underline"
                >
                  {t("facebookOpen")}
                </a>
              ) : (
                <NotProvided />
              )}
            </Detail>
            <Detail icon={<Sparkles />} label={t("skills")}>
              {member.skill ? <span className="whitespace-pre-line">{member.skill}</span> : <NotProvided />}
            </Detail>
          </dl>
        </Card>
        <div className="space-y-6">
          <Card title={t("languageTitle")} description={t("languageNote")}>
            <LanguagePreference current={member.language ?? ""} />
          </Card>
          <Card title={t("studyTitle")} description={t("studyNote")}>
            <StudyPreference member={member} />
          </Card>
          <Card title={t("raceTitle")} description={t("raceNote")}>
            <RaceNumberPreference member={member} />
          </Card>
          <Card title={t("emailsTitle")} description={t("emailsNote")}>
            <EmailPreference member={member} />
          </Card>
        </div>
      </div>

      {member.status === "alumni" ? (
        <Card title={t("alumniTitle")} description={t("alumniNote")}>
          <AlumniPreference member={member} />
        </Card>
      ) : null}

      <Card title={t("membershipsTitle")}>
        {current.length === 0 ? (
          <p className="text-sm text-muted">{t("noMemberships")}</p>
        ) : (
          <MembershipList memberships={current} date={date} />
        )}
        {past.length > 0 ? (
          <>
            <h3 className="mt-6 mb-3 text-sm font-semibold text-muted">{t("pastMemberships")}</h3>
            <MembershipList memberships={past} date={date} />
          </>
        ) : null}
      </Card>
      <PresenceCard />
    </>
  );
}

function MembershipList({ memberships, date }: { memberships: Membership[]; date: (value: string) => string }) {
  const t = useTranslations("Profile");
  return (
    <ul className="divide-y divide-line">
      {memberships.map((membership) => (
        <li
          key={membership.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
        >
          {/* Unit and role names are data, shown as saved in the ERP. */}
          <div className="min-w-0">
            <p className="font-medium text-ink">{membership.org_unit.name}</p>
            <p className="text-sm text-muted">
              {membership.role.name}
              {membership.start_date ? (
                <>
                  {" · "}
                  {membership.end_date
                    ? t("period", { start: date(membership.start_date), end: date(membership.end_date) })
                    : t("since", { date: date(membership.start_date) })}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <MembershipBadges membership={membership} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-muted [&>svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 space-y-0.5">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="font-medium text-ink">{children}</dd>
      </div>
    </div>
  );
}

function NotProvided() {
  const t = useTranslations("Profile");
  return <span className="font-normal text-muted">{t("notProvided")}</span>;
}
