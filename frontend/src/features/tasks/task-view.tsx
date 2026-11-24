"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import {
  LINK_TYPES,
  addComment,
  addLink,
  deleteComment,
  deleteTask,
  type TaskDetail,
  type TaskLinkType,
} from "@/features/work/api";
import { BlockedBadge, HealthBadge, PointsBadge, PriorityBadge, TaskStatusBadge } from "@/features/work/badges";
import { refreshWork, useTask } from "@/features/work/queries";
import { AssigneeAvatars, DueDate } from "@/features/work/task-board";
import { Link, useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { safeWebUrl } from "@/lib/links";
import { TaskStock } from "@/features/stock/journal-page";
import { TaskBlockers } from "./task-blockers";
import { TaskForm } from "./task-form";
import { TaskHistory } from "./task-history";
import { TaskProgress } from "./task-progress";
import { Panel, PanelButtons, TaskSteps } from "./task-steps";

/** A task: details, its steps and blockers, people, subtasks, discussion and history. */
export function TaskView() {
  const tErrors = useTranslations("Errors");
  const { id } = useParams<{ id: string }>();
  const task = useTask(Number(id));
  const [editing, setEditing] = useState(false);

  if (task.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert tone="error">{errorText(task.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!task.data) {
    return (
      <div className="mx-auto max-w-4xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      </div>
    );
  }
  const data = task.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {data.parent ? (
        <BackLink href={`/tasks/${data.parent.id}`}>{data.parent.title}</BackLink>
      ) : (
        <BackLink href={`/projects/${data.project.id}`}>{data.project.name}</BackLink>
      )}
      {editing ? (
        <EditTask task={data} onDone={() => setEditing(false)} />
      ) : (
        <TaskSummary task={data} onEdit={() => setEditing(true)} />
      )}
      <TaskSteps task={data} />
      <TaskProgress task={data} />
      <TaskBlockers task={data} />
      <Subtasks task={data} />
      <Links task={data} />
      <TaskStock taskId={data.id} />
      <Comments task={data} />
      <TaskHistory task={data} />
    </div>
  );
}

function EditTask({ task, onDone }: { task: TaskDetail; onDone: () => void }) {
  const t = useTranslations("Tasks");
  return (
    <Card title={t("editTitle")}>
      <TaskForm projectId={task.project.id} task={task} onSaved={onDone} onCancel={onDone} />
    </Card>
  );
}

function TaskSummary({ task, onEdit }: { task: TaskDetail; onEdit: () => void }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const day = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });

  const remove = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: async () => {
      router.replace(task.parent ? `/tasks/${task.parent.id}` : `/projects/${task.project.id}`);
      await refreshWork(queryClient, { deletedTask: task.id });
    },
  });
  const error = remove.error;

  return (
    <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            {task.is_blocked ? <BlockedBadge /> : null}
            <PointsBadge points={task.points} />
            <PriorityBadge priority={task.priority} />
            <HealthBadge health={task.health} />
          </div>
          <p className="font-display text-sm font-bold tracking-wider text-racing" dir="ltr">
            <span className="sr-only">{t("referenceLabel")} </span>
            {task.reference}
          </p>
          <h1 dir="auto" className="text-2xl font-semibold tracking-tight text-ink rtl:text-right">
            {task.title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {task.permissions.edit ? (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("edit")}
            </Button>
          ) : null}
          {task.permissions.delete ? (
            confirmDelete ? (
              <>
                <Button size="sm" onClick={() => remove.mutate()} loading={remove.isPending} autoFocus>
                  {t("confirmDelete")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  {t("cancel")}
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                {t("delete")}
              </Button>
            )
          ) : null}
        </div>
      </div>
      {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
      {confirmDelete && task.subtasks.length > 0 ? (
        <Alert tone="warning">
          {t("deleteSubtasksWarning", { count: task.subtasks.length, shown: String(task.subtasks.length) })}
        </Alert>
      ) : null}
      {task.description ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {task.description}
        </p>
      ) : null}
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <Detail label={t("pointsLabel")}>
          {task.points ? `${task.points} · ${tWork(`pointsLevel.${task.points}`)}` : t("noPoints")}
        </Detail>
        <Detail label={t("startDateLabel")}>{task.start_date ? day(task.start_date) : t("noStartDate")}</Detail>
        <Detail label={t("dueDateLabel")}>
          {task.due_date ? <DueDate date={task.due_date} overdue={task.is_overdue} /> : t("noDueDate")}
          {task.initial_due_date && task.initial_due_date !== task.due_date ? (
            <span className="block text-xs text-muted">
              {t("initialDueDate", { date: day(task.initial_due_date) })}
            </span>
          ) : null}
        </Detail>
        <Detail label={t("subsystemLabel")}>{task.subsystem?.name ?? t("noSubsystem")}</Detail>
        <Detail label={t("stepLabel")}>
          {task.lifecycle_step ? `${task.lifecycle_step.step_order}. ${task.lifecycle_step.name}` : t("noStep")}
        </Detail>
        <Detail label={t("assigneesLabel")}>
          {task.assignees.length === 0 ? (
            t("nobodyAssigned")
          ) : (
            <ul className="space-y-1">
              {task.assignees.map(({ member, is_primary }) => (
                <li key={member.id} className="flex items-center gap-2">
                  <Avatar
                    firstName={member.first_name}
                    lastName={member.last_name}
                    seed={member.id}
                    size="sm"
                    className="size-6 text-2xs"
                  />
                  {member.first_name} {member.last_name}
                  {is_primary ? <Badge tone="info">{t("mainAssignee")}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Detail>
        {task.deliverable ? <Detail label={t("deliverableLabel")}>{task.deliverable}</Detail> : null}
        {task.success_criteria ? <Detail label={t("successCriteriaLabel")}>{task.success_criteria}</Detail> : null}
        {task.actual_deliverable ? (
          <Detail label={t("actualDeliverableLabel")}>{task.actual_deliverable}</Detail>
        ) : null}
        <Detail label={t("createdBy")}>
          {task.created_by
            ? t("createdOn", {
                name: `${task.created_by.first_name} ${task.created_by.last_name}`,
                date: format.dateTime(new Date(task.created_at), { dateStyle: "medium", numberingSystem: "latn" }),
              })
            : format.dateTime(new Date(task.created_at), { dateStyle: "medium", numberingSystem: "latn" })}
        </Detail>
      </dl>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd dir="auto" className="whitespace-pre-line text-ink">
        {children}
      </dd>
    </div>
  );
}

function Subtasks({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const { parent } = task;
  // One level of subtasks only (the API refuses a subtask of a subtask).
  if (parent) {
    return (
      <p className="text-sm text-muted">
        {t.rich("isSubtaskOf", {
          title: parent.title,
          parent: (chunks) => (
            <Link href={`/tasks/${parent.id}`} className="font-medium text-navy hover:underline">
              <bdi>{chunks}</bdi>
            </Link>
          ),
        })}
      </p>
    );
  }
  return (
    <Card
      title={t("subtasksTitle", { count: task.subtasks.length, shown: String(task.subtasks.length) })}
      action={
        task.permissions.edit ? (
          <Link
            href={{ pathname: "/tasks/new", query: { project: task.project.id, parent: task.id } }}
            className={buttonClassName("secondary", "sm")}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("addSubtask")}
          </Link>
        ) : null
      }
    >
      {task.subtasks.length === 0 ? (
        <p className="text-sm text-muted">{t("noSubtasks")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {task.subtasks.map((subtask) => (
            <li key={subtask.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <TaskStatusBadge status={subtask.status} />
              <Link
                href={`/tasks/${subtask.id}`}
                dir="auto"
                className="min-w-0 flex-1 text-sm font-medium text-ink hover:underline"
              >
                {subtask.title}
              </Link>
              <AssigneeAvatars task={subtask} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Where the work lives: Drive folders, GitHub, CAD files, reports. Opened in a new tab. */
function Links({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const me = useMe();
  const [adding, setAdding] = useState(false);
  const canAdd = task.permissions.edit || task.assignees.some(({ member }) => member.id === me.data?.id);
  if (task.links.length === 0 && !canAdd) {
    return null;
  }
  return (
    <Card
      title={t("linksTitle")}
      action={
        canAdd && !adding ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("addLink")}
          </Button>
        ) : null
      }
    >
      {adding ? <AddLink task={task} onClose={() => setAdding(false)} /> : null}
      {task.links.length === 0 && !adding ? <p className="text-sm text-muted">{t("noLinks")}</p> : null}
      <ul className="divide-y divide-line">
        {task.links.map((link) => {
          // Only http(s): a "javascript:" address would run code when clicked.
          const href = safeWebUrl(link.url);
          const text = link.label || link.url;
          return (
            <li key={link.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Badge tone="neutral">{tWork(`linkType.${link.link_type}`)}</Badge>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="auto"
                  className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-navy hover:underline"
                >
                  <span className="truncate">{text}</span>
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <span dir="auto" className="min-w-0 truncate text-sm text-ink">
                  {text}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** A Drive folder, a GitHub commit, a CAD file, a report: a web address only. */
function AddLink({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<TaskLinkType>("other");
  const add = useMutation({
    mutationFn: () => addLink(task.id, { url: url.trim(), label: label.trim(), link_type: type }),
    onSuccess: async () => {
      onClose();
      await refreshWork(queryClient);
    },
  });
  return (
    <div className="mb-4">
      <Panel
        title={t("addLink")}
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) {
            add.mutate();
          }
        }}
      >
        {add.isError ? <Alert tone="error">{errorText(add.error, tErrors)}</Alert> : null}
        <TextField
          label={t("linkUrl")}
          type="url"
          valueDir="ltr"
          required
          placeholder="https://"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t("linkLabel")} value={label} onChange={(event) => setLabel(event.target.value)} />
          <SelectField
            label={t("linkType")}
            value={type}
            onChange={(event) => setType(event.target.value as TaskLinkType)}
          >
            {LINK_TYPES.map((value) => (
              <option key={value} value={value}>
                {tWork(`linkType.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <PanelButtons confirm={t("addLinkConfirm")} pending={add.isPending} disabled={!url.trim()} onClose={onClose} />
      </Panel>
    </div>
  );
}

function Comments({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [content, setContent] = useState("");
  // Deleting cannot be undone: the comment whose deletion is being confirmed.
  const [confirming, setConfirming] = useState<number | null>(null);

  const post = useMutation({
    mutationFn: () => addComment(task.id, content.trim()),
    onSuccess: async () => {
      setContent("");
      await refreshWork(queryClient);
    },
  });
  const remove = useMutation({
    mutationFn: (comment: number) => deleteComment(task.id, comment),
    onSuccess: async () => {
      setConfirming(null);
      await refreshWork(queryClient);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (content.trim()) {
      post.mutate();
    }
  }

  return (
    <Card title={t("commentsTitle", { count: task.comments.length, shown: String(task.comments.length) })}>
      {task.comments.length > 0 ? (
        <ul className="mb-5 space-y-4">
          {task.comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <Avatar
                firstName={comment.author.first_name}
                lastName={comment.author.last_name}
                seed={comment.author.id}
                size="sm"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-ink">
                    {comment.author.first_name} {comment.author.last_name}
                  </span>
                  <span className="text-xs text-muted">
                    {format.dateTime(new Date(comment.created_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                      numberingSystem: "latn",
                    })}
                  </span>
                  {comment.can_delete ? (
                    confirming === comment.id ? (
                      <span className="inline-flex items-baseline gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => remove.mutate(comment.id)}
                          disabled={remove.isPending}
                          autoFocus
                          className="font-medium text-racing-strong underline-offset-2 hover:underline disabled:opacity-60"
                        >
                          {t("confirmDelete")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="text-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          {t("cancel")}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(comment.id)}
                        className="text-xs text-muted underline-offset-2 hover:text-racing-strong hover:underline"
                      >
                        {t("deleteComment")}
                      </button>
                    )
                  ) : null}
                </p>
                <p dir="auto" className="text-sm whitespace-pre-line text-ink">
                  {comment.content}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {post.isError || remove.isError ? (
        <Alert tone="error" className="mb-4">
          {errorText(post.error ?? remove.error, tErrors)}
        </Alert>
      ) : null}
      {task.permissions.comment ? (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor={fieldId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("newComment")}
          </label>
          <textarea
            id={fieldId}
            rows={3}
            maxLength={5000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none"
          />
          <Button type="submit" size="sm" loading={post.isPending} disabled={!content.trim()}>
            {t("postComment")}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
