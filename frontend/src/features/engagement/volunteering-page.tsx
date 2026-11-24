"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, HandHeart, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import { useMembers } from "@/features/members/use-members";
import { Link } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import {
  VOLUNTEERING_KINDS,
  createVolunteering,
  deleteVolunteering,
  refuseVolunteering,
  validateVolunteering,
  type Volunteering,
  type VolunteeringKind,
} from "./api";
import {
  EngagementHeader,
  VolunteeringStatusBadge,
  panelClass,
  personName,
  textareaClass,
  useDay,
  useMonth,
} from "./engagement-parts";
import { refreshEngagement, useLeads, useMissingVolunteering, useVolunteering } from "./queries";

/** Charter art. 21: a day or a period of volunteering each month, recorded by its organiser, validated by a head. */
export function VolunteeringPage() {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const me = useMe();
  const leads = useLeads();
  const activities = useVolunteering();
  const [adding, setAdding] = useState(false);
  const toDecide = activities.data?.filter((activity) => activity.permissions.decide) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <EngagementHeader current="volunteering">
        {!adding ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("recordVolunteering")}
          </Button>
        ) : null}
      </EngagementHeader>
      <p className="text-sm text-muted">{t("volunteeringRule")}</p>
      {adding ? <VolunteeringForm onDone={() => setAdding(false)} /> : null}
      {activities.isError ? <Alert tone="error">{errorText(activities.error, tErrors)}</Alert> : null}
      {activities.data && me.data ? <MonthStatus activities={activities.data} memberId={me.data.id} /> : null}
      {toDecide.length > 0 ? (
        <Card title={t("toDecideTitle")} description={t("toDecideIntro")}>
          <ul className="space-y-3">
            {toDecide.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </ul>
        </Card>
      ) : null}
      {leads ? <MissingMembers /> : null}
      <Card title={t("activitiesTitle")}>
        {!activities.data ? (
          <LinesPlaceholder lines={3} />
        ) : activities.data.length === 0 ? (
          <p className="text-sm text-muted">{t("noActivities")}</p>
        ) : (
          <ul className="space-y-3">
            {activities.data
              .filter((activity) => !activity.permissions.decide)
              .map((activity) => (
                <ActivityRow key={activity.id} activity={activity} />
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** The members the viewer heads without a validated volunteering this month, each leading to their sheet. */
function MissingMembers() {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const missing = useMissingVolunteering();
  const month = useMonth();
  // Drawn once the viewer's rights are known, in the browser: "this month" is never frozen at build time.
  const thisMonth = clubToday(new Date()).slice(0, 7);
  return (
    <Card title={t("missingTitle", { month: month(thisMonth) })} description={t("missingIntro")}>
      {missing.isError ? (
        <Alert tone="error">{errorText(missing.error, tErrors)}</Alert>
      ) : !missing.data ? (
        <LinesPlaceholder lines={2} />
      ) : missing.data.length === 0 ? (
        <p className="text-sm text-muted">{t("nobodyMissing")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {missing.data.map((member) => (
            <li key={member.id}>
              <Link
                href={`/members/${member.id}`}
                className="inline-flex rounded-full border border-line px-3 py-1 text-sm text-ink hover:border-navy/30"
              >
                {personName(member)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Whether the viewer's volunteering of the month is validated, waiting, or still to do (drawn once loaded). */
function MonthStatus({ activities, memberId }: { activities: Volunteering[]; memberId: number }) {
  const t = useTranslations("Engagement");
  const monthName = useMonth();
  const month = clubToday(new Date()).slice(0, 7);
  const mine = activities.filter(
    (activity) =>
      activity.date.startsWith(month) &&
      (activity.organiser.id === memberId || activity.participants.some((person) => person.id === memberId)),
  );
  if (mine.some((activity) => activity.status === "validated")) {
    return <Alert tone="success">{t("monthDone", { month: monthName(month) })}</Alert>;
  }
  if (mine.some((activity) => activity.status === "proposed")) {
    return <Alert tone="info">{t("monthWaiting", { month: monthName(month) })}</Alert>;
  }
  return <Alert tone="warning">{t("monthMissing", { month: monthName(month) })}</Alert>;
}

function ActivityRow({ activity }: { activity: Volunteering }) {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const day = useDay();
  const noteId = useId();
  const [step, setStep] = useState<"refuse" | "delete" | null>(null);
  const [note, setNote] = useState("");
  const change = useMutation({
    mutationFn: async (action: "validate" | "refuse" | "delete") => {
      if (action === "validate") {
        await validateVolunteering(activity.id);
      } else if (action === "refuse") {
        await refuseVolunteering(activity.id, note.trim());
      } else {
        await deleteVolunteering(activity.id);
      }
    },
    onSuccess: async () => {
      setStep(null);
      await refreshEngagement(queryClient);
    },
  });
  const others = activity.participants.filter((person) => person.id !== activity.organiser.id);

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <HandHeart className="size-4 text-racing" aria-hidden="true" />
        <span dir="auto" className="font-medium text-ink">
          {activity.title}
        </span>
        <Badge tone="neutral">{t(`kind.${activity.kind}`)}</Badge>
        <VolunteeringStatusBadge status={activity.status} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          {day(activity.date)}
        </span>
        <span>{t("organisedBy", { name: personName(activity.organiser) })}</span>
        {others.length > 0 ? (
          <span>{t("withParticipants", { names: others.map((person) => personName(person)).join(", ") })}</span>
        ) : null}
      </p>
      {activity.description ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {activity.description}
        </p>
      ) : null}
      {activity.decision_note ? <Alert tone="info">{t("refusalNote", { note: activity.decision_note })}</Alert> : null}
      {change.isError ? <Alert tone="error">{errorText(change.error, tErrors)}</Alert> : null}
      {step === null && (activity.permissions.decide || activity.permissions.withdraw) ? (
        <div className="flex flex-wrap gap-2">
          {activity.permissions.decide ? (
            <>
              <Button size="sm" onClick={() => change.mutate("validate")} loading={change.isPending}>
                {t("validate")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setStep("refuse")}>
                {t("refuse")}
              </Button>
            </>
          ) : null}
          {activity.permissions.withdraw ? (
            <Button size="sm" variant="ghost" onClick={() => setStep("delete")}>
              {t("delete")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {step === "delete" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-racing/30 bg-racing-soft p-3">
          <p className="text-sm text-ink">{t("deleteWarning")}</p>
          <Button size="sm" onClick={() => change.mutate("delete")} loading={change.isPending}>
            {t("yesDelete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStep(null)}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}
      {step === "refuse" ? (
        <form
          className={panelClass}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            change.mutate("refuse");
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
            <Button type="submit" size="sm" disabled={!note.trim()} loading={change.isPending}>
              {t("confirmRefuse")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStep(null)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** The organiser records what was done, when, and who took part: it waits for a head's validation. */
export function VolunteeringForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const me = useMe();
  const members = useMembers();
  const descriptionId = useId();
  const today = clubToday(new Date());
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<VolunteeringKind>("workshop");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [participants, setParticipants] = useState<number[]>([]);
  const save = useMutation({
    mutationFn: () =>
      createVolunteering({
        title: title.trim(),
        kind,
        date,
        description: description.trim(),
        participant_ids: participants,
      }),
    onSuccess: async () => {
      await refreshEngagement(queryClient);
      onDone();
    },
  });
  const others = (members.data ?? []).filter((member) => member.id !== me.data?.id);
  const query = search.trim().toLowerCase();
  const shown = others.filter(
    (member) => participants.includes(member.id) || (query !== "" && personName(member).toLowerCase().includes(query)),
  );
  const toggle = (id: number) =>
    setParticipants((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));

  return (
    <Card title={t("newVolunteeringTitle")} description={t("newVolunteeringIntro")}>
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (title.trim() && date) {
            save.mutate();
          }
        }}
      >
        {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
        <TextField label={t("taskLabel")} value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("kindLabel")}
            value={kind}
            onChange={(event) => setKind(event.target.value as VolunteeringKind)}
          >
            {VOLUNTEERING_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`kind.${value}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t("dateLabel")}
            type="date"
            max={today}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={descriptionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("descriptionLabel")}
          </label>
          <textarea
            id={descriptionId}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={textareaClass}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-2xs font-semibold tracking-widest text-muted uppercase">
            {t("participantsLabel")}
          </legend>
          <p className="text-xs text-muted">{t("participantsHint")}</p>
          <TextField label={t("searchMember")} value={search} onChange={(event) => setSearch(event.target.value)} />
          {shown.length > 0 ? (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {shown.map((member) => (
                <li key={member.id}>
                  <label className="flex items-center gap-2 rounded px-2 py-1 text-sm text-ink hover:bg-canvas">
                    <input
                      type="checkbox"
                      checked={participants.includes(member.id)}
                      onChange={() => toggle(member.id)}
                      className="size-4 accent-navy"
                    />
                    {personName(member)}
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!title.trim() || !date} loading={save.isPending}>
            {t("sendVolunteering")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
