"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Play, RotateCcw, Send } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import {
  LINK_TYPES,
  QUALITY_MARKS,
  reviseTask,
  startTask,
  submitTask,
  validateTask,
  type TaskDetail,
  type TaskLinkType,
  type TaskStatus,
} from "@/features/work/api";
import { refreshWork, workKeys } from "@/features/work/queries";
import { waitsForEstimate } from "@/features/work/task-board";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";

/** The four steps of a task; "to rework" takes the place of "in progress". */
const STEPS: TaskStatus[] = ["planned", "in_progress", "submitted", "validated"];

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

/** After a step: the task as the API answers it, then everything that may show it listed again. */
function useStep<T>(task: TaskDetail, call: (value: T) => Promise<TaskDetail>, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: async (saved) => {
      queryClient.setQueryData(workKeys.task(task.id), saved);
      onDone?.();
      await refreshWork(queryClient);
    },
  });
}

/** Where the task stands (planned → in progress → submitted → validated) and the viewer's next step. */
export function TaskSteps({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const current = task.status === "needs_revision" ? 1 : STEPS.indexOf(task.status);
  const start = useStep(task, () => startTask(task.id));
  const revision = [...task.events].reverse().find((event) => event.kind === "revision");

  return (
    <Card title={t("stepsTitle")}>
      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label={t("stepsTitle")}>
        {STEPS.map((step, index) => {
          const label =
            index === 1 && task.status === "needs_revision"
              ? tWork("taskStatus.needs_revision")
              : tWork(`taskStatus.${step}`);
          return (
            <li
              key={step}
              aria-current={index === current ? "step" : undefined}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-center text-xs font-medium",
                index < current && "border-success/30 bg-success-soft text-success",
                index === current &&
                  (task.status === "needs_revision"
                    ? "border-racing/40 bg-racing-soft text-racing-strong"
                    : "border-navy/40 bg-info-soft text-navy"),
                index > current && "border-line text-muted",
              )}
            >
              {label}
            </li>
          );
        })}
      </ol>

      <div className="space-y-4">
        {start.isError ? <Alert tone="error">{errorText(start.error, tErrors)}</Alert> : null}

        {task.status === "planned" ? (
          waitsForEstimate(task) ? (
            <Alert tone="info">{task.permissions.estimate ? t("estimateFirstYou") : t("estimateFirst")}</Alert>
          ) : task.permissions.start ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => start.mutate(undefined)} loading={start.isPending}>
                <Play className="size-4" aria-hidden="true" />
                {t("startWork")}
              </Button>
              <p className="text-sm text-muted">{t("startHint")}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">{t("notStarted")}</p>
          )
        ) : null}

        {task.status === "needs_revision" && revision ? (
          <Alert tone="warning">
            {t("toRework", { comment: String((revision.data as { comment?: string }).comment ?? "") })}
          </Alert>
        ) : null}

        {task.permissions.submit ? <SubmitPanel task={task} /> : null}

        {task.status === "submitted" ? (
          task.permissions.validate ? (
            <ValidatePanel task={task} />
          ) : (
            <p className="text-sm text-muted">{t("awaitsValidation")}</p>
          )
        ) : null}

        {task.status === "validated" ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <Check className="size-4 text-success" aria-hidden="true" />
            {task.validated_by && task.validated_at
              ? t("validatedBy", {
                  name: `${task.validated_by.first_name} ${task.validated_by.last_name}`,
                  date: format.dateTime(new Date(task.validated_at), { dateStyle: "medium", numberingSystem: "latn" }),
                })
              : tWork("taskStatus.validated")}
            {task.quality_mark !== null ? (
              <strong className="font-semibold">{tWork("qualityMark", { mark: String(task.quality_mark) })}</strong>
            ) : null}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** What was delivered, with its proof: a link (required while the task has none). */
function SubmitPanel({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const deliveredId = useId();
  const [open, setOpen] = useState(false);
  const [delivered, setDelivered] = useState(task.actual_deliverable);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<TaskLinkType>("other");
  const needsLink = task.links.length === 0;
  const submit = useStep(
    task,
    () =>
      submitTask(task.id, {
        actual_deliverable: delivered.trim(),
        ...(url.trim() ? { evidence_url: url.trim(), evidence_label: label.trim(), evidence_type: type } : {}),
      }),
    () => setOpen(false),
  );

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setOpen(true)}>
          <Send className="size-4" aria-hidden="true" />
          {t("submitWork")}
        </Button>
        <p className="text-sm text-muted">{t("submitHint")}</p>
      </div>
    );
  }

  function send(event: FormEvent) {
    event.preventDefault();
    submit.mutate(undefined);
  }

  return (
    <Panel title={t("submitTitle")} onSubmit={send}>
      {submit.isError ? <Alert tone="error">{errorText(submit.error, tErrors)}</Alert> : null}
      {task.deliverable ? (
        <p className="text-sm text-muted">
          {t("expected")} <bdi className="text-ink">{task.deliverable}</bdi>
        </p>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor={deliveredId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("actualDeliverableLabel")}
        </label>
        <textarea
          id={deliveredId}
          rows={3}
          required
          value={delivered}
          onChange={(event) => setDelivered(event.target.value)}
          className={textareaClass}
        />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-2xs font-semibold tracking-widest text-muted uppercase">
          {needsLink ? t("evidenceRequired") : t("evidenceMore")}
        </legend>
        <TextField
          label={t("evidenceUrl")}
          type="url"
          valueDir="ltr"
          required={needsLink}
          placeholder="https://"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t("evidenceLabel")} value={label} onChange={(event) => setLabel(event.target.value)} />
          <SelectField
            label={t("evidenceType")}
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
      </fieldset>
      <PanelButtons
        confirm={t("submitConfirm")}
        pending={submit.isPending}
        disabled={!delivered.trim() || (needsLink && !url.trim())}
        onClose={() => setOpen(false)}
      />
    </Panel>
  );
}

