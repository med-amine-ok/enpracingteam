"use client";

import { CalendarPlus, MapPin, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import type { Meeting } from "./api";
import { AttendanceBadge, DateBlock, MeetingBadges, useWhen } from "./meeting-parts";
import { useMeetingRights, useMeetings } from "./queries";

/** The sessions of the viewer (all of them for the bureau): the coming ones, or the past ones. */
export function MeetingsPage() {
  const t = useTranslations("Meetings");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const meetings = useMeetings(when);
  const rights = useMeetingRights();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={tShell("groups.execution")} title={t("title")} description={t("intro")}>
        <div className="flex flex-wrap items-center gap-2">
          {rights.data?.decide_excuses ? (
            <Link href="/meetings/excuses" className={buttonClassName("secondary", "sm")}>
              {t("excusesLink")}
              {rights.data.pending_excuses > 0 ? <Badge tone="danger">{rights.data.pending_excuses}</Badge> : null}
            </Link>
          ) : null}
          {rights.data?.schedule ? (
            <Link href="/meetings/new" className={buttonClassName("primary", "sm")}>
              <CalendarPlus className="size-4" aria-hidden="true" />
              {t("schedule")}
            </Link>
          ) : null}
        </div>
      </PageHeader>
      <Segmented
        label={t("scopeLabel")}
        value={when}
        onChange={setWhen}
        options={[
          { value: "upcoming", label: t("upcoming") },
          { value: "past", label: t("past") },
        ]}
      />
      {meetings.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(meetings.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => meetings.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !meetings.data ? (
        <LinesPlaceholder lines={4} />
      ) : meetings.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
          {when === "upcoming" ? t("emptyUpcoming") : t("emptyPast")}
        </p>
      ) : (
        <ul className="space-y-3">
          {meetings.data.map((meeting) => (
            <MeetingRow key={meeting.id} meeting={meeting} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MeetingRow({ meeting }: { meeting: Meeting }) {
  const t = useTranslations("Meetings");
  const when = useWhen();
  const mine = meeting.my_attendance;
  return (
    <li>
      <Link
        href={`/meetings/${meeting.id}`}
        className="flex items-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-xs transition-colors hover:border-navy/30"
      >
        <DateBlock date={meeting.starts_at} />
        <span className="min-w-0 flex-1 space-y-1.5">
          <span dir="auto" className="block font-medium text-ink">
            {meeting.title}
          </span>
          <MeetingBadges meeting={meeting} />
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>{when(meeting.starts_at, meeting.ends_at)}</span>
            {meeting.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                <bdi>{meeting.location}</bdi>
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden="true" />
              <bdi>{meeting.org_unit?.name ?? t("wholeTeam")}</bdi>
            </span>
          </span>
        </span>
        {mine ? <AttendanceBadge status={mine.status} excuse={mine.excuse_status} /> : null}
      </Link>
    </li>
  );
}
