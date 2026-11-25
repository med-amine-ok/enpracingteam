"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import {
  DeliverableStatusBadge,
  DependencyStateBadge,
  ExecutionStateBadge,
  ProgressMeter,
  ProposalBadge,
} from "../badges";
import {
  DELIVERABLE_STATUSES,
  DEPENDENCY_STATES,
  EXECUTION_STATES,
  type Deliverable,
  type DeliverableStatus,
  type DependencyState,
  type ExecutionState,
} from "../api";
import { useDeliverables } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { CheckField, DeadlineText, decimal, memberName } from "./shared";

type View = "list" | "board";

type Filters = {
  status: DeliverableStatus | "";
  depState: DependencyState | "";
  executionState: ExecutionState | "";
  mine: boolean;
  after: string;
  before: string;
  search: string;
};

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | "" {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

/** The API's query (only what is set): status, dep_state, execution_state, assignee=me, deadline range, search. */
export function deliverableQuery(filters: Filters) {
  const query: Record<string, string> = {};
  if (filters.status) query.status = filters.status;
  if (filters.depState) query.dep_state = filters.depState;
  if (filters.executionState) query.execution_state = filters.executionState;
  if (filters.mine) query.assignee = "me";
  if (filters.after) query.deadline_after = filters.after;
  if (filters.before) query.deadline_before = filters.before;
  if (filters.search.trim()) query.search = filters.search.trim();
  return query as Parameters<typeof useDeliverables>[0];
}

/** /work/deliverables: every visible Deliverable across Work Orders (guide §4, item 8), as a list or a board. */
export function DeliverablesList() {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const params = useSearchParams();
  // A dashboard card may open the list already filtered (?status=submitted&assignee=me).
  const [filters, setFilters] = useState<Filters>(() => ({
    status: pick(params.get("status"), DELIVERABLE_STATUSES),
    depState: pick(params.get("dep_state"), DEPENDENCY_STATES),
    executionState: pick(params.get("execution_state"), EXECUTION_STATES),
    mine: params.get("assignee") === "me",
    after: params.get("deadline_after") ?? "",
    before: params.get("deadline_before") ?? "",
    search: params.get("search") ?? "",
  }));
  const [view, setView] = useState<View>(params.get("view") === "board" ? "board" : "list");
  const deferred = useDeferredValue(filters);
  const deliverables = useDeliverables(deliverableQuery(deferred));
  const set = (change: Partial<Filters>) => setFilters((current) => ({ ...current, ...change }));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <WorkflowHeader current="deliverables" description={t("listIntro")} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label={t("search")}
            type="search"
            value={filters.search}
            onChange={(event) => set({ search: event.target.value })}
          />
          <SelectField
            label={t("workflowStatus")}
            value={filters.status}
            onChange={(event) => set({ status: event.target.value as DeliverableStatus | "" })}
          >
            <option value="">{t("all")}</option>
            {DELIVERABLE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {tWorkflow(`deliverableStatus.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t("dependencyState")}
            value={filters.depState}
            onChange={(event) => set({ depState: event.target.value as DependencyState | "" })}
          >
            <option value="">{t("all")}</option>
            {DEPENDENCY_STATES.map((value) => (
              <option key={value} value={value}>
                {tWorkflow(`dependencyState.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t("executionState")}
            value={filters.executionState}
            onChange={(event) => set({ executionState: event.target.value as ExecutionState | "" })}
          >
            <option value="">{t("all")}</option>
            {EXECUTION_STATES.map((value) => (
              <option key={value} value={value}>
                {tWorkflow(`executionState.${value}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t("deadlineAfter")}
            type="date"
            valueDir="ltr"
            value={filters.after}
            onChange={(event) => set({ after: event.target.value })}
          />
          <TextField
            label={t("deadlineBefore")}
            type="date"
            valueDir="ltr"
            value={filters.before}
            onChange={(event) => set({ before: event.target.value })}
          />
          <div className="flex items-end pb-2.5">
            <CheckField label={t("assignedToMe")} checked={filters.mine} onChange={(mine) => set({ mine })} />
          </div>
          <div className="flex items-end">
            <Segmented
              label={t("viewLabel")}
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: t("viewList") },
                { value: "board", label: t("viewBoard") },
              ]}
            />
          </div>
        </div>
      </Card>
      {deliverables.isPending ? (
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      ) : deliverables.isError ? (
        <LoadError error={deliverables.error} />
      ) : deliverables.data.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t("listEmpty")}</p>
        </Card>
      ) : view === "list" ? (
        <DeliverableTable deliverables={deliverables.data} />
      ) : (
        <DeliverableBoard deliverables={deliverables.data} />
      )}
    </div>
  );
}

/** The table: weight and points columns exist only when the API sent them for some row (guide §2.1). */
export function DeliverableTable({ deliverables }: { deliverables: Deliverable[] }) {
  const t = useTranslations("Deliverables");
  const withWeight = deliverables.some((item) => item.weight != null && item.weight !== "");
  const withPoints = deliverables.some((item) => item.allocated_points != null);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-canvas text-start text-2xs font-semibold tracking-widest text-muted uppercase">
          <tr>
            <th className="px-4 py-3 text-start">{t("deliverable")}</th>
            <th className="px-4 py-3 text-start">{t("workflowStatus")}</th>
            <th className="px-4 py-3 text-start">{t("dependencyState")}</th>
            <th className="px-4 py-3 text-start">{t("executionState")}</th>
            <th className="px-4 py-3 text-start">{t("progress")}</th>
            <th className="px-4 py-3 text-start">{t("deadline")}</th>
            <th className="px-4 py-3 text-start">{t("members")}</th>
            {withWeight ? <th className="px-4 py-3 text-start">{t("weight")}</th> : null}
            {withPoints ? <th className="px-4 py-3 text-start">{t("allocatedPoints")}</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {deliverables.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="px-4 py-3">
                <Link href={`/work/deliverables/${item.id}`} className="font-medium text-navy hover:underline">
                  <bdi dir="auto">{item.code ? `${item.code} · ${item.title}` : item.title}</bdi>
                </Link>
                <p className="text-xs text-muted">
                  <bdi dir="auto">{item.work_order.code || item.work_order.title}</bdi>
                </p>
                <ProposalBadge status={item.proposal_status || null} />
              </td>
              <td className="px-4 py-3">
                <DeliverableStatusBadge status={item.status ?? "draft"} />
              </td>
              <td className="px-4 py-3">
                <DependencyStateBadge state={item.dep_state ?? "no_blocking_dependencies"} />
              </td>
              <td className="px-4 py-3">
                <ExecutionStateBadge state={item.execution_state ?? "normal"} />
              </td>
              <td className="px-4 py-3">
                <ProgressMeter value={item.progress ?? 0} label={t("progress")} />
              </td>
              <td className="px-4 py-3">
                <DeadlineText deliverable={item} />
              </td>
              <td className="px-4 py-3 text-xs text-ink">
                {item.assignees.map((member) => memberName(member)).join(", ") || "—"}
              </td>
              {withWeight ? (
                <td className="px-4 py-3 tabular-nums">
                  {item.weight != null && item.weight !== "" ? t("weightValue", { value: decimal(item.weight) }) : "—"}
                </td>
              ) : null}
              {withPoints ? (
                <td className="px-4 py-3 tabular-nums">
                  {item.allocated_points != null ? decimal(item.allocated_points) : "—"}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The board: one column per real workflow state; dependency and execution stay separate badges on the cards. */
export function DeliverableBoard({ deliverables }: { deliverables: Deliverable[] }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {DELIVERABLE_STATUSES.map((status) => {
        const column = deliverables.filter((item) => (item.status ?? "draft") === status);
        return (
          <section
            key={status}
            aria-label={tWorkflow(`deliverableStatus.${status}`)}
            className="w-72 shrink-0 space-y-3 rounded-lg bg-canvas p-3"
          >
            <h2 className="flex items-center justify-between gap-2">
              <DeliverableStatusBadge status={status} />
              <span className="text-xs font-semibold text-muted tabular-nums">{column.length}</span>
            </h2>
            {column.length === 0 ? <p className="text-xs text-muted">{t("columnEmpty")}</p> : null}
            <ul className="space-y-2">
              {column.map((item) => (
                <li key={item.id}>
                  <BoardCard item={item} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ item }: { item: Deliverable }) {
  const t = useTranslations("Deliverables");
  const depState = item.dep_state ?? "no_blocking_dependencies";
  const execution = item.execution_state ?? "normal";
  return (
    <article className="space-y-2 rounded-lg border border-line bg-surface p-3 shadow-xs">
      <Link href={`/work/deliverables/${item.id}`} className="block text-sm font-medium text-navy hover:underline">
        <bdi dir="auto">{item.code ? `${item.code} · ${item.title}` : item.title}</bdi>
      </Link>
      <p className="text-xs text-muted">
        <bdi dir="auto">{item.work_order.code || item.work_order.title}</bdi>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <ProposalBadge status={item.proposal_status || null} />
        {depState !== "no_blocking_dependencies" ? <DependencyStateBadge state={depState} /> : null}
        {execution !== "normal" ? <ExecutionStateBadge state={execution} /> : null}
      </div>
      <ProgressMeter value={item.progress ?? 0} label={t("progress")} />
      <div className="text-xs text-ink">
        <DeadlineText deliverable={item} />
      </div>
      {item.weight != null && item.weight !== "" ? (
        <p className="text-xs text-muted">{t("weightValue", { value: decimal(item.weight) })}</p>
      ) : null}
      {item.allocated_points != null ? (
        <p className="text-xs text-muted">{t("pointsValue", { value: decimal(item.allocated_points) })}</p>
      ) : null}
    </article>
  );
}
