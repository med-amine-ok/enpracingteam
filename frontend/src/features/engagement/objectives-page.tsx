"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { GOAL_STATUSES, changeGoal, createGoal, type Goal, type GoalStatus } from "./api";
import {
  EngagementHeader,
  GoalStatusBadge,
  ProgressBar,
  panelClass,
  personName,
  textareaClass,
  useDay,
} from "./engagement-parts";
import { refreshEngagement, useFollowedMembers, useGoals, useLeads } from "./queries";

/** The goals of the season: set by a member's department head, moved forward by the member, assessed by the head. */
export function ObjectivesPage() {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const me = useMe();
  const leads = useLeads();
  const goals = useGoals();
  const [adding, setAdding] = useState(false);
  const mine = goals.data?.filter((goal) => goal.member.id === me.data?.id) ?? [];
  const team = goals.data?.filter((goal) => goal.member.id !== me.data?.id) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <EngagementHeader current="objectives">
        {leads && !adding ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("setGoal")}
          </Button>
        ) : null}
      </EngagementHeader>
      {adding ? <GoalForm onDone={() => setAdding(false)} /> : null}
      {goals.isError ? <Alert tone="error">{errorText(goals.error, tErrors)}</Alert> : null}
      <Card title={t("myGoalsTitle")} description={t("myGoalsIntro")}>
        {!goals.data ? (
          <LinesPlaceholder lines={2} />
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted">{t("noGoals")}</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((goal) => (
              <GoalRow key={goal.id} goal={goal} />
            ))}
          </ul>
        )}
      </Card>
      {leads ? (
        <Card title={t("teamGoalsTitle")}>
          {!goals.data ? (
            <LinesPlaceholder lines={2} />
          ) : team.length === 0 ? (
            <p className="text-sm text-muted">{t("noTeamGoals")}</p>
          ) : (
            <ul className="space-y-3">
              {team.map((goal) => (
                <GoalRow key={goal.id} goal={goal} showMember />
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}

export function GoalRow({ goal, showMember = false }: { goal: Goal; showMember?: boolean }) {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const day = useDay();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(String(goal.progress));
  const [status, setStatus] = useState<GoalStatus>(goal.status);
  const [note, setNote] = useState(goal.permissions.assess ? goal.assessment_note : goal.member_note);
  const save = useMutation({
    mutationFn: () =>
      changeGoal(
        goal.id,
        goal.permissions.assess
          ? { progress: Number(progress), status, assessment_note: note.trim() }
          : { progress: Number(progress), member_note: note.trim() },
      ),
    onSuccess: async () => {
      setOpen(false);
      await refreshEngagement(queryClient);
    },
  });
  const valid = progress !== "" && Number(progress) >= 0 && Number(progress) <= 100;

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Target className="size-4 text-racing" aria-hidden="true" />
        <span dir="auto" className="font-medium text-ink">
          {goal.title}
        </span>
        <GoalStatusBadge status={goal.status} />
        {showMember ? (
          <Link href={`/members/${goal.member.id}`} className="text-sm text-muted hover:text-ink hover:underline">
            {personName(goal.member)}
          </Link>
        ) : null}
      </div>
      <ProgressBar value={goal.progress} label={t("progressOf", { title: goal.title })} />
      {goal.description ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {goal.description}
        </p>
      ) : null}
      <dl className="grid gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-2">
        {goal.measure ? (
          <div>
            <dt className="inline">{t("measure")} </dt>
            <dd dir="auto" className="inline text-ink">
              {goal.measure}
            </dd>
          </div>
        ) : null}
        {goal.due_date ? (
          <div>
            <dt className="inline">{t("dueDate")} </dt>
            <dd className="inline text-ink">{day(goal.due_date)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="inline">{t("setBy")} </dt>
          <dd className="inline text-ink">{personName(goal.set_by)}</dd>
        </div>
      </dl>
      {goal.member_note ? (
        <p dir="auto" className="text-sm text-muted">
          {t("memberNote", { note: goal.member_note })}
        </p>
      ) : null}
      {goal.assessment_note ? <Alert tone="info">{t("assessmentNote", { note: goal.assessment_note })}</Alert> : null}
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {!open && (goal.permissions.progress || goal.permissions.assess) ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t(goal.permissions.assess ? "assess" : "updateProgress")}
        </Button>
      ) : null}
      {open ? (
        <form
          className={panelClass}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (valid) {
              save.mutate();
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t("progressLabel")}
              type="number"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(event) => setProgress(event.target.value)}
            />
            {goal.permissions.assess ? (
              <SelectField
                label={t("statusLabel")}
                value={status}
                onChange={(event) => setStatus(event.target.value as GoalStatus)}
              >
                {GOAL_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`goalStatus.${value}`)}
                  </option>
                ))}
              </SelectField>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={noteId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
              {t(goal.permissions.assess ? "assessmentLabel" : "memberNoteLabel")}
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
            <Button type="submit" size="sm" disabled={!valid} loading={save.isPending}>
              {t("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** A head sets a goal of one of their members for the season, never their own. */
export function GoalForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const members = useFollowedMembers();
  const descriptionId = useId();
  const [member, setMember] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [measure, setMeasure] = useState("");
  const [dueDate, setDueDate] = useState("");
  const save = useMutation({
    mutationFn: () =>
      createGoal({
        member_id: Number(member),
        title: title.trim(),
        description: description.trim(),
        measure: measure.trim(),
        due_date: dueDate || null,
      }),
    onSuccess: async () => {
      await refreshEngagement(queryClient);
      onDone();
    },
  });
  const ready = member !== "" && title.trim() !== "";

  return (
    <Card title={t("newGoalTitle")} description={t("newGoalIntro")}>
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
        <SelectField label={t("memberLabel")} value={member} onChange={(event) => setMember(event.target.value)}>
          <option value="">{t("chooseMember")}</option>
          {(members.data ?? []).map((person) => (
            <option key={person.id} value={person.id}>
              {personName(person)}
            </option>
          ))}
        </SelectField>
        <TextField label={t("goalLabel")} value={title} onChange={(event) => setTitle(event.target.value)} />
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
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t("measureLabel")} value={measure} onChange={(event) => setMeasure(event.target.value)} />
          <TextField
            label={t("dueDateLabel")}
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!ready} loading={save.isPending}>
            {t("sendGoal")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
