"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, UserMinus, UserPlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { useMembers } from "@/features/members/use-members";
import { errorText } from "@/lib/error-text";
import {
  MARKS,
  addInvitee,
  confirmAttendance,
  removeInvitee,
  type Attendance,
  type Mark,
  type MeetingDetail,
} from "./api";
import { AttendanceBadge } from "./meeting-parts";
import { meetingKeys, refreshMeetings } from "./queries";

/** The mark proposed for a person: what their check-in or the organiser said, else absent. */
function proposed(row: Attendance): Mark {
  return row.status === "pending" ? "absent" : row.status;
}

/**
 * Who runs the session confirms the list once it has started: present, late (or left before
 * halfway), absent. Before its end they may add or take off a person.
 */
export function MeetingAttendance({ meeting }: { meeting: MeetingDetail }) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const members = useMembers();
  const [marks, setMarks] = useState<Record<number, Mark>>({});
  const [guest, setGuest] = useState("");
  const now = new Date();
  const started = new Date(meeting.starts_at) <= now;
  const over = new Date(meeting.ends_at) < now;
  const run = meeting.permissions.run;
  const invited = useMemo(() => new Set(meeting.attendances.map(({ member }) => member.id)), [meeting.attendances]);
  const others = useMemo(
    () =>
      (members.data ?? [])
        .filter((member) => member.status !== "alumni" && !invited.has(member.id))
        .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)),
    [members.data, invited],
  );

  const onSaved = async (saved: MeetingDetail) => {
    queryClient.setQueryData(meetingKeys.detail(meeting.id), saved);
    setMarks({});
    await refreshMeetings(queryClient);
  };
  const confirm = useMutation({
    mutationFn: () =>
      confirmAttendance(
        meeting.id,
        meeting.attendances.map((row) => ({ member_id: row.member.id, status: marks[row.member.id] ?? proposed(row) })),
      ),
    onSuccess: onSaved,
  });
  const add = useMutation({ mutationFn: () => addInvitee(meeting.id, Number(guest)), onSuccess: onSaved });
  const remove = useMutation({
    mutationFn: (member: number) => removeInvitee(meeting.id, member),
    onSuccess: () => refreshMeetings(queryClient),
  });
  const error = confirm.error ?? add.error ?? remove.error;
  const editable = run && started && meeting.status === "planned";

  return (
    <Card
      title={t("attendanceTitle", { count: meeting.attendances.length, shown: String(meeting.attendances.length) })}
      description={
        meeting.attendance_confirmed_at
          ? t("confirmedOn", {
              date: format.dateTime(new Date(meeting.attendance_confirmed_at), {
                dateStyle: "medium",
                timeStyle: "short",
                numberingSystem: "latn",
              }),
            })
          : run
            ? started
              ? t("toConfirm")
              : t("confirmAfterStart")
            : undefined
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
        <ul className="divide-y divide-line">
          {meeting.attendances.map((row) => {
            const name = `${row.member.first_name} ${row.member.last_name}`;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">{name}</span>
                {row.checked_in_at ? (
                  <span className="text-xs text-muted">
                    {t("checkedInAt", {
                      time: format.dateTime(new Date(row.checked_in_at), {
                        hour: "2-digit",
                        minute: "2-digit",
                        numberingSystem: "latn",
                      }),
                    })}
                  </span>
                ) : null}
                {row.excuse_status !== "none" ? (
                  <span className="text-xs text-muted">
                    {t(`reason.${row.excuse_reason || "exam"}`)}
                    {row.excuse_note ? ` · ${row.excuse_note}` : ""}
                  </span>
                ) : null}
                {editable && row.excuse_status !== "accepted" ? (
                  <select
                    aria-label={t("markOf", { name })}
                    value={marks[row.member.id] ?? proposed(row)}
                    onChange={(event) =>
                      setMarks((current) => ({ ...current, [row.member.id]: event.target.value as Mark }))
                    }
                    className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink focus:border-navy focus:outline-none"
                  >
                    {MARKS.map((mark) => (
                      <option key={mark} value={mark}>
                        {t(`attendance.${mark}`)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <AttendanceBadge status={row.status} excuse={row.excuse_status} />
                )}
                {run && !over && meeting.status === "planned" && !row.checked_in_at ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(row.member.id)}
                    aria-label={t("uninvite", { name })}
                  >
                    <UserMinus className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {editable ? (
          <Button onClick={() => confirm.mutate()} loading={confirm.isPending}>
            <CheckCheck className="size-4" aria-hidden="true" />
            {meeting.attendance_confirmed_at ? t("saveMarks") : t("confirmAttendance")}
          </Button>
        ) : null}
        {run && !over && meeting.status === "planned" ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (guest) {
                add.mutate();
                setGuest("");
              }
            }}
          >
            <div className="min-w-56 flex-1">
              <SelectField label={t("inviteLabel")} value={guest} onChange={(event) => setGuest(event.target.value)}>
                <option value="">{t("choosePerson")}</option>
                {others.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.first_name} {member.last_name}
                  </option>
                ))}
              </SelectField>
            </div>
            <Button type="submit" variant="secondary" disabled={!guest} loading={add.isPending}>
              <UserPlus className="size-4" aria-hidden="true" />
              {t("invite")}
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
