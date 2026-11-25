"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { Link } from "@/i18n/navigation";
import { DependencyStateBadge, DeliverableStatusBadge, ExecutionStateBadge } from "../badges";
import type { DeliverableDetail } from "../api";
import { useDeliverable } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { DeliverableActions, EditDetails, ProposalBanner } from "./actions";
import { ActivityTimeline } from "./activity";
import { Assignments } from "./assignments";
import { Blockers } from "./blockers";
import { Dependencies, endName } from "./dependencies";
import { Milestones } from "./milestones";
import { ProgressSlider } from "./progress-slider";
import { Relief } from "./relief";
import { ReviewPanel, SubmitForm, Submissions } from "./submissions";
import { Detail, decimal, memberName, useDates } from "./shared";

/** /work/deliverables/[id]: the principal execution page (guide §6.2). */
export function DeliverableView() {
  const t = useTranslations("Deliverables");
  const params = useParams<{ id: string }>();
  const id = Number(params.id) || 0;
  const deliverable = useDeliverable(id);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <BackLink href="/work/deliverables">{t("backToList")}</BackLink>
      {deliverable.isPending ? (
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      ) : deliverable.isError ? (
        <LoadError error={deliverable.error} />
      ) : (
        <DeliverablePage deliverable={deliverable.data} />
      )}
    </div>
  );
}

export function DeliverablePage({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const [editing, setEditing] = useState(false);
  const { rights } = deliverable;
  return (
    <div className="space-y-6">
      <WorkflowHeader
        current="deliverables"
        title={
          <bdi dir="auto">{deliverable.code ? `${deliverable.code} · ${deliverable.title}` : deliverable.title}</bdi>
        }
      />
      <Header deliverable={deliverable} />
      <ProposalBanner deliverable={deliverable} />
      <DeliverableActions deliverable={deliverable} onEdit={() => setEditing(true)} />
      {editing && rights.edit ? <EditDetails deliverable={deliverable} onClose={() => setEditing(false)} /> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title={t("aboutTitle")}>
            <div className="space-y-4">
              <Text label={t("description")} value={deliverable.description} empty={t("noDescription")} />
              <Text label={t("acceptanceCriteria")} value={deliverable.acceptance_criteria} empty={t("noCriteria")} />
            </div>
          </Card>
          <ProgressSlider deliverable={deliverable} />
          <Milestones deliverable={deliverable} />
          {rights.review ? <ReviewPanel deliverable={deliverable} /> : null}
          {rights.submit ? <SubmitForm deliverable={deliverable} /> : null}
          <Submissions deliverable={deliverable} />
        </div>
        <div className="space-y-6">
          <Context deliverable={deliverable} />
          <Assignments deliverable={deliverable} />
          <Dependencies deliverable={deliverable} />
          <Relief deliverable={deliverable} />
          <Blockers deliverable={deliverable} />
          <ActivityTimeline deliverable={deliverable.id} />
        </div>
      </div>
    </div>
  );
}

/** The three dimensions side by side, never merged (guide §1.3), the Work Order and the members. */
function Header({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const workOrder = deliverable.work_order;
  return (
    <Card>
      {/* Long state names (in French, in Arabic) wrap instead of running into the next column. */}
      <dl className="grid gap-4 sm:grid-cols-3 2xl:grid-cols-5 [&_dd_span]:whitespace-normal">
        <Detail label={t("workflowStatus")}>
          <DeliverableStatusBadge status={deliverable.status ?? "draft"} />
        </Detail>
        <Detail label={t("dependencyState")}>
          <DependencyStateBadge state={deliverable.dep_state ?? "no_blocking_dependencies"} />
        </Detail>
        <Detail label={t("executionState")}>
          <ExecutionStateBadge state={deliverable.execution_state ?? "normal"} />
        </Detail>
        <Detail label={t("workOrder")}>
          <Link href={`/work/orders/${workOrder.id}`} className="text-navy hover:underline">
            <bdi dir="auto">{endName(workOrder)}</bdi>
          </Link>
        </Detail>
        <Detail label={t("members")}>
          {deliverable.assignees.length === 0 ? (
            <span className="text-muted">{t("assignmentsNone")}</span>
          ) : (
            <ul className="space-y-1">
              {deliverable.assignees.map((member) => (
                <li key={member.id} className="flex items-center gap-2">
                  <Avatar firstName={member.first_name} lastName={member.last_name} seed={member.id} size="sm" />
                  {memberName(member)}
                </li>
              ))}
            </ul>
          )}
        </Detail>
      </dl>
    </Card>
  );
}

function Text({ label, value, empty }: { label: string; value: string | undefined; empty: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">{label}</h3>
      {value ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {value}
        </p>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}

/** Deadlines (the original never hidden), and weight and points only when the API sends them (guide §2.1). */
function Context({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const { day } = useDates();
  const shifted = !!deliverable.effective_deadline && deliverable.effective_deadline !== deliverable.original_deadline;
  return (
    <Card title={t("deadlinesTitle")}>
      <dl className="grid gap-3">
        {deliverable.start_date ? <Detail label={t("startDate")}>{day(deliverable.start_date)}</Detail> : null}
        <Detail label={tWorkflow("originalDeadline")}>
          {deliverable.original_deadline ? day(deliverable.original_deadline) : t("noDeadline")}
        </Detail>
        {shifted ? (
          <>
            <Detail label={tWorkflow("effectiveDeadline")}>{day(deliverable.effective_deadline)}</Detail>
            {deliverable.relief_days ? (
              <p className="text-xs text-muted">{tWorkflow("reliefDays", { days: deliverable.relief_days })}</p>
            ) : null}
          </>
        ) : null}
        {deliverable.weight != null && deliverable.weight !== "" ? (
          <Detail label={t("weight")}>{t("weightValue", { value: decimal(deliverable.weight) })}</Detail>
        ) : null}
        {deliverable.allocated_points != null ? (
          <Detail label={t("allocatedPoints")}>{decimal(deliverable.allocated_points)}</Detail>
        ) : null}
      </dl>
    </Card>
  );
}
