"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { ValidationIssue } from "./api";
import { useDecimal } from "./scoring-parts";

function issueKey(issue: ValidationIssue, index: number) {
  if (issue.kind === "weights") {
    return `weights-${issue.work_order}`;
  }
  if (issue.kind === "no_cutoff") {
    return `cutoff-${issue.season}`;
  }
  return `${issue.kind}-${issue.deliverable}-${index}`;
}

/** The season's missing or inconsistent scoring inputs (guide §14.1, screen 29), as the backend lists them. */
export function ValidationIssueList({ issues }: { issues: ValidationIssue[] }) {
  const t = useTranslations("Scoring");
  const decimal = useDecimal();
  if (issues.length === 0) {
    return <p className="text-sm text-muted">{t("issues.none")}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {issues.map((issue, index) => (
        <li key={issueKey(issue, index)} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-sm">
          <Badge tone={issue.kind === "no_cutoff" || issue.kind === "weights" ? "danger" : "warning"}>
            {t(`issues.kind.${issue.kind}`)}
          </Badge>
          <div className="min-w-0 flex-1">
            {issue.kind === "no_cutoff" ? (
              <p className="text-ink">{t("issues.noCutoff")}</p>
            ) : (
              <>
                <p className="font-medium text-ink">
                  <bdi>{issue.code ? `${issue.code} — ${issue.title}` : issue.title}</bdi>
                </p>
                <p className="text-xs text-muted">
                  {issue.kind === "weights" ? (
                    t("issues.weightsTotal", { total: decimal(issue.total, 2) })
                  ) : (
                    <bdi>{issue.department}</bdi>
                  )}
                </p>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
