"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Hand, MapPin, Pencil, UserRound, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { errorText } from "@/lib/error-text";
import { EXCUSE_REASONS, askExcuse, cancelMeeting, checkIn, type ExcuseReason, type MeetingDetail } from "./api";
import { MeetingAttendance } from "./meeting-attendance";
import { MeetingForm } from "./meeting-form";
import { MeetingMinutes } from "./meeting-minutes";
import { AttendanceBadge, MeetingBadges, textareaClass, useWhen } from "./meeting-parts";
import { meetingKeys, refreshMeetings, useMeeting } from "./queries";

/** A session: when and where, the viewer's attendance, and for who runs it, the list and the minutes. */
export function MeetingView() {
  const tErrors = useTranslations("Errors");
  const t = useTranslations("Meetings");
  const { id } = useParams<{ id: string }>();
  const meeting = useMeeting(Number(id));
  const [editing, setEditing] = useState(false);

  if (meeting.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert tone="error">{errorText(meeting.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!meeting.data) {
    return (
      <div className="mx-auto max-w-4xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      </div>
    );
  }
  const data = meeting.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/meetings">{t("title")}</BackLink>
      {editing ? (
        <Card title={t("editTitle")}>
          <MeetingForm meeting={data} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
        </Card>
      ) : (
        <MeetingSummary meeting={data} onEdit={() => setEditing(true)} />
      )}
      {data.my_attendance ? <MyAttendance meeting={data} /> : null}
      {data.permissions.run || data.attendances.length > 1 ? <MeetingAttendance meeting={data} /> : null}
      <MeetingMinutes meeting={data} />
    </div>
  );
}

function MeetingSummary({ meeting, onEdit }: { meeting: MeetingDetail; onEdit: () => void }) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const when = useWhen();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () => cancelMeeting(meeting.id, reason.trim()),
    onSuccess: async (saved) => {
      queryClient.setQueryData(meetingKeys.detail(meeting.id), saved);
      setCancelling(false);
      await refreshMeetings(queryClient);
    },
  });
  const counts = meeting.counts;

  return (
    <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <MeetingBadges meeting={meeting} />
          <h1 dir="auto" className="text-2xl font-semibold tracking-tight text-ink rtl:text-right">
            {meeting.title}
          </h1>
        </div>
        {meeting.permissions.edit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("edit")}
            </Button>
            {!cancelling ? (
              <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
                <Ban className="size-4" aria-hidden="true" />
                {t("cancelMeeting")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {cancel.isError ? <Alert tone="error">{errorText(cancel.error, tErrors)}</Alert> : null}
      {cancelling ? (
        <form
          className="space-y-3 rounded-lg border border-line bg-canvas p-4"
          onSubmit={(event) => {
            event.preventDefault();
            cancel.mutate();
          }}
        >
          <label htmlFor={reasonId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("cancelReason")}
          </label>
          <textarea
            id={reasonId}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={textareaClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={cancel.isPending}>
              {t("cancelConfirm")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCancelling(false)}>
              {t("back")}
            </Button>
          </div>
        </form>
      ) : null}
      {meeting.status === "cancelled" ? (
        <Alert tone="warning">
          {meeting.cancel_reason ? t("cancelledBecause", { reason: meeting.cancel_reason }) : t("cancelledNotice")}
        </Alert>
      ) : null}
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <Detail label={t("whenLabel")}>{when(meeting.starts_at, meeting.ends_at)}</Detail>
        <Detail label={t("locationLabel")} icon={<MapPin className="size-4" aria-hidden="true" />}>
          {meeting.location || t("noLocation")}
        </Detail>
        <Detail label={t("unitLabel")} icon={<Users className="size-4" aria-hidden="true" />}>
          {meeting.org_unit?.name ?? t("wholeTeam")}
        </Detail>
        <Detail label={t("organiserLabel")} icon={<UserRound className="size-4" aria-hidden="true" />}>
          {meeting.organiser.first_name} {meeting.organiser.last_name}
        </Detail>
        <Detail label={t("countsLabel")}>
          {t("countsText", {
            invited: String(counts.invited),
            present: String(counts.present),
            late: String(counts.late),
            absent: String(counts.absent),
            excused: String(counts.excused),
          })}
        </Detail>
      </dl>
      {meeting.agenda ? (
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-ink">{t("agendaLabel")}</h2>
          <p dir="auto" className="text-sm whitespace-pre-line text-ink">
            {meeting.agenda}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Detail({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd dir="auto" className="flex items-center gap-1.5 text-ink">
        {icon}
        <span>{children}</span>
      </dd>
    </div>
  );
}

/** « Je suis là », the viewer's attendance, and asking for an excuse (the Team Manager decides). */
function MyAttendance({ meeting }: { meeting: MeetingDetail }) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const noteId = useId();
  const mine = meeting.my_attendance!;
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<ExcuseReason>("exam");
  const [note, setNote] = useState("");
  const onSaved = async (saved: MeetingDetail) => {
    queryClient.setQueryData(meetingKeys.detail(meeting.id), saved);
    setAsking(false);
    await refreshMeetings(queryClient);
  };
  const present = useMutation({ mutationFn: () => checkIn(meeting.id), onSuccess: onSaved });
  const excuse = useMutation({ mutationFn: () => askExcuse(meeting.id, reason, note.trim()), onSuccess: onSaved });
  const error = present.error ?? excuse.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    excuse.mutate();
  }

  return (
    <Card title={t("myAttendanceTitle")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <AttendanceBadge status={mine.status} excuse={mine.excuse_status} />
          {mine.checked_in_at ? (
            <span className="text-sm text-muted">
              {t("checkedInAt", {
                time: format.dateTime(new Date(mine.checked_in_at), {
                  hour: "2-digit",
                  minute: "2-digit",
                  numberingSystem: "latn",
                }),
              })}
            </span>
          ) : null}
        </div>
        {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
        <div className="flex flex-wrap items-center gap-3">
          {meeting.permissions.check_in ? (
            <Button onClick={() => present.mutate()} loading={present.isPending}>
              <Hand className="size-4" aria-hidden="true" />
              {t("checkIn")}
            </Button>
          ) : null}
          {meeting.permissions.ask_excuse && !asking ? (
            <Button variant="secondary" onClick={() => setAsking(true)}>
              {mine.excuse_status === "requested" ? t("changeExcuse") : t("askExcuse")}
            </Button>
          ) : null}
        </div>
        {meeting.permissions.check_in ? <p className="text-xs text-muted">{t("checkInHint")}</p> : null}
        {asking ? (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-canvas p-4">
            <h3 className="text-sm font-semibold text-ink">{t("askExcuse")}</h3>
            <SelectField
              label={t("reasonLabel")}
              value={reason}
              onChange={(event) => setReason(event.target.value as ExcuseReason)}
            >
              {EXCUSE_REASONS.map((value) => (
                <option key={value} value={value}>
                  {t(`reason.${value}`)}
                </option>
              ))}
            </SelectField>
            <div className="space-y-1.5">
              <label htmlFor={noteId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
                {t("noteLabel")}
              </label>
              <textarea
                id={noteId}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={textareaClass}
              />
            </div>
            <p className="text-xs text-muted">{t("excuseHint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={excuse.isPending}>
                {t("sendExcuse")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
                {t("back")}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
