"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import { useMembers, useOrgUnits } from "@/features/members/use-members";
import { errorText } from "@/lib/error-text";
import { MEETING_KINDS, createMeeting, updateMeeting, type MeetingDetail, type MeetingKind } from "./api";
import { fromLocalInput, textareaClass, toLocalInput } from "./meeting-parts";
import { refreshMeetings } from "./queries";

type MeetingFormProps = {
  /** The session to change; a new one when absent. */
  meeting?: MeetingDetail;
  onSaved: (meeting: MeetingDetail) => void;
  onCancel?: () => void;
};

/**
 * Schedule or change a session (the bureau). "Mandatory" is set before it starts, never after; once
 * it started, its times, unit and weight are locked (decision D-013).
 */
export function MeetingForm({ meeting, onSaved, onCancel }: MeetingFormProps) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const me = useMe();
  const members = useMembers();
  const units = useOrgUnits();
  const agendaId = useId();
  const started = meeting ? new Date(meeting.starts_at) <= new Date() : false;

  const [title, setTitle] = useState(meeting?.title ?? "");
  const [kind, setKind] = useState<MeetingKind>(meeting?.kind ?? "department");
  const [unit, setUnit] = useState(meeting?.org_unit ? String(meeting.org_unit.id) : "");
  const [starts, setStarts] = useState(toLocalInput(meeting?.starts_at));
  const [ends, setEnds] = useState(toLocalInput(meeting?.ends_at));
  const [location, setLocation] = useState(meeting?.location ?? "");
  const [agenda, setAgenda] = useState(meeting?.agenda ?? "");
  const [mandatory, setMandatory] = useState(meeting?.is_mandatory ?? false);
  const [critical, setCritical] = useState(meeting?.is_critical ?? false);
  const [organiser, setOrganiser] = useState(meeting ? String(meeting.organiser.id) : "");
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((member) => member.status !== "alumni")
        .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)),
    [members.data],
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        kind,
        location,
        agenda,
        ...(organiser ? { organiser_id: Number(organiser) } : {}),
        ...(started
          ? {}
          : {
              org_unit_id: unit ? Number(unit) : null,
              starts_at: fromLocalInput(starts),
              ends_at: fromLocalInput(ends),
              is_mandatory: mandatory,
              is_critical: critical,
            }),
      };
      return meeting
        ? updateMeeting(meeting.id, body)
        : createMeeting({ ...body, starts_at: fromLocalInput(starts), ends_at: fromLocalInput(ends) });
    },
    onSuccess: async (saved) => {
      await refreshMeetings(queryClient);
      onSaved(saved);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() && starts && ends) {
      save.mutate();
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {started ? <Alert tone="info">{t("lockedSinceStart")}</Alert> : null}
      <TextField
        label={t("titleLabel")}
        required
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("kindLabel")}
          value={kind}
          onChange={(event) => setKind(event.target.value as MeetingKind)}
        >
          {MEETING_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`kind.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("unitLabel")}
          value={unit}
          disabled={started}
          onChange={(event) => setUnit(event.target.value)}
        >
          <option value="">{t("wholeTeam")}</option>
          {(units.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t("startsLabel")}
          type="datetime-local"
          valueDir="ltr"
          required
          disabled={started}
          value={starts}
          onChange={(event) => setStarts(event.target.value)}
        />
        <TextField
          label={t("endsLabel")}
          type="datetime-local"
          valueDir="ltr"
          required
          disabled={started}
          min={starts || undefined}
          value={ends}
          onChange={(event) => setEnds(event.target.value)}
        />
        <TextField label={t("locationLabel")} value={location} onChange={(event) => setLocation(event.target.value)} />
        <SelectField
          label={t("organiserLabel")}
          value={organiser || String(me.data?.id ?? "")}
          onChange={(event) => setOrganiser(event.target.value)}
        >
          {people.map((member) => (
            <option key={member.id} value={member.id}>
              {member.first_name} {member.last_name}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={agendaId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("agendaLabel")}
        </label>
        <textarea
          id={agendaId}
          rows={4}
          value={agenda}
          onChange={(event) => setAgenda(event.target.value)}
          className={textareaClass}
        />
      </div>
      <fieldset className="space-y-2 rounded-xl border border-line p-4">
        <legend className="px-1 text-2xs font-semibold tracking-widest text-muted uppercase">
          {t("countsLegend")}
        </legend>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={mandatory}
            disabled={started}
            onChange={(event) => setMandatory(event.target.checked)}
          />
          <span>
            {t("mandatoryLabel")} <span className="block text-xs text-muted">{t("mandatoryHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={critical}
            disabled={started}
            onChange={(event) => setCritical(event.target.checked)}
          />
          <span>
            {t("criticalLabel")} <span className="block text-xs text-muted">{t("criticalHint")}</span>
          </span>
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={save.isPending} disabled={!title.trim() || !starts || !ends}>
          {meeting ? t("save") : t("scheduleConfirm")}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={save.isPending}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
