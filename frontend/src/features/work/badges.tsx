"use client";

import { Ban } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type {
  BlockerSeverity,
  BlockerStatus,
  ProjectCategory,
  ProjectHealth,
  ProjectStatus,
  SubsystemStatus,
  TaskHealth,
  TaskPoints,
  TaskPriority,
  TaskStatus,
} from "./api";

const TASK_STATUS_TONES: Record<TaskStatus, BadgeTone> = {
  planned: "neutral",
  in_progress: "info",
  submitted: "warning",
  needs_revision: "danger",
  validated: "success",
};

const PROJECT_STATUS_TONES: Record<ProjectStatus, BadgeTone> = {
  planned: "neutral",
  active: "success",
  on_hold: "warning",
  completed: "strong",
};

const SUBSYSTEM_STATUS_TONES: Record<SubsystemStatus, BadgeTone> = {
  planned: "neutral",
  active: "success",
  blocked: "danger",
  complete: "strong",
};

const PRIORITY_TONES: Record<TaskPriority, BadgeTone> = { high: "danger", medium: "warning", low: "neutral" };

const SEVERITY_TONES: Record<BlockerSeverity, BadgeTone> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "strong",
};

const BLOCKER_STATUS_TONES: Record<BlockerStatus, BadgeTone> = {
  open: "warning",
  validated: "danger",
  rejected: "neutral",
  resolved: "success",
};

// The Figma's health colours: late in red, at risk or due soon in amber, on time in green.
const HEALTH_TONES: Record<TaskHealth, BadgeTone> = {
  on_track: "info",
  at_risk: "warning",
  due_soon: "warning",
  overdue: "danger",
  done_on_time: "success",
  done_late: "danger",
};

/** How the task is doing against its due date, its progress and its blockers. */
export function HealthBadge({ health }: { health: TaskHealth }) {
  const t = useTranslations("Work");
  return <Badge tone={HEALTH_TONES[health]}>{t(`health.${health}`)}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const t = useTranslations("Work");
  return <Badge tone={TASK_STATUS_TONES[status]}>{t(`taskStatus.${status}`)}</Badge>;
}

/** A task with a blocker not resolved yet: shown on top of its status. */
export function BlockedBadge() {
  const t = useTranslations("Work");
  return (
    <Badge tone="danger">
      <Ban className="size-3" aria-hidden="true" />
      {t("blocked")}
    </Badge>
  );
}

/** Its points (1 to 5), with what they mean on hover. */
export function PointsBadge({ points }: { points: TaskPoints | null | undefined }) {
  const t = useTranslations("Work");
  if (!points) {
    return null;
  }
  return (
    <span title={t(`pointsLevel.${points}`)}>
      <Badge tone="strong">{t("points", { count: points, shown: String(points) })}</Badge>
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: BlockerSeverity }) {
  const t = useTranslations("Work");
  return <Badge tone={SEVERITY_TONES[severity]}>{t(`severity.${severity}`)}</Badge>;
}

export function BlockerStatusBadge({ status }: { status: BlockerStatus }) {
  const t = useTranslations("Work");
  return <Badge tone={BLOCKER_STATUS_TONES[status]}>{t(`blockerStatus.${status}`)}</Badge>;
}

const PROJECT_HEALTH_TONES: Record<ProjectHealth, BadgeTone> = {
  planning: "neutral",
  on_track: "success",
  at_risk: "danger",
  on_hold: "warning",
  completed: "info",
};

/** The Figma's state of a project: on track or at risk while active (apps/projects/health.py). */
export function ProjectHealthBadge({ health }: { health: ProjectHealth }) {
  const t = useTranslations("Work");
  return <Badge tone={PROJECT_HEALTH_TONES[health]}>{t(`projectHealth.${health}`)}</Badge>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations("Work");
  return <Badge tone={PROJECT_STATUS_TONES[status]}>{t(`projectStatus.${status}`)}</Badge>;
}

export function SubsystemStatusBadge({ status }: { status: SubsystemStatus }) {
  const t = useTranslations("Work");
  return <Badge tone={SUBSYSTEM_STATUS_TONES[status]}>{t(`subsystemStatus.${status}`)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority | "" | null | undefined }) {
  const t = useTranslations("Work");
  if (!priority) {
    return null;
  }
  return <Badge tone={PRIORITY_TONES[priority]}>{t(`priority.${priority}`)}</Badge>;
}

export function CategoryBadge({ category }: { category: ProjectCategory }) {
  const t = useTranslations("Work");
  return <Badge tone="info">{t(`category.${category}`)}</Badge>;
}
