"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/text-field";
import { updateProgress, type ProgressUpdate, type TaskDetail } from "@/features/work/api";
import { HealthBadge } from "@/features/work/badges";
import { ProgressBar } from "@/features/work/lifecycle-steps";
import { refreshWork, workKeys } from "@/features/work/queries";
import { errorText } from "@/lib/error-text";

/** The Figma's work order follow-up: how far the task is, its health, its phase and its next step. */
export function TaskProgress({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const automatic = task.progress_mode === "automatic";
  return (
    <Card title={t("progressTitle")}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="font-display text-4xl leading-none font-bold text-navy tabular-nums">{task.progress} %</p>
            <p className="text-xs text-muted">{t(automatic ? "progressAutomatic" : "progressManual")}</p>
          </div>
          <HealthBadge health={task.health} />
        </div>
        <ProgressBar done={task.progress} total={100} label={t("progressTitle")} />
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-0.5">
            <dt className="text-xs text-muted">{t("currentPhase")}</dt>
            <dd dir="auto" className="font-medium text-ink">
              {task.current_phase || <span className="font-normal text-muted">{t("notSaid")}</span>}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-xs text-muted">{t("nextStep")}</dt>
            <dd dir="auto" className="font-medium text-ink">
              {task.next_step || <span className="font-normal text-muted">{t("notSaid")}</span>}
            </dd>
          </div>
        </dl>
        {task.permissions.update_progress ? <ProgressForm task={task} /> : null}
      </div>
    </Card>
  );
}

function ProgressForm({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const automatic = task.progress_mode === "automatic";
  const [progress, setProgress] = useState(task.progress);
  const [phase, setPhase] = useState(task.current_phase);
  const [next, setNext] = useState(task.next_step);
  const save = useMutation({
    mutationFn: (body: ProgressUpdate) => updateProgress(task.id, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(workKeys.task(task.id), saved);
      await refreshWork(queryClient);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const body: ProgressUpdate = { current_phase: phase.trim(), next_step: next.trim() };
    save.mutate(automatic ? body : { ...body, progress });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-canvas p-4">
      <h3 className="eyebrow">{t("progressUpdate")}</h3>
      {automatic ? null : (
        <div className="space-y-1.5">
          <label
            htmlFor={`progress-${task.id}`}
            className="flex justify-between text-2xs font-semibold tracking-widest text-muted uppercase"
          >
            {t("progressLabel")}
            <span className="font-display text-sm text-racing tabular-nums">{progress} %</span>
          </label>
          <input
            id={`progress-${task.id}`}
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value))}
            className="w-full accent-racing"
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("currentPhase")}
          maxLength={150}
          value={phase}
          onChange={(event) => setPhase(event.target.value)}
        />
        <TextField
          label={t("nextStep")}
          maxLength={255}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </div>
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("progressSaved")}</Alert> : null}
      <Button type="submit" size="sm" loading={save.isPending}>
        {t("progressSave")}
      </Button>
    </form>
  );
}
