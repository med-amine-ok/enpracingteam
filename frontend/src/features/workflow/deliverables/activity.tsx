"use client";

import { useTranslations } from "next-intl";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import type { Activity, WorkAction } from "../api";
import { useDeliverableActivity } from "../queries";
import { memberName, useDates } from "./shared";

// Weights and budgets stay out of the timeline's values (guide §2.1): the line says what changed, not to what.
const HIDDEN_VALUES = new Set<WorkAction>(["weight_changed", "budget_changed"]);

/** A value of the log written plainly when it is a simple one (a title, a status, a number). */
function plain(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, item]) => typeof item === "string" || typeof item === "number",
    );
    if (entries.length === 1) {
      return String(entries[0][1]);
    }
  }
  return null;
}

/** Who did what and when on this Deliverable (guide §15: Activity Timeline). */
export function ActivityTimeline({ deliverable }: { deliverable: number }) {
  const t = useTranslations("Deliverables");
  const activity = useDeliverableActivity(deliverable);
  return (
    <Card title={t("activityTitle")}>
      {activity.isPending ? <LinesPlaceholder lines={3} /> : null}
      {activity.isError ? <LoadError error={activity.error} /> : null}
      {activity.data && activity.data.length === 0 ? <p className="text-sm text-muted">{t("activityNone")}</p> : null}
      {activity.data && activity.data.length > 0 ? (
        <ol className="space-y-3 border-s-2 border-line ps-3">
          {activity.data.map((row) => (
            <ActivityRow key={row.id} row={row} />
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

function ActivityRow({ row }: { row: Activity }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const { moment } = useDates();
  const before = HIDDEN_VALUES.has(row.action) ? null : plain(row.old_value);
  const after = HIDDEN_VALUES.has(row.action) ? null : plain(row.new_value);
  return (
    <li className="space-y-0.5 text-sm">
      <p className="text-ink">
        <span className="font-semibold">{memberName(row.actor) || tWorkflow("system")}</span>{" "}
        {tWorkflow(`action.${row.action}`)}{" "}
        <span className="text-muted">{tWorkflow(`entity.${row.entity_type}`).toLowerCase()}</span>
      </p>
      {before || after ? (
        <p dir="auto" className="text-xs text-muted">
          {before ? <bdi>{before}</bdi> : null}
          {before && after ? " → " : null}
          {after ? <bdi>{after}</bdi> : null}
        </p>
      ) : null}
      {row.reason ? (
        <p dir="auto" className="text-xs text-ink italic">
          {t("reasonQuoted", { reason: row.reason })}
        </p>
      ) : null}
      <p className="text-xs text-muted">{moment(row.occurred_at)}</p>
    </li>
  );
}
