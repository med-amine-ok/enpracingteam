"use client";

import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { ScoreSnapshot } from "./api";
import { useMemberScores, useRun } from "./queries";
import {
  PanelPlaceholder,
  QueryFailure,
  ScoringGate,
  ScoringHeader,
  ScoringNotFound,
  TableFrame,
  memberName,
  td,
  tdEnd,
  th,
  thEnd,
  severityLabel,
  useDecimal,
  useWhen,
} from "./scoring-parts";

/** A member's score traced to every contributing Deliverable (guide §14.2), all values from the backend. */
export function MemberScoresPage() {
  return (
    <ScoringGate>
      <MemberScores />
    </ScoringGate>
  );
}

function deliverableLabel(score: ScoreSnapshot) {
  const { code, title } = score.deliverable;
  return code ? `${code} — ${title}` : title;
}

function workOrderLabel(score: ScoreSnapshot) {
  const { code, title } = score.deliverable.work_order;
  return code ? `${code} — ${title}` : title;
}

function MemberScores() {
  const t = useTranslations("Scoring");
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const memberId = Number(id);
  const runParam = Number(params.get("run"));
  const runId = Number.isInteger(runParam) && runParam > 0 ? runParam : null;
  const scores = useMemberScores(memberId, runId);
  const run = useRun(runId);
  const decimal = useDecimal();
  const when = useWhen();

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return <ScoringNotFound />;
  }
  if (scores.isError) {
    return <QueryFailure error={scores.error} />;
  }
  if (!scores.data) {
    return <PanelPlaceholder lines={6} />;
  }
  const data = scores.data;
  const member = data.scores[0]?.member ?? data.earlier[0]?.member;
  const name = member ? memberName(member) : t("member.unknown", { id: memberId });
  const formulas = [...new Set(data.scores.map((score) => score.formula_version))];
  const calculatedAt = data.scores.reduce<string | null>(
    (latest, score) => (!latest || score.created_at > latest ? score.created_at : latest),
    null,
  );
  const departments = [...new Set(data.scores.map((score) => score.department_name).filter(Boolean))];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <BackLink href={runId ? `/scoring/runs/${runId}` : "/scoring/runs"}>
        {runId ? t("run.title", { id: runId }) : t("runs.title")}
      </BackLink>
      <ScoringHeader current="runs" title={<bdi>{name}</bdi>} description={t("member.intro")} />
      <Card>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t("member.total")}>
            <span className="font-display text-3xl font-bold text-navy" data-testid="member-total">
              {decimal(data.total)}
            </span>
          </Fact>
          <Fact label={t("season")}>
            {runId ? <bdi>{run.data?.season_label ?? "…"}</bdi> : t("member.currentScores")}
          </Fact>
          <Fact label={t("department")}>
            <bdi>{departments.join(", ") || "—"}</bdi>
          </Fact>
          <Fact label={t("formula")}>
            <bdi>{formulas.join(", ") || "—"}</bdi>
          </Fact>
          <Fact label={t("member.calculatedAt")}>{when.dateTime(calculatedAt)}</Fact>
          <Fact label={t("member.run")}>
            {runId ? (
              <Link href={`/scoring/runs/${runId}`} className="text-navy hover:underline">
                #{runId}
              </Link>
            ) : (
              [...new Set(data.scores.map((score) => score.calculation_run).filter(Boolean))]
                .map((value) => `#${value}`)
                .join(", ") || "—"
            )}
          </Fact>
          <Fact label={t("member.deliverableCount")}>{data.scores.length}</Fact>
        </dl>
      </Card>
      <Card title={t("member.deliverablesTitle")}>
        {data.scores.length === 0 ? (
          <p className="text-sm text-muted">{t("member.empty")}</p>
        ) : (
          <ul className="space-y-4">
            {data.scores.map((score) => (
              <ScoreCard key={score.id} score={score} />
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("member.earlierTitle")} description={t("member.earlierIntro")}>
        {data.earlier.length === 0 ? (
          <p className="text-sm text-muted">{t("member.noEarlier")}</p>
        ) : (
          <TableFrame minWidth="52rem">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t("member.run")}</th>
                <th className={th}>{t("member.deliverable")}</th>
                <th className={th}>{t("formula")}</th>
                <th className={thEnd}>{t("member.qualityFactor")}</th>
                <th className={thEnd}>{t("member.timeFactor")}</th>
                <th className={thEnd}>{t("member.earned")}</th>
                <th className={th}>{t("member.calculatedAt")}</th>
                <th className={th}>{t("member.state")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.earlier.map((score) => (
                <tr key={score.id}>
                  <td className={td}>
                    {score.calculation_run ? (
                      <Link href={`/scoring/runs/${score.calculation_run}`} className="text-navy hover:underline">
                        #{score.calculation_run}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={td}>
                    <bdi>{deliverableLabel(score)}</bdi>
                  </td>
                  <td className={td}>
                    <bdi>{score.formula_version}</bdi>
                  </td>
                  <td className={tdEnd}>{decimal(score.quality_factor)}</td>
                  <td className={tdEnd}>{decimal(score.time_factor)}</td>
                  <td className={`${tdEnd} font-semibold`}>{decimal(score.earned_points)}</td>
                  <td className={td}>{when.dateTime(score.created_at)}</td>
                  <td className={td}>
                    {score.is_superseded ? (
                      <Badge tone="warning">{t("member.superseded")}</Badge>
                    ) : (
                      <Badge tone="success">{t("member.currentSnapshot")}</Badge>
                    )}
                    {score.superseded_reason ? (
                      <span className="mt-1 block text-xs text-muted" dir="auto">
                        {score.superseded_reason}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Card>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/** One Deliverable's contribution: every input and factor the backend used, and the points it gave. */
function ScoreCard({ score }: { score: ScoreSnapshot }) {
  const t = useTranslations("Scoring");
  const decimal = useDecimal();
  const when = useWhen();
  const rounds = score.revision_rounds ?? [];
  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            <bdi>{deliverableLabel(score)}</bdi>
          </p>
          <p className="text-xs text-muted">
            {t("member.workOrder")} <bdi>{workOrderLabel(score)}</bdi> · <bdi>{score.department_name || "—"}</bdi>
          </p>
        </div>
        <p className="text-end">
          <span className="block text-xs text-muted">{t("member.earned")}</span>
          <span className="font-display text-2xl font-bold text-navy">{decimal(score.earned_points)}</span>
        </p>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <Fact label={t("member.budgetTier")}>{score.budget_tier}</Fact>
        <Fact label={t("member.weight")}>{t("member.percent", { value: decimal(score.weight, 2) })}</Fact>
        <Fact label={t("member.allocated")}>{decimal(score.allocated_points)}</Fact>
        <Fact label={t("member.rawQuality")}>
          {score.raw_quality == null ? "—" : t("member.outOfFive", { value: decimal(score.raw_quality, 1) })}
        </Fact>
        <Fact label={t("member.qualityFactor")}>{decimal(score.quality_factor)}</Fact>
        <Fact label={t("member.revisionPenalty")}>{decimal(score.revision_penalty)}</Fact>
        <Fact label={t("member.timeFactor")}>{decimal(score.time_factor)}</Fact>
        <Fact label={t("member.delayRatio")}>{decimal(score.delay_ratio)}</Fact>
        <Fact label={t("member.effectiveDeadline")}>{when.date(score.effective_deadline)}</Fact>
        <Fact label={t("member.firstSubmission")}>{when.dateTime(score.first_submission_at)}</Fact>
        <Fact label={t("member.memberCount")}>{score.member_count}</Fact>
        <Fact label={t("formula")}>
          <bdi>{score.formula_version}</bdi>
        </Fact>
      </dl>
      {rounds.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-navy">{t("member.rounds", { count: rounds.length })}</summary>
          <TableFrame minWidth="28rem">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t("member.round")}</th>
                <th className={th}>{t("member.severity")}</th>
                <th className={th}>{t("member.attributable")}</th>
                <th className={thEnd}>{t("member.escalation")}</th>
                <th className={thEnd}>{t("member.penalty")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rounds.map((round) => (
                <tr key={round.round}>
                  <td className={td}>{round.round}</td>
                  <td className={td}>{severityLabel(t, round.severity)}</td>
                  <td className={td}>{round.attributable ? t("yes") : t("no")}</td>
                  <td className={tdEnd}>{decimal(round.escalation, 2)}</td>
                  <td className={tdEnd}>{decimal(round.penalty)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </details>
      ) : (
        <p className="mt-3 text-xs text-muted">{t("member.noRounds")}</p>
      )}
    </li>
  );
}
