"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, GraduationCap, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import { useMeetings } from "@/features/meetings/queries";
import { Link } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { createTraining, dropTraining, followTraining, planTraining, withdrawTraining, type Training } from "./api";
import {
  EngagementHeader,
  TrainingStatusBadge,
  panelClass,
  personName,
  textareaClass,
  useDay,
} from "./engagement-parts";
import { refreshEngagement, useFollowedMembers, useLeads, useTrainings } from "./queries";

/** The trainings a member wishes, their heads plan (maybe through a "Training" session), then mark followed. */
export function TrainingsPage() {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const me = useMe();
  const leads = useLeads();
  const trainings = useTrainings();
  const [adding, setAdding] = useState<"wish" | "followed" | null>(null);
  const mine = trainings.data?.filter((training) => training.member.id === me.data?.id) ?? [];
  const team = trainings.data?.filter((training) => training.member.id !== me.data?.id) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <EngagementHeader current="trainings">
        {adding === null ? (
          <div className="flex flex-wrap gap-2">
            {leads ? (
              <Button size="sm" variant="secondary" onClick={() => setAdding("followed")}>
                {t("recordFollowed")}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setAdding("wish")}>
              <Plus className="size-4" aria-hidden="true" />
              {t("wishTraining")}
            </Button>
          </div>
        ) : null}
      </EngagementHeader>
      {adding ? <TrainingForm followed={adding === "followed"} onDone={() => setAdding(null)} /> : null}
      {trainings.isError ? <Alert tone="error">{errorText(trainings.error, tErrors)}</Alert> : null}
      <Card title={t("myTrainingsTitle")} description={t("myTrainingsIntro")}>
        {!trainings.data ? (
          <LinesPlaceholder lines={2} />
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted">{t("noTrainings")}</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((training) => (
              <TrainingRow key={training.id} training={training} />
            ))}
          </ul>
        )}
      </Card>
      {leads ? (
        <Card title={t("teamTrainingsTitle")}>
          {!trainings.data ? (
            <LinesPlaceholder lines={2} />
          ) : team.length === 0 ? (
            <p className="text-sm text-muted">{t("noTeamTrainings")}</p>
          ) : (
            <ul className="space-y-3">
              {team.map((training) => (
                <TrainingRow key={training.id} training={training} showMember />
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function TrainingRow({ training, showMember = false }: { training: Training; showMember?: boolean }) {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const day = useDay();
  const when = useWhen();
  const noteId = useId();
  const [step, setStep] = useState<"plan" | "follow" | "drop" | null>(null);
  const [session, setSession] = useState("");
  const [followedOn, setFollowedOn] = useState(clubToday(new Date()));
  const [note, setNote] = useState("");
  const change = useMutation({
    mutationFn: async (action: "plan" | "follow" | "drop" | "withdraw") => {
      if (action === "plan") {
        await planTraining(training.id, { session_id: session ? Number(session) : null, note: note.trim() });
      } else if (action === "follow") {
        await followTraining(training.id, { followed_on: followedOn, note: note.trim() });
      } else if (action === "drop") {
        await dropTraining(training.id, note.trim());
      } else {
        await withdrawTraining(training.id);
      }
    },
    onSuccess: async () => {
      setStep(null);
      setNote("");
      await refreshEngagement(queryClient);
    },
  });

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap className="size-4 text-navy" aria-hidden="true" />
        <span dir="auto" className="font-medium text-ink">
          {training.topic}
        </span>
        <TrainingStatusBadge status={training.status} />
        {showMember ? (
          <Link href={`/members/${training.member.id}`} className="text-sm text-muted hover:text-ink hover:underline">
            {personName(training.member)}
          </Link>
        ) : null}
      </div>
      {training.reason ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {training.reason}
        </p>
      ) : null}
      {training.session ? (
        <p className="inline-flex flex-wrap items-center gap-1.5 text-sm text-ink">
          <CalendarDays className="size-4 text-muted" aria-hidden="true" />
          <Link href={`/meetings/${training.session.id}`} className="text-navy hover:underline">
            {t("sessionOn", { title: training.session.title, when: when(training.session.starts_at) })}
          </Link>
        </p>
      ) : null}
      {training.followed_on ? (
        <p className="text-xs text-muted">{t("followedOn", { date: day(training.followed_on) })}</p>
      ) : null}
      {training.note ? (
        <p dir="auto" className="text-sm text-muted">
          {t("headNote", { note: training.note })}
        </p>
      ) : null}
      {change.isError ? <Alert tone="error">{errorText(change.error, tErrors)}</Alert> : null}
      {step === null && (training.permissions.manage || training.permissions.withdraw) ? (
        <div className="flex flex-wrap gap-2">
          {training.permissions.manage ? (
            <>
              {training.status === "wished" ? (
                <Button size="sm" onClick={() => setStep("plan")}>
                  {t("plan")}
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setStep("follow")}>
                {t("markFollowed")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStep("drop")}>
                {t("dropTraining")}
              </Button>
            </>
          ) : null}
          {training.permissions.withdraw ? (
            <Button size="sm" variant="ghost" onClick={() => change.mutate("withdraw")} loading={change.isPending}>
              {t("withdrawWish")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {step ? (
        <form
          className={panelClass}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            change.mutate(step);
          }}
        >
          {step === "plan" ? <SessionSelect value={session} onChange={setSession} /> : null}
          {step === "follow" ? (
            <TextField
              label={t("followedOnLabel")}
              type="date"
              max={clubToday(new Date())}
              value={followedOn}
              onChange={(event) => setFollowedOn(event.target.value)}
            />
          ) : null}
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
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={step === "follow" && !followedOn} loading={change.isPending}>
              {t(step === "plan" ? "confirmPlan" : step === "follow" ? "confirmFollowed" : "confirmDrop")}
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

/** A date and time of a session ("mar. 27 oct., 18:00"), with latin digits. */
function useWhen() {
  const format = useFormatter();
  return (value: string) =>
    format.dateTime(new Date(value), {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      numberingSystem: "latn",
    });
}

/** The coming "Training" sessions of Meetings, to plan a training through one (or none). */
function SessionSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("Engagement");
  const meetings = useMeetings("upcoming");
  const when = useWhen();
  const sessions = (meetings.data ?? []).filter((meeting) => meeting.kind === "training");
  return (
    <SelectField label={t("sessionLabel")} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t("noSession")}</option>
      {sessions.map((meeting) => (
        <option key={meeting.id} value={meeting.id}>
          {t("sessionOn", { title: meeting.title, when: when(meeting.starts_at) })}
        </option>
      ))}
    </SelectField>
  );
}

/** A wish of the viewer, or (a head) a training a member followed outside the ERP. */
export function TrainingForm({ followed, onDone }: { followed: boolean; onDone: () => void }) {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const members = useFollowedMembers(followed);
  const reasonId = useId();
  const today = clubToday(new Date());
  const [member, setMember] = useState("");
  const [topic, setTopic] = useState("");
  const [reason, setReason] = useState("");
  const [followedOn, setFollowedOn] = useState(today);
  const save = useMutation({
    mutationFn: () =>
      createTraining(
        followed
          ? {
              topic: topic.trim(),
              reason: reason.trim(),
              member_id: Number(member),
              status: "followed",
              followed_on: followedOn,
            }
          : { topic: topic.trim(), reason: reason.trim(), status: "wished" },
      ),
    onSuccess: async () => {
      await refreshEngagement(queryClient);
      onDone();
    },
  });
  const ready = topic.trim() !== "" && (!followed || (member !== "" && followedOn !== ""));

  return (
    <Card
      title={t(followed ? "recordFollowedTitle" : "wishTitle")}
      description={t(followed ? "recordFollowedIntro" : "wishIntro")}
    >
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (ready) {
            save.mutate();
          }
        }}
      >
        {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
        {followed ? (
          <SelectField label={t("memberLabel")} value={member} onChange={(event) => setMember(event.target.value)}>
            <option value="">{t("chooseMember")}</option>
            {(members.data ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {personName(person)}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextField label={t("topicLabel")} value={topic} onChange={(event) => setTopic(event.target.value)} />
        {followed ? (
          <TextField
            label={t("followedOnLabel")}
            type="date"
            max={today}
            value={followedOn}
            onChange={(event) => setFollowedOn(event.target.value)}
          />
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor={reasonId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("reasonLabel")}
          </label>
          <textarea
            id={reasonId}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={textareaClass}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!ready} loading={save.isPending}>
            {t(followed ? "saveFollowed" : "sendWish")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
