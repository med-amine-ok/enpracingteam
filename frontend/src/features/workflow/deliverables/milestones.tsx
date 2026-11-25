"use client";

import { useQuery } from "@tanstack/react-query";
import { History, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { TextField } from "@/components/ui/text-field";
import {
  cancelMilestone,
  completeMilestone,
  createMilestone,
  deleteMilestone,
  fetchMilestoneHistory,
  updateMilestone,
  type DeliverableDetail,
  type Milestone,
} from "../api";
import { workflowKeys } from "../queries";
import {
  ConfirmDialog,
  MutationError,
  Panel,
  PanelButtons,
  TextArea,
  memberName,
  useDates,
  useWorkMutation,
} from "./shared";

/** Under the module's key: refreshWorkflow reads it again after any change. */
const historyKey = (milestone: number) => [...workflowKeys.all, "milestone-history", milestone] as const;

/**
 * The Milestones (guide §7): binary checkpoints, completed or not. No percentage, weight, points or assignee;
 * completing one never moves the Deliverable's progress slider.
 */
export function Milestones({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const [creating, setCreating] = useState(false);
  const active = deliverable.milestones.filter((milestone) => !milestone.is_cancelled);
  const cancelled = deliverable.milestones.filter((milestone) => milestone.is_cancelled);
  const done = active.filter((milestone) => milestone.is_completed).length;
  const canManage = deliverable.rights.manage_milestones;
  return (
    <Card
      title={t("milestonesTitle")}
      description={active.length > 0 ? t("milestonesCount", { done, total: active.length }) : t("milestonesIntro")}
      action={
        canManage && !creating ? (
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("milestoneAdd")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {creating ? <CreateMilestone deliverable={deliverable} onClose={() => setCreating(false)} /> : null}
        {active.length === 0 && !creating ? <p className="text-sm text-muted">{t("milestonesNone")}</p> : null}
        {active.length > 0 ? (
          <ul className="space-y-3">
            {active.map((milestone) => (
              <MilestoneItem key={milestone.id} deliverable={deliverable} milestone={milestone} />
            ))}
          </ul>
        ) : null}
        {cancelled.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">
              {t("milestonesCancelled", { count: cancelled.length })}
            </summary>
            <ul className="mt-3 space-y-3">
              {cancelled.map((milestone) => (
                <MilestoneItem key={milestone.id} deliverable={deliverable} milestone={milestone} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function CreateMilestone({ deliverable, onClose }: { deliverable: DeliverableDetail; onClose: () => void }) {
  const t = useTranslations("Deliverables");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const create = useWorkMutation(() => createMilestone(deliverable.id, title.trim(), description.trim()), onClose);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() && !create.isPending) {
      create.mutate();
    }
  }
  return (
    <Panel title={t("milestoneNew")} description={t("milestoneNewHint")} onSubmit={submit}>
      <MutationError error={create.error} />
      <TextField
        label={t("milestoneTitle")}
        required
        maxLength={255}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextArea label={t("milestoneDescription")} value={description} onChange={setDescription} rows={2} />
      <PanelButtons
        confirm={t("milestoneCreate")}
        pending={create.isPending}
        disabled={!title.trim()}
        onClose={onClose}
      />
    </Panel>
  );
}

type Mode = "edit" | "cancel" | "delete" | null;

function MilestoneItem({ deliverable, milestone }: { deliverable: DeliverableDetail; milestone: Milestone }) {
  const t = useTranslations("Deliverables");
  const { day, moment } = useDates();
  const [mode, setMode] = useState<Mode>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [title, setTitle] = useState(milestone.title);
  const [description, setDescription] = useState(milestone.description ?? "");
  const [reason, setReason] = useState("");
  const close = () => setMode(null);
  // The box shows the backend's state only: it changes once the backend has confirmed (guide §7.2).
  const toggle = useWorkMutation((completed: boolean) => completeMilestone(milestone.id, completed));
  const edit = useWorkMutation(
    () => updateMilestone(milestone.id, { title: title.trim(), description: description.trim() }),
    close,
  );
  const cancel = useWorkMutation(() => cancelMilestone(milestone.id, reason.trim()), close);
  const remove = useWorkMutation(() => deleteMilestone(milestone.id), close);
  const canToggle = deliverable.rights.manage_milestones && !milestone.is_cancelled;
  const canHead = deliverable.rights.cancel_milestones && !milestone.is_cancelled;
  const locked = milestone.referenced;

  function open(next: Mode) {
    setTitle(milestone.title);
    setDescription(milestone.description ?? "");
    setReason("");
    edit.reset();
    cancel.reset();
    remove.reset();
    setMode(next);
  }

  return (
    <li className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-5 items-center justify-center">
          {toggle.isPending ? (
            <LoaderCircle className="size-4 animate-spin text-muted" aria-hidden="true" />
          ) : (
            <input
              type="checkbox"
              aria-label={t("milestoneDone", { title: milestone.title })}
              checked={milestone.is_completed}
              disabled={!canToggle}
              onChange={(event) => toggle.mutate(event.target.checked)}
              className="size-4 accent-racing"
            />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              dir="auto"
              className={
                milestone.is_completed ? "text-sm font-medium text-muted line-through" : "text-sm font-medium text-ink"
              }
            >
              {milestone.title}
            </p>
            <Badge tone={milestone.is_completed ? "success" : "neutral"}>
              {t(milestone.is_completed ? "milestoneCompleted" : "milestoneNotCompleted")}
            </Badge>
            {milestone.is_cancelled ? <Badge tone="neutral">{t("milestoneCancelledBadge")}</Badge> : null}
            {locked ? <Badge tone="info">{t("milestoneReferenced")}</Badge> : null}
          </div>
          {milestone.description ? (
            <p dir="auto" className="text-sm whitespace-pre-line text-muted">
              {milestone.description}
            </p>
          ) : null}
          <p className="text-xs text-muted">
            {t("milestoneCreatedBy", {
              name: memberName(milestone.created_by) || t("someone"),
              date: day(milestone.created_at),
            })}
            {" · "}
            {t("milestoneUpdatedAt", { date: moment(milestone.updated_at) })}
            {milestone.is_completed && milestone.completed_at ? (
              <>
                {" · "}
                {t("milestoneCompletedBy", {
                  name: memberName(milestone.completed_by) || t("someone"),
                  date: moment(milestone.completed_at),
                })}
              </>
            ) : null}
          </p>
        </div>
      </div>
      <MutationError error={toggle.error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShowHistory((value) => !value)}>
          <History className="size-4" aria-hidden="true" />
          {t(showHistory ? "historyHide" : "historyShow")}
        </Button>
        {canToggle ? (
          <Button variant="ghost" size="sm" onClick={() => open("edit")}>
            <Pencil className="size-4" aria-hidden="true" />
            {t("edit")}
          </Button>
        ) : null}
        {canHead ? (
          <>
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => open("cancel")}>
              <X className="size-4" aria-hidden="true" />
              {t("milestoneCancel")}
            </Button>
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => open("delete")}>
              <Trash2 className="size-4" aria-hidden="true" />
              {t("milestoneDelete")}
            </Button>
          </>
        ) : null}
      </div>
      {canHead && locked ? <p className="text-xs text-muted">{t("milestoneReferencedHint")}</p> : null}
      {mode === "edit" ? (
        <Panel
          title={t("milestoneEdit")}
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && !edit.isPending) {
              edit.mutate();
            }
          }}
        >
          <MutationError error={edit.error} />
          <TextField
            label={t("milestoneTitle")}
            required
            maxLength={255}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextArea label={t("milestoneDescription")} value={description} onChange={setDescription} rows={2} />
          <PanelButtons confirm={t("save")} pending={edit.isPending} disabled={!title.trim()} onClose={close} />
        </Panel>
      ) : null}
      {mode === "cancel" && !locked ? (
        <ConfirmDialog
          title={t("milestoneCancelTitle")}
          confirm={t("milestoneCancel")}
          pending={cancel.isPending}
          error={cancel.error}
          disabled={!reason.trim()}
          onConfirm={() => cancel.mutate()}
          onClose={close}
        >
          <p>{t("milestoneCancelHint")}</p>
          <TextArea label={t("reason")} value={reason} onChange={setReason} required rows={2} />
        </ConfirmDialog>
      ) : null}
      {mode === "delete" && !locked ? (
        <ConfirmDialog
          title={t("milestoneDeleteTitle")}
          confirm={t("milestoneDelete")}
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate()}
          onClose={close}
        >
          <p>{t("milestoneDeleteHint")}</p>
        </ConfirmDialog>
      ) : null}
      {showHistory ? <MilestoneHistoryList milestone={milestone.id} /> : null}
    </li>
  );
}

function MilestoneHistoryList({ milestone }: { milestone: number }) {
  const t = useTranslations("Deliverables");
  const { moment } = useDates();
  const history = useQuery({ queryKey: historyKey(milestone), queryFn: () => fetchMilestoneHistory(milestone) });
  if (history.isPending) {
    return <p className="text-xs text-muted">{t("loading")}</p>;
  }
  if (history.isError) {
    return <LoadError error={history.error} />;
  }
  if (history.data.length === 0) {
    return <p className="text-xs text-muted">{t("historyNone")}</p>;
  }
  return (
    <ol className="space-y-2 border-s-2 border-line ps-3 text-xs">
      {history.data.map((row) => (
        <li key={row.id} className="space-y-0.5">
          <p className="text-ink">
            <span className="font-semibold">{memberName(row.changed_by) || t("someone")}</span>{" "}
            <span className="text-muted">· {moment(row.changed_at)}</span>
          </p>
          <p dir="auto" className="text-muted">
            <HistoryChange field={row.field_changed} oldValue={row.old_value ?? ""} newValue={row.new_value ?? ""} />
          </p>
          {row.note ? (
            <p dir="auto" className="text-muted italic">
              {row.note}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** One recorded change: completion and cancellation in words, a title or description as before → after. */
function HistoryChange({ field, oldValue, newValue }: { field: string; oldValue: string; newValue: string }) {
  const t = useTranslations("Deliverables");
  const yes = newValue === "True" || newValue === "true";
  switch (field) {
    case "created":
      return <>{t("historyCreated")}</>;
    case "is_completed":
      return <>{t(yes ? "historyCompleted" : "historyUncompleted")}</>;
    case "is_cancelled":
      return <>{t("historyCancelled")}</>;
    case "title":
    case "description":
      return (
        <>
          {t(field === "title" ? "historyTitle" : "historyDescription")} <bdi>{oldValue || "—"}</bdi> →{" "}
          <bdi>{newValue || "—"}</bdi>
        </>
      );
    default:
      return <>{field}</>;
  }
}
