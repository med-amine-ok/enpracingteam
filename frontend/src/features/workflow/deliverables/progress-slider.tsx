"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressMeter } from "../badges";
import { updateDeliverableProgress, type DeliverableDetail } from "../api";
import { MutationError, TextArea, useDates, useWorkMutation } from "./shared";

/**
 * The Deliverable progress slider (guide §15.1): the assigned members' own estimate, 0–100 step 1, saved
 * explicitly. It is never derived from the Milestones: completing one does not move it.
 */
export function ProgressSlider({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const { moment } = useDates();
  const id = useId();
  const saved = deliverable.progress ?? 0;
  // null: not editing; the slider then shows the backend's value.
  const [draft, setDraft] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const value = draft ?? saved;
  const dirty = draft !== null && draft !== saved;
  const save = useWorkMutation(
    ({ progress, text }: { progress: number; text: string }) =>
      updateDeliverableProgress(deliverable.id, progress, text),
    () => {
      setDraft(null);
      setNote("");
      setConfirmed(true);
    },
  );
  const editable = deliverable.rights.update_progress;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (dirty && !save.isPending) {
      save.mutate({ progress: value, text: note.trim() });
    }
  }

  return (
    <Card title={t("progressTitle")} description={t("progressIntro")}>
      <div className="space-y-4">
        <div className="space-y-1">
          <p
            className="font-display text-4xl leading-none font-bold text-navy tabular-nums"
            data-testid="saved-progress"
          >
            {saved} %
          </p>
          <p className="text-xs text-muted">
            {deliverable.progress_updated_at
              ? t("progressUpdatedAt", { date: moment(deliverable.progress_updated_at) })
              : t("progressNeverUpdated")}
          </p>
        </div>
        <ProgressMeter value={saved} label={t("progressTitle")} className="w-full" />
        {editable ? (
          <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-canvas p-4" noValidate>
            <div className="space-y-1.5">
              <label
                htmlFor={id}
                className="flex items-center justify-between gap-2 text-2xs font-semibold tracking-widest text-muted uppercase"
              >
                {t("progressLabel")}
                <span className="flex items-center gap-2">
                  {dirty ? <Badge tone="warning">{t("unsaved")}</Badge> : null}
                  <span className="font-display text-sm text-racing tabular-nums">{value} %</span>
                </span>
              </label>
              <input
                id={id}
                type="range"
                min={0}
                max={100}
                step={1}
                value={value}
                disabled={save.isPending}
                onChange={(event) => {
                  setConfirmed(false);
                  setDraft(Number(event.target.value));
                }}
                className="w-full accent-racing"
              />
            </div>
            <TextArea label={t("progressNote")} value={note} onChange={setNote} rows={2} hint={t("progressNoteHint")} />
            <MutationError error={save.error} />
            {confirmed && !dirty ? <Alert tone="success">{t("progressSaved", { value: saved })}</Alert> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={save.isPending} disabled={!dirty}>
                {t("progressSave")}
              </Button>
              {dirty ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => {
                    setDraft(null);
                    setNote("");
                  }}
                >
                  {t("progressDiscard")}
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
