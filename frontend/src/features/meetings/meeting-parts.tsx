"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { clubDateTime, fromClubDateTime } from "@/lib/dates";
import type { AttendanceStatus, ExcuseStatus, Meeting, MeetingKind } from "./api";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

const KIND_TONES: Record<MeetingKind, BadgeTone> = {
  department: "info",
  general: "strong",
  workshop: "neutral",
  training: "success",
  event: "warning",
  council: "danger",
};

const STATUS_TONES: Record<AttendanceStatus, BadgeTone> = {
  pending: "neutral",
  present: "success",
  late: "warning",
  absent: "danger",
};

export function KindBadge({ kind }: { kind: MeetingKind }) {
  const t = useTranslations("Meetings");
  return <Badge tone={KIND_TONES[kind]}>{t(`kind.${kind}`)}</Badge>;
}

/** Type, mandatory, critical, cancelled: what the session is, at a glance. */
export function MeetingBadges({
  meeting,
}: {
  meeting: Pick<Meeting, "kind" | "is_mandatory" | "is_critical" | "status">;
}) {
  const t = useTranslations("Meetings");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <KindBadge kind={meeting.kind} />
      {meeting.is_mandatory ? <Badge tone="danger">{t("mandatory")}</Badge> : null}
      {meeting.is_critical ? <Badge tone="strong">{t("critical")}</Badge> : null}
      {meeting.status === "cancelled" ? <Badge tone="neutral">{t("cancelled")}</Badge> : null}
    </span>
  );
}

/** A person's attendance: the organiser's mark (or their check-in), an accepted excuse first. */
export function AttendanceBadge({ status, excuse }: { status: AttendanceStatus; excuse: ExcuseStatus }) {
  const t = useTranslations("Meetings");
  if (excuse === "accepted") {
    return <Badge tone="info">{t("excused")}</Badge>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={STATUS_TONES[status]}>{t(`attendance.${status}`)}</Badge>
      {excuse === "requested" ? <Badge tone="warning">{t("excuseRequested")}</Badge> : null}
      {excuse === "refused" ? <Badge tone="neutral">{t("excuseRefused")}</Badge> : null}
    </span>
  );
}

/** "Tue 21 Oct, 18:00 – 19:30": the day once, the times in the reader's language. */
export function useWhen() {
  const format = useFormatter();
  return (starts: string, ends: string) => {
    const start = new Date(starts);
    const end = new Date(ends);
    const day = format.dateTime(start, { weekday: "short", day: "numeric", month: "short", numberingSystem: "latn" });
    const time = (value: Date) =>
      format.dateTime(value, { hour: "2-digit", minute: "2-digit", numberingSystem: "latn" });
    const sameDay = start.toDateString() === end.toDateString();
    const endText = sameDay
      ? time(end)
      : `${format.dateTime(end, { day: "numeric", month: "short", numberingSystem: "latn" })} ${time(end)}`;
    return `${day}, ${time(start)} – ${endText}`;
  };
}

/** The day of the month over its short month name, as on a calendar page. */
export function DateBlock({ date }: { date: string }) {
  const format = useFormatter();
  const value = new Date(date);
  return (
    <span
      className="flex w-12 shrink-0 flex-col items-center rounded-lg border border-line bg-canvas py-1.5 text-center"
      aria-hidden="true"
    >
      <span className="text-2xs font-medium text-racing uppercase">
        {format.dateTime(value, { month: "short", numberingSystem: "latn" })}
      </span>
      <span className="text-lg leading-tight font-semibold text-ink tabular-nums">
        {format.dateTime(value, { day: "numeric", numberingSystem: "latn" })}
      </span>
    </span>
  );
}

/**
 * A date-time field's value ("2026-10-21T18:00") from an API date-time, in the club's time zone
 * (Algiers), as every date of the app is shown: a member abroad types the club's time too.
 */
export function toLocalInput(value: string | null | undefined) {
  return value ? clubDateTime(new Date(value)) : "";
}

/** An API date-time from a date-time field's value (read in the club's time zone, Algiers). */
export function fromLocalInput(value: string) {
  return fromClubDateTime(value).toISOString();
}
