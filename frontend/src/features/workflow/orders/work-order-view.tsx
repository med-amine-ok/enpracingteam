"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Pencil, Play, Send, Workflow as WorkflowIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { tabBarClassName, tabClassName } from "@/components/ui/page-tabs";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { workOrderAction, type WorkOrderDetail } from "../api";
import { ExecutionStateBadge, ProgressMeter, ProposalBadge, WorkOrderStatusBadge } from "../badges";
import { refreshWorkflow, useWorkOrder } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { ProposalDecision } from "./proposal-decision";
import { Fact, Modal, TextArea, isProposal, memberName, proposalOutline, useDay } from "./shared";
import { WorkOrderActivity, WorkOrderDependencies } from "./work-order-activity";
import { WorkOrderDeliverables } from "./work-order-deliverables";
import { EditWorkOrder } from "./work-order-form";
import { WorkOrderOverview } from "./work-order-overview";

const TABS = ["overview", "deliverables", "dependencies", "activity"] as const;
type Tab = (typeof TABS)[number];

/** A Work Order (guide §6.1): its header, its proposal state, its actions and four tabs. */
export function WorkOrderView() {
  const t = useTranslations("WorkOrders");
  const { id } = useParams<{ id: string }>();
  const order = useWorkOrder(Number(id));
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);

  if (order.isError) {
    return (
      <div className="space-y-6">
        <BackLink href="/work/orders">{t("backToList")}</BackLink>
        <LoadError error={order.error} />
      </div>
    );
  }
  if (!order.data) {
    return (
      <Card>
        <LinesPlaceholder lines={5} />
      </Card>
    );
  }
  const data = order.data;
  return (
    <div className="space-y-6">
      <BackLink href="/work/orders">{t("backToList")}</BackLink>
      <WorkflowHeader current="workOrders" title={<bdi dir="auto">{data.title}</bdi>}>
        <WorkOrderActions order={data} onEdit={data.rights.edit && !editing ? () => setEditing(true) : undefined} />
      </WorkflowHeader>
      <WorkOrderSummary order={data} />
      <ProposalBanner order={data} />
      {editing ? <EditWorkOrder order={data} onDone={() => setEditing(false)} /> : null}

      <div role="tablist" aria-label={t("tabsLabel")} className={tabBarClassName}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`wo-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`wo-panel-${key}`}
            onClick={() => setTab(key)}
            className={tabClassName(tab === key)}
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`wo-panel-${tab}`} aria-labelledby={`wo-tab-${tab}`}>
        {tab === "overview" ? <WorkOrderOverview order={data} /> : null}
        {tab === "deliverables" ? <WorkOrderDeliverables order={data} /> : null}
        {tab === "dependencies" ? <WorkOrderDependencies order={data} /> : null}
        {tab === "activity" ? <WorkOrderActivity order={data} /> : null}
      </div>
    </div>
  );
}

function WorkOrderSummary({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  const tFlow = useTranslations("Workflow");
  const day = useDay();
  return (
    <Card className={cn(isProposal(order.proposal_status) && proposalOutline)}>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("code")}>
          <span className="font-mono tabular-nums" dir="ltr">
            {order.code ?? "—"}
          </span>
        </Fact>
        <Fact label={t("project")}>{order.project?.name ?? t("noProject")}</Fact>
        <Fact label={t("department")}>{order.department?.name}</Fact>
        <Fact label={t("status")}>
          <span className="flex flex-wrap gap-1.5">
            {order.status ? <WorkOrderStatusBadge status={order.status} /> : null}
            <ProposalBadge status={order.proposal_status || null} />
            {order.execution_state && order.execution_state !== "normal" ? (
              <ExecutionStateBadge state={order.execution_state} />
            ) : null}
          </span>
        </Fact>
        <Fact label={tFlow("progress")}>
          <ProgressMeter value={order.progress} label={t("progressOf", { title: order.title })} />
        </Fact>
        <Fact label={t("activeDeliverables")}>
          <span className="tabular-nums">{order.deliverable_count}</span>
        </Fact>
        {/* The budget only for whoever receives it (guide §2.1): no trace of it otherwise. */}
        {"budget_tier" in order ? (
          <Fact label={t("budget")}>
            {order.budget_tier != null ? t("budgetValue", { tier: order.budget_tier }) : t("budgetUnset")}
          </Fact>
        ) : null}
        <Fact label={t("nextDeadline")}>{day(order.next_deadline) || "—"}</Fact>
        {order.priority ? <Fact label={t("priority")}>{tFlow(`priority.${order.priority}`)}</Fact> : null}
        {order.coordinator ? (
          <Fact label={t("coordinator")}>
            <bdi>{memberName(order.coordinator)}</bdi>
          </Fact>
        ) : null}
        <Fact label={t("createdBy")}>
          {t("createdByValue", {
            name: memberName(order.created_by ?? order.proposed_by) || tFlow("system"),
            date: day(order.created_at),
          })}
        </Fact>
      </dl>
    </Card>
  );
}

/** A Work Order that is still a proposal: its state, the decision for the Head, "Submit" for its author. */
export function ProposalBanner({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const day = useDay();
  const submit = useMutation({
    mutationFn: () => workOrderAction(order.id, "submit-proposal"),
    onSuccess: () => refreshWorkflow(queryClient),
  });
  const status = order.proposal_status;
  if (!status || status === "approved") {
    return null;
  }
  return (
    <section
      aria-label={t("proposalTitle")}
      className={cn("space-y-3 rounded-lg bg-warning-soft/40 p-5", proposalOutline)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ProposalBadge status={status} />
        {order.proposed_by ? (
          <span className="text-sm text-muted">
            {t("proposedBy", {
              name: memberName(order.proposed_by),
              date: day(order.proposal_submitted_at ?? order.created_at),
            })}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-ink">{t(`proposalExplain.${status}`)}</p>
      {order.proposal_note ? (
        <p className="text-sm text-ink">
          <span className="font-semibold">{t("decisionNoteLabel")} </span>
          <bdi dir="auto" className="whitespace-pre-line">
            {order.proposal_note}
          </bdi>
        </p>
      ) : null}
      {order.rights.decide ? (
        <>
          {order.rights.edit ? <p className="text-xs text-muted">{t("editBeforeDeciding")}</p> : null}
          <ProposalDecision
            decide={(approve, note) => workOrderAction(order.id, approve ? "approve" : "reject", note)}
          />
        </>
      ) : null}
      {order.rights.submit_proposal ? (
        <div className="space-y-2">
          {submit.isError ? <Alert tone="error">{errorText(submit.error, tErrors)}</Alert> : null}
          <Button size="sm" onClick={() => submit.mutate()} loading={submit.isPending}>
            <Send className="size-4" aria-hidden="true" />
            {t("submitProposal")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

type LifecycleAction = "to-planning" | "activate" | "cancel";

/** The lifecycle actions the viewer may take (rights from the API): planning, activation, cancellation. */
function WorkOrderActions({ order, onEdit }: { order: WorkOrderDetail; onEdit?: () => void }) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const act = useMutation({
    mutationFn: (action: LifecycleAction) =>
      workOrderAction(order.id, action, action === "cancel" ? reason.trim() : ""),
    onSuccess: async () => {
      setCancelling(false);
      setReason("");
      await refreshWorkflow(queryClient);
    },
  });
  const pending = (action: LifecycleAction) => act.isPending && act.variables === action;
  const canPlan = order.rights.activate && order.status === "draft";
  if (!onEdit && !canPlan && !order.rights.activate && !order.rights.cancel) {
    return null;
  }
  return (
    <div className="flex max-w-xl flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {onEdit ? (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            {t("edit")}
          </Button>
        ) : null}
        {canPlan ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act.mutate("to-planning")}
            loading={pending("to-planning")}
            disabled={act.isPending}
          >
            <WorkflowIcon className="size-4" aria-hidden="true" />
            {t("toPlanning")}
          </Button>
        ) : null}
        {order.rights.activate ? (
          <Button
            size="sm"
            onClick={() => act.mutate("activate")}
            loading={pending("activate")}
            disabled={act.isPending}
          >
            <Play className="size-4" aria-hidden="true" />
            {t("activate")}
          </Button>
        ) : null}
        {order.rights.cancel ? (
          <Button size="sm" variant="ghost" onClick={() => setCancelling(true)} disabled={act.isPending}>
            <Ban className="size-4" aria-hidden="true" />
            {t("cancelWorkOrder")}
          </Button>
        ) : null}
      </div>
      {act.isError && !cancelling ? (
        <Alert tone="error" className="w-full">
          {act.variables === "activate" ? <p className="font-semibold">{t("activateFailed")}</p> : null}
          <p>{errorText(act.error, tErrors)}</p>
        </Alert>
      ) : null}
      {cancelling ? (
        <Modal title={t("cancelTitle")} onClose={() => setCancelling(false)}>
          <p className="text-sm text-ink">{t("cancelText")}</p>
          <TextArea label={t("reason")} required rows={3} value={reason} onChange={setReason} />
          {act.isError ? <Alert tone="error">{errorText(act.error, tErrors)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelling(false)} disabled={act.isPending}>
              {t("keep")}
            </Button>
            <Button onClick={() => act.mutate("cancel")} loading={pending("cancel")} disabled={!reason.trim()}>
              {t("cancelConfirm")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
