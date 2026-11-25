"use client";

import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  BlockerImpact,
  BlockerSeverity,
  BlockerStatus,
  DeliverableStatus,
  DependencyState,
  ExecutionState,
  ProposalStatus,
  ReliefStatus,
  WorkOrderStatus,
} from "./api";

const WORK_ORDER_TONES: Record<WorkOrderStatus, BadgeTone> = {
  draft: "neutral",
  planning: "info",
  active: "success",
  in_progress: "info",
  completed: "strong",
  cancelled: "neutral",
};

const DELIVERABLE_TONES: Record<DeliverableStatus, BadgeTone> = {
  draft: "neutral",
  ready: "info",
  in_progress: "info",
  submitted: "warning",
  revision_requested: "danger",
  validated: "success",
  cancelled: "neutral",
};

const DEPENDENCY_TONES: Record<DependencyState, BadgeTone> = {
  no_blocking_dependencies: "neutral",
  waiting: "warning",
  released: "success",
};

const EXECUTION_TONES: Record<ExecutionState, BadgeTone> = {
  normal: "neutral",
  partially_blocked: "warning",
  fully_blocked: "danger",
};

const PROPOSAL_TONES: Record<ProposalStatus, BadgeTone> = {
  draft: "neutral",
  pending_review: "warning",
  approved: "success",
  rejected: "danger",
};

const SEVERITY_TONES: Record<BlockerSeverity, BadgeTone> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "strong",
};

const BLOCKER_TONES: Record<BlockerStatus, BadgeTone> = { open: "warning", resolved: "success", cancelled: "neutral" };
const IMPACT_TONES: Record<BlockerImpact, BadgeTone> = { none: "neutral", partial: "warning", full: "danger" };
const RELIEF_TONES: Record<ReliefStatus, BadgeTone> = { claimed: "warning", approved: "success", rejected: "neutral" };

/** The lifecycle of a Work Order (spec §3.3). */
export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const t = useTranslations("Workflow");
  return <Badge tone={WORK_ORDER_TONES[status]}>{t(`workOrderStatus.${status}`)}</Badge>;
}

/** The workflow of a Deliverable: never "blocked" nor "waiting" (spec §4.3, guide §8). */
export function DeliverableStatusBadge({ status }: { status: DeliverableStatus }) {
  const t = useTranslations("Workflow");
  return <Badge tone={DELIVERABLE_TONES[status]}>{t(`deliverableStatus.${status}`)}</Badge>;
}

/** The computed dependency state, read-only (guide §15.3). */
export function DependencyStateBadge({ state }: { state: DependencyState }) {
  const t = useTranslations("Workflow");
  return <Badge tone={DEPENDENCY_TONES[state]}>{t(`dependencyState.${state}`)}</Badge>;
}

/** What actual blockers prevent (guide §8.3). */
export function ExecutionStateBadge({ state }: { state: ExecutionState }) {
  const t = useTranslations("Workflow");
  return <Badge tone={EXECUTION_TONES[state]}>{t(`executionState.${state}`)}</Badge>;
}

/** A proposal is never shown as official work (guide §11.2): "Proposal · pending review". */
export function ProposalBadge({ status }: { status: ProposalStatus | null | undefined }) {
  const t = useTranslations("Workflow");
  if (!status || status === "approved") {
    return null;
  }
  return (
    <Badge tone={PROPOSAL_TONES[status]} className="border border-dashed border-current">
      {t("proposal")} · {t(`proposalStatus.${status}`)}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: BlockerSeverity }) {
  const t = useTranslations("Workflow");
  return <Badge tone={SEVERITY_TONES[severity]}>{t(`severity.${severity}`)}</Badge>;
}

export function BlockerStatusBadge({ status }: { status: BlockerStatus }) {
  const t = useTranslations("Workflow");
  return <Badge tone={BLOCKER_TONES[status]}>{t(`blockerStatus.${status}`)}</Badge>;
}

export function ImpactBadge({ impact }: { impact: BlockerImpact }) {
  const t = useTranslations("Workflow");
  return <Badge tone={IMPACT_TONES[impact]}>{t(`impact.${impact}`)}</Badge>;
}

export function ReliefStatusBadge({ status }: { status: ReliefStatus }) {
  const t = useTranslations("Workflow");
  return <Badge tone={RELIEF_TONES[status]}>{t(`reliefStatus.${status}`)}</Badge>;
}

/** The three dimensions side by side, never merged (guide §1.3, §8.4). */
export function DeliverableStates({
  status,
  depState,
  executionState,
  className,
}: {
  status: DeliverableStatus;
  depState: DependencyState;
  executionState: ExecutionState;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <DeliverableStatusBadge status={status} />
      {depState !== "no_blocking_dependencies" ? <DependencyStateBadge state={depState} /> : null}
      {executionState !== "normal" ? <ExecutionStateBadge state={executionState} /> : null}
    </span>
  );
}

/** A read-only progress bar with its number (guide §15: progress is not points). `null`: planning. */
export function ProgressMeter({
  value,
  label,
  className,
}: {
  value: number | null | undefined;
  label: string;
  className?: string;
}) {
  const t = useTranslations("Workflow");
  if (value == null) {
    return <span className={cn("text-xs text-muted", className)}>{t("planningProgress")}</span>;
  }
  const rounded = Math.round(value);
  return (
    <span className={cn("inline-flex min-w-28 items-center gap-2", className)}>
      <span
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
      >
        <span
          className="block h-full rounded-full bg-racing"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </span>
      <span className="text-xs font-semibold text-ink tabular-nums">{rounded} %</span>
    </span>
  );
}
