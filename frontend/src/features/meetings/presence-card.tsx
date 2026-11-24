"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { Link } from "@/i18n/navigation";
import { AttendanceBadge } from "./meeting-parts";
import { usePresence } from "./queries";

/** The member's presence score over the last 90 days (Ranking System §4) and their recent sessions. */
export function PresenceCard() {
  const t = useTranslations("Meetings");
  const format = useFormatter();
  const presence = usePresence();
  const data = presence.data;

  return (
    <Card title={t("presenceTitle")} description={t("presenceIntro")}>
      {presence.error ? (
        <LoadError error={presence.error} />
      ) : !data ? (
        <LinesPlaceholder lines={3} />
      ) : (
        <div className="space-y-4">
          <p className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-ink tabular-nums">
              {data.score === null
                ? "—"
                : format.number(data.score, { maximumFractionDigits: 1, numberingSystem: "latn" })}
            </span>
            <span className="text-sm text-muted">{data.score === null ? t("notCalculable") : t("outOf100")}</span>
          </p>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted">{t("noSessions")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.history.slice(0, 8).map((row) => (
                <li key={row.meeting.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <Link
                    href={`/meetings/${row.meeting.id}`}
                    dir="auto"
                    className="min-w-0 flex-1 text-sm font-medium text-ink hover:underline"
                  >
                    {row.meeting.title}
                  </Link>
                  <span className="text-xs text-muted">
                    {format.dateTime(new Date(row.meeting.starts_at), {
                      day: "numeric",
                      month: "short",
                      numberingSystem: "latn",
                    })}
                  </span>
                  <AttendanceBadge status={row.status} excuse={row.excuse_status} />
                  {row.counted ? null : <span className="text-xs text-muted">{t("notCounted")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
