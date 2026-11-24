"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { decideExcuse, type ExcuseRow } from "./api";
import { textareaClass } from "./meeting-parts";
import { refreshMeetings, useExcuses, useMeetingRights } from "./queries";

/** The excuses awaiting the Team Manager: accepted, the absence leaves the presence score. */
export function ExcusesPage() {
  const t = useTranslations("Meetings");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const rights = useMeetingRights();
  const excuses = useExcuses(!!rights.data?.decide_excuses);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/meetings">{t("title")}</BackLink>
      <PageHeader eyebrow={tShell("groups.execution")} title={t("excusesTitle")} description={t("excusesIntro")} />
      {rights.data && !rights.data.decide_excuses ? (
        <Alert tone="info">{t("teamManagerOnly")}</Alert>
      ) : excuses.isError ? (
        <Alert tone="error">{errorText(excuses.error, tErrors)}</Alert>
      ) : !excuses.data ? (
        <LinesPlaceholder lines={3} />
      ) : excuses.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
          {t("noExcuses")}
        </p>
      ) : (
        <ul className="space-y-3">
          {excuses.data.map((row) => (
            <ExcuseItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ExcuseItem({ row }: { row: ExcuseRow }) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (accept: boolean) => decideExcuse(row.id, accept, accept ? "" : note.trim()),
    onSuccess: async () => {
      setRefusing(false);
      await refreshMeetings(queryClient);
    },
  });
  const name = `${row.member.first_name} ${row.member.last_name}`;

  return (
    <li className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium text-ink">{name}</p>
          <p className="text-sm text-muted">
            <Link href={`/meetings/${row.meeting.id}`} className="font-medium text-navy hover:underline">
              <bdi>{row.meeting.title}</bdi>
            </Link>
            {" · "}
            {format.dateTime(new Date(row.meeting.starts_at), {
              dateStyle: "medium",
              timeStyle: "short",
              numberingSystem: "latn",
            })}
          </p>
        </div>
        <span className="flex flex-wrap gap-1.5">
          <Badge tone="warning">{t(`reason.${row.excuse_reason || "exam"}`)}</Badge>
          {row.meeting.is_mandatory ? <Badge tone="danger">{t("mandatory")}</Badge> : null}
        </span>
      </div>
      {row.excuse_note ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {row.excuse_note}
        </p>
      ) : null}
      {decide.isError ? <Alert tone="error">{errorText(decide.error, tErrors)}</Alert> : null}
      {refusing ? (
        <form
          className="space-y-3 rounded-lg border border-line bg-canvas p-3"
          onSubmit={(event) => {
            event.preventDefault();
            decide.mutate(false);
          }}
        >
          <label htmlFor={noteId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("refuseReason")}
          </label>
          <textarea
            id={noteId}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={textareaClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!note.trim()} loading={decide.isPending}>
              {t("refuseConfirm")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRefusing(false)}>
              {t("back")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => decide.mutate(true)} loading={decide.isPending}>
            <Check className="size-4" aria-hidden="true" />
            {t("acceptExcuse")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRefusing(true)}>
            <X className="size-4" aria-hidden="true" />
            {t("refuseExcuse")}
          </Button>
        </div>
      )}
    </li>
  );
}
