"use client";

import { ChevronRight, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { EngagementHeader, personName } from "./engagement-parts";
import { useCharterIssues, useEngagementRights, useFollowedMembers } from "./queries";

/** The members the viewer follows, each with their goals and this month's volunteering; the charter's issues. */
export function EngagementTeamPage() {
  const t = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const rights = useEngagementRights();
  const members = useFollowedMembers();
  const issues = useCharterIssues(Boolean(rights.data?.sees_all));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <EngagementHeader current="team" />
      {rights.data?.sees_all ? (
        <Card title={t("charterTitle")} description={t("charterIntro")}>
          {issues.isError ? (
            <Alert tone="error">{errorText(issues.error, tErrors)}</Alert>
          ) : !issues.data ? (
            <LinesPlaceholder lines={2} />
          ) : issues.data.length === 0 ? (
            <p className="text-sm text-muted">{t("noCharterIssues")}</p>
          ) : (
            <ul className="space-y-3">
              {issues.data.map((issue) => (
                <li key={issue.membership_id} className="space-y-1 rounded-lg border border-warning/30 p-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <TriangleAlert className="size-4 text-warning" aria-hidden="true" />
                    <Link href={`/members/${issue.member.id}`} className="font-medium text-ink hover:underline">
                      {personName(issue.member)}
                    </Link>
                    <span className="text-muted">
                      <bdi>{issue.unit.name}</bdi> · <bdi>{issue.role}</bdi>
                    </span>
                  </p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-ink">
                    {issue.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      <Card title={t("followedTitle")} description={t("followedIntro")}>
        {members.isError ? (
          <Alert tone="error">{errorText(members.error, tErrors)}</Alert>
        ) : !members.data ? (
          <LinesPlaceholder lines={3} />
        ) : members.data.length === 0 ? (
          <p className="text-sm text-muted">{t("nobodyFollowed")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {members.data.map((member) => (
              <li key={member.id}>
                <Link
                  href={`/members/${member.id}`}
                  className="flex flex-wrap items-center gap-3 py-2.5 hover:bg-canvas"
                  aria-label={t("openSheetOf", { name: personName(member) })}
                >
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink">{personName(member)}</span>
                  <span className="text-xs text-muted">{t("goalsCount", { count: member.goals })}</span>
                  {member.volunteered ? (
                    <Badge tone="success">{t("volunteeredBadge")}</Badge>
                  ) : (
                    <Badge tone="warning">{t("notVolunteeredBadge")}</Badge>
                  )}
                  <ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
