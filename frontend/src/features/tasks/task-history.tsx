"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import type { TaskDetail, TaskEvent } from "@/features/work/api";

/** What happened to the task, newest first: who did what, when (its points, dates, steps, blockers). */
export function TaskHistory({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const format = useFormatter();
  if (task.events.length === 0) {
    return null;
  }
  return (
    <Card title={t("historyTitle")}>
      <ol className="space-y-3">
        {[...task.events].reverse().map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <time dateTime={event.created_at} className="text-xs text-muted tabular-nums">
              {format.dateTime(new Date(event.created_at), {
                dateStyle: "medium",
                timeStyle: "short",
                numberingSystem: "latn",
              })}
            </time>
            <span className="font-medium text-ink">{tWork(`taskEvent.${event.kind}`)}</span>
            {event.actor ? (
              <span className="text-muted">
                · <bdi>{`${event.actor.first_name} ${event.actor.last_name}`}</bdi>
              </span>
            ) : null}
            <EventDetail event={event} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

function EventDetail({ event }: { event: TaskEvent }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const format = useFormatter();
  const data = event.data as Record<string, string | number | null | undefined>;
  const day = (value: unknown) =>
    typeof value === "string" && value
      ? format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" })
      : "—";
  let text = "";
  switch (event.kind) {
    case "estimated":
      text = t("estimatedDetail", {
        points: data.points ? String(data.points) : "—",
        start: day(data.start_date),
        due: day(data.due_date),
      });
      break;
    case "validated":
      text = tWork("qualityMark", { mark: String(data.quality_mark ?? "") });
      break;
    case "deadline_moved":
      text = t("deadlineMovedDetail", { before: day(data.before), after: day(data.after), days: String(data.days) });
      break;
    case "blocker_declared":
      text = data.severity ? tWork(`severity.${data.severity as "low" | "medium" | "high" | "critical"}`) : "";
      break;
    case "revision":
      text = String(data.comment ?? "");
      break;
    case "link_added":
      text = String(data.label || data.url || "");
      break;
    case "progress":
      text = [
        typeof data.progress === "number" ? `${data.progress} %` : null,
        data.current_phase ? t("phaseDetail", { phase: String(data.current_phase) }) : null,
        data.next_step ? t("nextStepDetail", { step: String(data.next_step) }) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      break;
  }
  return text ? (
    <span dir="auto" className="basis-full text-muted">
      {text}
    </span>
  ) : null;
}