/** A leader validates with a quality mark (0 to 5), or sends it back saying what to rework. */
function ValidatePanel({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const commentId = useId();
  const [mode, setMode] = useState<"validate" | "revise" | null>(null);
  const [mark, setMark] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const validate = useStep(
    task,
    (value: number) => validateTask(task.id, value),
    () => setMode(null),
  );
  const revise = useStep(
    task,
    (value: string) => reviseTask(task.id, value),
    () => setMode(null),
  );

  return (
    <div className="space-y-4">
      {task.actual_deliverable ? (
        <div className="rounded-lg bg-canvas px-4 py-3 text-sm">
          <p className="text-xs text-muted">{t("actualDeliverableLabel")}</p>
          <p dir="auto" className="whitespace-pre-line text-ink">
            {task.actual_deliverable}
          </p>
        </div>
      ) : null}
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("validate")}>
            <Check className="size-4" aria-hidden="true" />
            {t("validateWork")}
          </Button>
          <Button variant="secondary" onClick={() => setMode("revise")}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("reviseWork")}
          </Button>
        </div>
      ) : null}
      {mode === "validate" ? (
        <Panel
          title={t("validateTitle")}
          onSubmit={(event) => {
            event.preventDefault();
            if (mark !== null) {
              validate.mutate(mark);
            }
          }}
        >
          {validate.isError ? <Alert tone="error">{errorText(validate.error, tErrors)}</Alert> : null}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-2xs font-semibold tracking-widest text-muted uppercase">
              {t("qualityMarkLabel")}
            </legend>
            {QUALITY_MARKS.map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="quality-mark"
                  value={value}
                  checked={mark === value}
                  onChange={() => setMark(value)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold tabular-nums">{value}</span> · {tWork(`qualityLevel.${value}`)}
                </span>
              </label>
            ))}
          </fieldset>
          <PanelButtons
            confirm={t("validateConfirm")}
            pending={validate.isPending}
            disabled={mark === null}
            onClose={() => setMode(null)}
          />
        </Panel>
      ) : null}
      {mode === "revise" ? (
        <Panel
          title={t("reviseTitle")}
          onSubmit={(event) => {
            event.preventDefault();
            revise.mutate(comment.trim());
          }}
        >
          {revise.isError ? <Alert tone="error">{errorText(revise.error, tErrors)}</Alert> : null}
          <div className="space-y-1.5">
            <label htmlFor={commentId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
              {t("reviseLabel")}
            </label>
            <textarea
              id={commentId}
              rows={3}
              required
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className={textareaClass}
            />
          </div>
          <PanelButtons
            confirm={t("reviseConfirm")}
            pending={revise.isPending}
            disabled={!comment.trim()}
            onClose={() => setMode(null)}
          />
        </Panel>
      ) : null}
    </div>
  );
}

export function Panel({
  title,
  children,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-line bg-canvas p-4" noValidate>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </form>
  );
}

export function PanelButtons({
  confirm,
  pending,
  disabled = false,
  onClose,
}: {
  confirm: string;
  pending: boolean;
  disabled?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Tasks");
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" loading={pending} disabled={disabled}>
        {confirm}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t("cancel")}
      </Button>
    </div>
  );
}
