"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import {
  approveDeliverable,
  decideDependencyProposal,
  deliverableAction,
  workOrderAction,
  type Deliverable,
  type DependencyProposal,
  type WorkOrder,
} from "../api";
import { ProposalBadge } from "../badges";
import { refreshWorkflow, useDeliverable, useProposals } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { ProposalDecision } from "./proposal-decision";
import { MemberPicker, Modal, TextArea, memberName, proposalOutline, useDay } from "./shared";
import { thousandths } from "./work-order-deliverables";

/** The proposals inbox (guide §11): those awaiting the viewer's decision, then the viewer's own. */
export function ProposalsInbox() {
  const t = useTranslations("WorkOrders");
  const proposals = useProposals();
  const data = proposals.data;
  const toDecide = data
    ? data.to_decide.work_orders.length + data.to_decide.deliverables.length + data.to_decide.dependencies.length
    : 0;
  const mine = data ? data.mine.work_orders.length + data.mine.deliverables.length + data.mine.dependencies.length : 0;
  return (
    <div className="space-y-6">
      <WorkflowHeader current="proposals" description={t("inboxIntro")}>
        <Link href="/work/orders/new" className={buttonClassName()}>
          <Plus className="size-4" aria-hidden="true" />
          {t("proposeWorkOrder")}
        </Link>
      </WorkflowHeader>
      {proposals.error ? (
        <LoadError error={proposals.error} />
      ) : !data ? (
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      ) : (
        <>
          {toDecide > 0 ? (
            <Card title={t("toDecide")} description={t("toDecideHint")}>
              <div className="space-y-6">
                <Group title={t("groupWorkOrders")} count={data.to_decide.work_orders.length}>
                  {data.to_decide.work_orders.map((item) => (
                    <WorkOrderProposal key={item.id} item={item} decides />
                  ))}
                </Group>
                <Group title={t("groupDeliverables")} count={data.to_decide.deliverables.length}>
                  {data.to_decide.deliverables.map((item) => (
                    <DeliverableProposal key={item.id} item={item} decides />
                  ))}
                </Group>
                <Group title={t("groupDependencies")} count={data.to_decide.dependencies.length}>
                  {data.to_decide.dependencies.map((item) => (
                    <DependencyProposalItem key={item.id} item={item} />
                  ))}
                </Group>
              </div>
            </Card>
          ) : null}
          <Card title={t("mine")} description={t("mineHint")}>
            {mine === 0 ? (
              <p className="text-sm text-muted">{t("noProposals")}</p>
            ) : (
              <div className="space-y-6">
                <Group title={t("groupWorkOrders")} count={data.mine.work_orders.length}>
                  {data.mine.work_orders.map((item) => (
                    <WorkOrderProposal key={item.id} item={item} />
                  ))}
                </Group>
                <Group title={t("groupDeliverables")} count={data.mine.deliverables.length}>
                  {data.mine.deliverables.map((item) => (
                    <DeliverableProposal key={item.id} item={item} />
                  ))}
                </Group>
                <Group title={t("groupDependencies")} count={data.mine.dependencies.length}>
                  {data.mine.dependencies.map((item) => (
                    <DependencyProposalItem key={item.id} item={item} />
                  ))}
                </Group>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) {
    return null;
  }
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">
        {title} <span className="tabular-nums">({count})</span>
      </h3>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

/** A proposal: dashed, never like official work (guide §11.2). */
function ProposalCard({ children, official }: { children: ReactNode; official?: boolean }) {
  return (
    <li className={cn("space-y-3 rounded-lg p-4", official ? "border border-line" : proposalOutline)}>{children}</li>
  );
}

function Byline({ name, date }: { name: string; date: string }) {
  const t = useTranslations("WorkOrders");
  return <p className="text-xs text-muted">{t("proposedBy", { name, date })}</p>;
}

function WorkOrderProposal({ item, decides }: { item: WorkOrder; decides?: boolean }) {
  const day = useDay();
  const status = item.proposal_status || null;
  return (
    <ProposalCard official={status === "approved"}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/work/orders/${item.id}`} className="font-medium text-ink hover:text-racing">
          <bdi dir="auto">{item.title}</bdi>
        </Link>
        <ProposalBadge status={status} />
        <span className="text-xs text-muted">
          {item.department?.name}
          {item.project ? ` · ${item.project.name}` : ""}
        </span>
      </div>
      <Byline name={memberName(item.proposed_by)} date={day(item.created_at)} />
      {decides ? (
        <ProposalDecision decide={(approve, note) => workOrderAction(item.id, approve ? "approve" : "reject", note)} />
      ) : null}
    </ProposalCard>
  );
}

function DeliverableProposal({ item, decides }: { item: Deliverable; decides?: boolean }) {
  const t = useTranslations("WorkOrders");
  const day = useDay();
  const [approving, setApproving] = useState(false);
  const status = item.proposal_status || null;
  return (
    <ProposalCard official={status === "approved"}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/work/deliverables/${item.id}`} className="font-medium text-ink hover:text-racing">
          <bdi dir="auto">{item.title}</bdi>
        </Link>
        <ProposalBadge status={status} />
        <span className="text-xs text-muted">
          {t("inWorkOrder")}{" "}
          <Link href={`/work/orders/${item.work_order.id}`} className="hover:text-racing">
            <bdi dir="auto">{item.work_order.code ?? item.work_order.title}</bdi>
          </Link>
        </span>
      </div>
      <Byline name={memberName(item.proposed_by)} date={day(item.created_at)} />
      {decides ? (
        <ProposalDecision
          onApprove={() => setApproving(true)}
          decide={(approve, note) =>
            approve ? approveDeliverable(item.id, { note, submit: true }) : deliverableAction(item.id, "reject", note)
          }
        />
      ) : null}
      {approving ? <ApproveDeliverableDialog item={item} onClose={() => setApproving(false)} /> : null}
    </ProposalCard>
  );
}

/** Approving a Deliverable sets what makes it official (spec §4.2): criteria, dates, weight and members. */
export function ApproveDeliverableDialog({ item, onClose }: { item: Deliverable; onClose: () => void }) {
  const t = useTranslations("WorkOrders");
  const detail = useDeliverable(item.id);
  return (
    <Modal title={t("approveDeliverableTitle", { title: item.title })} onClose={onClose}>
      {detail.error ? (
        <LoadError error={detail.error} />
      ) : !detail.data ? (
        <LinesPlaceholder lines={4} />
      ) : (
        <ApproveDeliverableForm
          item={item}
          criteria={detail.data.acceptance_criteria ?? ""}
          start={detail.data.start_date ?? ""}
          deadline={detail.data.original_deadline ?? ""}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function ApproveDeliverableForm({
  item,
  criteria: proposedCriteria,
  start: proposedStart,
  deadline: proposedDeadline,
  onClose,
}: {
  item: Deliverable;
  criteria: string;
  start: string;
  deadline: string;
  onClose: () => void;
}) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [criteria, setCriteria] = useState(proposedCriteria);
  const [start, setStart] = useState(proposedStart);
  const [deadline, setDeadline] = useState(proposedDeadline);
  const [weight, setWeight] = useState("");
  const [members, setMembers] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const weightValue = thousandths(weight);
  const datesWrong = !!start && !!deadline && deadline < start;
  const approve = useMutation({
    mutationFn: () =>
      approveDeliverable(item.id, {
        acceptance_criteria: criteria,
        start_date: start || null,
        original_deadline: deadline || null,
        ...(weight.trim() && weightValue !== null ? { weight: (weightValue / 1000).toFixed(3) } : {}),
        member_ids: members,
        note: note.trim(),
        submit: true,
      }),
    onSuccess: async () => {
      await refreshWorkflow(queryClient);
      onClose();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        approve.mutate();
      }}
    >
      {approve.isError ? <Alert tone="error">{errorText(approve.error, tErrors)}</Alert> : null}
      <TextArea label={t("acceptanceCriteria")} value={criteria} onChange={setCriteria} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label={t("startDate")}
          type="date"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
        <TextField
          label={t("deadline")}
          type="date"
          min={start || undefined}
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
          aria-invalid={datesWrong || undefined}
        />
        <TextField
          label={t("weightPercent")}
          inputMode="decimal"
          valueDir="ltr"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          aria-invalid={weightValue === null || undefined}
        />
      </div>
      {datesWrong ? <p className="text-xs text-racing-strong">{t("deadlineBeforeStart")}</p> : null}
      {weightValue === null ? <p className="text-xs text-racing-strong">{t("weightInvalid")}</p> : null}
      <MemberPicker label={t("members")} value={members} onChange={setMembers} />
      <TextArea label={t("decisionNote")} rows={2} value={note} onChange={setNote} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={approve.isPending}>
          {t("cancel")}
        </Button>
        <Button type="submit" loading={approve.isPending} disabled={weightValue === null || datesWrong}>
          {t("approve")}
        </Button>
      </div>
    </form>
  );
}

function DependencyProposalItem({ item }: { item: DependencyProposal }) {
  const tFlow = useTranslations("Workflow");
  const day = useDay();
  const status = item.status ?? null;
  const end = (value: DependencyProposal["proposed_prerequisite"]) => (
    <Link href={`/work/deliverables/${value.id}`} className="font-medium text-ink hover:text-racing">
      {value.code ? (
        <span className="me-1.5 font-mono text-xs text-muted" dir="ltr">
          {value.code}
        </span>
      ) : null}
      <bdi dir="auto">{value.title}</bdi>
    </Link>
  );
  return (
    <ProposalCard official={status === "approved"}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {end(item.proposed_prerequisite)}
        <ArrowRight className="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
        {end(item.proposed_dependent)}
        {item.proposed_link_type ? (
          <Badge tone="info">{tFlow(`dependencyType.${item.proposed_link_type}`)}</Badge>
        ) : null}
        <ProposalBadge status={status} />
      </div>
      <Byline name={memberName(item.proposed_by)} date={day(item.created_at)} />
      {item.justification ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {item.justification}
        </p>
      ) : null}
      {item.decision_note ? (
        <p dir="auto" className="text-xs whitespace-pre-line text-muted">
          {item.decision_note}
        </p>
      ) : null}
      {item.can_decide && status === "pending_review" ? (
        <ProposalDecision decide={(approve, note) => decideDependencyProposal(item.id, approve, note)} />
      ) : null}
    </ProposalCard>
  );
}
