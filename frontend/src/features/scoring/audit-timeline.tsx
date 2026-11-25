"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditEntry } from "./api";
import { memberName, useWhen } from "./scoring-parts";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return value == null || value === "" ? {} : { value };
}

function show(value: unknown) {
  if (value === undefined) {
    return "";
  }
  if (value === null) {
    return "∅";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** "Calcul lancé", or the backend's own code for an action this screen does not know yet. */
export function useAuditLabels() {
  const t = useTranslations("Scoring");
  return {
    action: (action: string) =>
      (AUDIT_ACTIONS as readonly string[]).includes(action)
        ? t(`audit.action.${action as (typeof AUDIT_ACTIONS)[number]}`)
        : action,
    entity: (type: string) =>
      (AUDIT_ENTITY_TYPES as readonly string[]).includes(type)
        ? t(`audit.entity.${type as (typeof AUDIT_ENTITY_TYPES)[number]}`)
        : type,
  };
}

/** Before and after, key by key (guide §14.6). */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const t = useTranslations("Scoring");
  const old = asRecord(before);
  const now = asRecord(after);
  const keys = [...new Set([...Object.keys(old), ...Object.keys(now)])];
  if (keys.length === 0) {
    return null;
  }
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-muted">
          <th className="py-1 pe-3 text-start font-medium">{t("audit.field")}</th>
          <th className="py-1 pe-3 text-start font-medium">{t("audit.before")}</th>
          <th className="py-1 text-start font-medium">{t("audit.after")}</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key} className="border-t border-line">
            <td className="py-1 pe-3 font-mono text-muted" dir="ltr">
              {key}
            </td>
            <td className="py-1 pe-3 break-all" dir="auto">
              {show(old[key])}
            </td>
            <td className="py-1 break-all" dir="auto">
              {show(now[key])}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The ranking administration history: actor, action, time, entity, before/after values, reason. */
export function AuditTimeline({ entries, compact = false }: { entries: AuditEntry[]; compact?: boolean }) {
  const t = useTranslations("Scoring");
  const when = useWhen();
  const labels = useAuditLabels();
  if (entries.length === 0) {
    return <p className="text-sm text-muted">{t("audit.empty")}</p>;
  }
  return (
    <ol className="space-y-4 border-s border-line ps-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -start-[1.4rem] top-1.5 size-2.5 rounded-full bg-racing" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="info">{labels.action(entry.action)}</Badge>
            <span className="text-muted">
              {labels.entity(entry.entity_type)}{" "}
              {entry.entity_type === "calculation_run" ? (
                <Link href={`/scoring/runs/${entry.entity_id}`} className="text-navy hover:underline">
                  #{entry.entity_id}
                </Link>
              ) : (
                `#${entry.entity_id}`
              )}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            <bdi>{memberName(entry.actor)}</bdi> ·{" "}
            <time dateTime={entry.occurred_at}>{when.dateTime(entry.occurred_at)}</time>
          </p>
          {entry.reason ? (
            <p className="mt-1 text-sm text-ink">
              {t("audit.reason")} <bdi>{entry.reason}</bdi>
            </p>
          ) : null}
          {compact ? null : <Changes before={entry.old_value} after={entry.new_value} />}
        </li>
      ))}
    </ol>
  );
}
