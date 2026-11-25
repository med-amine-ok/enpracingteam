"use client";

import { ArrowRight, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { Link } from "@/i18n/navigation";
import { DeliverableStates, ProgressMeter } from "../badges";
import { DELIVERABLE_STATUSES, deliverableAction, type Deliverable, type DeliverableStatus } from "../api";
import { useDeliverables } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { DeadlineText, MutationError, useWorkMutation } from "./shared";

/** Work Orders in which a Deliverable may be started (spec §3.3: active or in progress). */
const RUNNING = new Set(["active", "in_progress"]);

/** What an assigned member does next with a Deliverable, by its workflow status. */
export type NextAction = "waitReady" | "start" | "resume" | "work" | "awaitReview" | "done" | "none";

export function nextAction(item: Deliverable): NextAction {
  switch (item.status ?? "draft") {
    case "draft":
      return "waitReady";
    case "ready":
      return RUNNING.has(item.work_order.status ?? "") ? "start" : "waitReady";
    case "revision_requested":
      return RUNNING.has(item.work_order.status ?? "") ? "resume" : "work";
    case "in_progress":
      return "work";
    case "submitted":
      return "awaitReview";
    case "validated":
      return "done";
    default:
      return "none";
  }
}

const MY_FILTERS = { assignee: "me" } as Parameters<typeof useDeliverables>[0];

/** /work/my: the viewer's Deliverables, grouped by workflow status, each with its next step. */
export function MyWork() {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const deliverables = useDeliverables(MY_FILTERS);
  const groups = DELIVERABLE_STATUSES.map((status) => ({
    status,
    items: (deliverables.data ?? []).filter((item) => (item.status ?? "draft") === status),
  })).filter((group) => group.items.length > 0);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <WorkflowHeader current="myWork" description={t("myWorkIntro")} />
      {deliverables.isPending ? (
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      ) : deliverables.isError ? (
        <LoadError error={deliverables.error} />
      ) : groups.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t("myWorkEmpty")}</p>
        </Card>
      ) : (
        groups.map((group) => (
          <Card
            key={group.status}
            title={tWorkflow(`deliverableStatus.${group.status}`)}
            action={<span className="text-sm font-semibold text-muted tabular-nums">{group.items.length}</span>}
          >
            <ul className="divide-y divide-line">
              {group.items.map((item) => (
                <MyItem key={item.id} item={item} status={group.status} />
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}

function MyItem({ item, status }: { item: Deliverable; status: DeliverableStatus }) {
  const t = useTranslations("Deliverables");
  const next = nextAction(item);
  const start = useWorkMutation(() => deliverableAction(item.id, "start"));
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link href={`/work/deliverables/${item.id}`} className="font-medium text-navy hover:underline">
            <bdi dir="auto">{item.code ? `${item.code} · ${item.title}` : item.title}</bdi>
          </Link>
          <p className="text-xs text-muted">
            <bdi dir="auto">{item.work_order.code || item.work_order.title}</bdi>
          </p>
          <DeliverableStates
            status={status}
            depState={item.dep_state ?? "no_blocking_dependencies"}
            executionState={item.execution_state ?? "normal"}
          />
        </div>
        <div className="space-y-1 text-end text-xs text-ink">
          <DeadlineText deliverable={item} />
          <ProgressMeter value={item.progress ?? 0} label={t("progress")} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {next === "start" || next === "resume" ? (
          <Button size="sm" loading={start.isPending} onClick={() => start.mutate()}>
            <Play className="size-4" aria-hidden="true" />
            {t(next)}
          </Button>
        ) : next === "none" ? null : (
          <Link
            href={`/work/deliverables/${item.id}`}
            className="inline-flex items-center gap-1 text-sm text-navy hover:underline"
          >
            {t(`next.${next}`)}
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        )}
      </div>
      <MutationError error={start.error} />
    </li>
  );
}
