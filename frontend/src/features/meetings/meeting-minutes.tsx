"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import { useMembers } from "@/features/members/use-members";
import { useProjects } from "@/features/work/queries";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import {
  actionToTask,
  addAction,
  addDecision,
  changeAction,
  deleteDecision,
  saveMinutes,
  type MeetingAction,
  type MeetingDetail,
} from "./api";
import { textareaClass } from "./meeting-parts";
import { meetingKeys, refreshMeetings } from "./queries";

/** The minutes, the decisions taken and the actions to follow: written by who runs the session. */
export function MeetingMinutes({ meeting }: { meeting: MeetingDetail }) {
  const run = meeting.permissions.run;
  const published = !!meeting.minutes_published_at;
  if (!run && !published && meeting.decisions.length === 0 && meeting.actions.length === 0) {
    return null;
  }
  return (
    <>
      {run || published ? <Minutes meeting={meeting} /> : null}
      <Decisions meeting={meeting} />
      <Actions meeting={meeting} />
    </>
  );
}

function Minutes({ meeting }: { meeting: MeetingDetail }) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [text, setText] = useState(meeting.minutes);
  const save = useMutation({
    mutationFn: (publish: boolean) => saveMinutes(meeting.id, text, publish),
    onSuccess: async (saved) => {
      queryClient.setQueryData(meetingKeys.detail(meeting.id), saved);
      await refreshMeetings(queryClient);
    },
  });
  const published = meeting.minutes_published_at;

  return (
    <Card
      title={t("minutesTitle")}
      description={
        published
          ? t("publishedOn", {
              date: format.dateTime(new Date(published), { dateStyle: "medium", numberingSystem: "latn" }),
            })
          : undefined
      }
    >
      {meeting.permissions.run ? (
        <form
          className="space-y-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate(false);
          }}
        >
          {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
          <label htmlFor={fieldId} className="sr-only">
            {t("minutesTitle")}
          </label>
          <textarea
            id={fieldId}
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={textareaClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" size="sm" loading={save.isPending && !save.variables}>
              {t("saveMinutes")}
            </Button>
            {!published ? (
              <Button size="sm" onClick={() => save.mutate(true)} loading={save.isPending && !!save.variables}>
                {t("publishMinutes")}
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {meeting.minutes}
        </p>
      )}
    </Card>
  );
}

function Decisions({ meeting }: { meeting: MeetingDetail }) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const refresh = () => refreshMeetings(queryClient);
  const add = useMutation({
    mutationFn: () => addDecision(meeting.id, text.trim()),
    onSuccess: async () => {
      setText("");
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => deleteDecision(meeting.id, id), onSuccess: refresh });
  const run = meeting.permissions.run;
  if (!run && meeting.decisions.length === 0) {
    return null;
  }
  const error = add.error ?? remove.error;

  return (
    <Card title={t("decisionsTitle", { count: meeting.decisions.length, shown: String(meeting.decisions.length) })}>
      <div className="space-y-4">
        {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
        {meeting.decisions.length === 0 ? (
          <p className="text-sm text-muted">{t("noDecisions")}</p>
        ) : (
          <ol className="list-decimal space-y-2 ps-5">
            {meeting.decisions.map((decision) => (
              <li key={decision.id} className="text-sm text-ink">
                <span className="flex items-start justify-between gap-2">
                  <span dir="auto" className="whitespace-pre-line">
                    {decision.text}
                  </span>
                  {run ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(decision.id)}
                      aria-label={t("removeDecision")}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
        {run ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) {
                add.mutate();
              }
            }}
          >
            <div className="min-w-64 flex-1">
              <TextField label={t("newDecision")} value={text} onChange={(event) => setText(event.target.value)} />
            </div>
            <Button type="submit" variant="secondary" disabled={!text.trim()} loading={add.isPending}>
              <Plus className="size-4" aria-hidden="true" />
              {t("addDecision")}
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

function Actions({ meeting }: { meeting: MeetingDetail }) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const members = useMembers();
  const descriptionId = useId();
  const [description, setDescription] = useState("");
  const [responsible, setResponsible] = useState("");
  const [due, setDue] = useState("");
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((member) => member.status !== "alumni")
        .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)),
    [members.data],
  );
  const add = useMutation({
    mutationFn: () =>
      addAction(meeting.id, {
        description: description.trim(),
        responsible_id: responsible ? Number(responsible) : null,
        due_date: due || null,
      }),
    onSuccess: async () => {
      setDescription("");
      setResponsible("");
      setDue("");
      await refreshMeetings(queryClient);
    },
  });
  const run = meeting.permissions.run;
  if (!run && meeting.actions.length === 0) {
    return null;
  }

  return (
    <Card title={t("actionsTitle", { count: meeting.actions.length, shown: String(meeting.actions.length) })}>
      <div className="space-y-4">
        {add.isError ? <Alert tone="error">{errorText(add.error, tErrors)}</Alert> : null}
        {meeting.actions.length === 0 ? (
          <p className="text-sm text-muted">{t("noActions")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {meeting.actions.map((item) => (
              <ActionRow key={item.id} meeting={meeting} item={item} />
            ))}
          </ul>
        )}
        {run ? (
          <form
            className="space-y-3 rounded-lg border border-line bg-canvas p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (description.trim()) {
                add.mutate();
              }
            }}
          >
            <div className="space-y-1.5">
              <label
                htmlFor={descriptionId}
                className="block text-xs font-semibold tracking-widest text-muted uppercase"
              >
                {t("newAction")}
              </label>
              <textarea
                id={descriptionId}
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={textareaClass}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label={t("responsibleLabel")}
                value={responsible}
                onChange={(event) => setResponsible(event.target.value)}
              >
                <option value="">{t("choosePerson")}</option>
                {people.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.first_name} {member.last_name}
                  </option>
                ))}
              </SelectField>
              <TextField
                label={t("dueLabel")}
                type="date"
                valueDir="ltr"
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={!description.trim()} loading={add.isPending}>
              <Plus className="size-4" aria-hidden="true" />
              {t("addAction")}
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

function ActionRow({ meeting, item }: { meeting: MeetingDetail; item: MeetingAction }) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [choosing, setChoosing] = useState(false);
  const [project, setProject] = useState("");
  // Ticked at once; put back if the API refuses.
  const [done, setDone] = useState(item.is_done);
  const projects = useProjects();
  const run = meeting.permissions.run;
  const mayTick = run || (!!item.responsible && item.responsible.id === me.data?.id);
  const refresh = () => refreshMeetings(queryClient);
  const tick = useMutation({
    mutationFn: (value: boolean) => changeAction(meeting.id, item.id, { is_done: value }),
    onError: (_error, value) => setDone(!value),
    onSuccess: refresh,
  });
  const toTask = useMutation({
    mutationFn: () => actionToTask(meeting.id, item.id, Number(project)),
    onSuccess: async () => {
      setChoosing(false);
      await refresh();
    },
  });
  const error = tick.error ?? toTask.error;
  const name = item.responsible ? `${item.responsible.first_name} ${item.responsible.last_name}` : t("nobody");

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={done}
          disabled={!mayTick || tick.isPending}
          onChange={(event) => {
            setDone(event.target.checked);
            tick.mutate(event.target.checked);
          }}
          aria-label={t("doneOf", { action: item.description })}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p dir="auto" className={done ? "text-sm text-muted line-through" : "text-sm text-ink"}>
            {item.description}
          </p>
          <p className="text-xs text-muted">
            {name}
            {item.due_date
              ? ` · ${t("dueOn", {
                  date: format.dateTime(new Date(item.due_date), { dateStyle: "medium", numberingSystem: "latn" }),
                })}`
              : ""}
          </p>
          {item.task ? (
            <Link href={`/tasks/${item.task.id}`} className="text-xs font-medium text-navy hover:underline">
              {t("taskLink", { title: item.task.title })}
            </Link>
          ) : null}
        </div>
        {run && !item.task && !choosing ? (
          <Button variant="ghost" size="sm" onClick={() => setChoosing(true)}>
            <ListPlus className="size-4" aria-hidden="true" />
            {t("makeTask")}
          </Button>
        ) : null}
      </div>
      {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
      {choosing ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-canvas p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (project) {
              toTask.mutate();
            }
          }}
        >
          <div className="min-w-56 flex-1">
            <SelectField label={t("projectLabel")} value={project} onChange={(event) => setProject(event.target.value)}>
              <option value="">{t("chooseProject")}</option>
              {(projects.data ?? [])
                .filter((item) => item.permissions.create_task)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </SelectField>
          </div>
          <Button type="submit" size="sm" disabled={!project} loading={toTask.isPending}>
            {t("makeTaskConfirm")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setChoosing(false)}>
            {t("back")}
          </Button>
        </form>
      ) : null}
    </li>
  );
}
