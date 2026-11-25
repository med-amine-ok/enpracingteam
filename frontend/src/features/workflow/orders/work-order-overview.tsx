"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { errorText } from "@/lib/error-text";
import { BUDGET_TIERS, setRubric, updateWorkOrder, type WorkOrderDetail } from "../api";
import { refreshWorkflow } from "../queries";
import { Fact, TextArea, isLocked, isProposal, memberName } from "./shared";

/** What the Work Order is for, who works on it and, for its Head, its budget. */
export function WorkOrderOverview({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  const text = (value: string | undefined) =>
    value?.trim() ? (
      <p dir="auto" className="whitespace-pre-line">
        {value}
      </p>
    ) : (
      <span className="text-muted">—</span>
    );
  // The budget section only for the Head who receives it, once the Work Order is official (spec §3.1).
  const sets = order.rights.plan && "budget_tier" in order && !isProposal(order.proposal_status);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title={t("tab.overview")} className="lg:col-span-2">
        <dl className="space-y-4">
          <Fact label={t("description")}>{text(order.description)}</Fact>
          <Fact label={t("objectives")}>{text(order.objectives)}</Fact>
          <Fact label={t("justification")}>{text(order.justification)}</Fact>
          {order.estimated_effort_units ? (
            <Fact label={t("effort")}>
              <span className="tabular-nums">{order.estimated_effort_units}</span>
            </Fact>
          ) : null}
        </dl>
      </Card>
      <Card title={t("members")} description={t("membersHint")}>
        {order.members.length === 0 ? (
          <p className="text-sm text-muted">{t("noMembers")}</p>
        ) : (
          <ul className="space-y-1.5 text-sm text-ink">
            {order.members.map((member) => (
              <li key={member.id}>
                <bdi>{memberName(member)}</bdi>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {sets ? (
        <>
          <RubricForm order={order} />
          <BudgetTierForm order={order} />
        </>
      ) : null}
    </div>
  );
}

const RATINGS = ["effort", "complexity", "uncertainty", "responsibility"] as const;
type Rating = (typeof RATINGS)[number];

/** The four 1–5 ratings (spec §7.1); the API answers with their score and the suggested budget. */
function RubricForm({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [ratings, setRatings] = useState<Record<Rating, string>>({
    effort: order.rubric ? String(order.rubric.effort) : "",
    complexity: order.rubric ? String(order.rubric.complexity) : "",
    uncertainty: order.rubric ? String(order.rubric.uncertainty) : "",
    responsibility: order.rubric ? String(order.rubric.responsibility) : "",
  });
  const save = useMutation({
    mutationFn: () =>
      setRubric(order.id, {
        effort: Number(ratings.effort),
        complexity: Number(ratings.complexity),
        uncertainty: Number(ratings.uncertainty),
        responsibility: Number(ratings.responsibility),
      }),
    onSuccess: () => refreshWorkflow(queryClient),
  });
  const complete = RATINGS.every((name) => ratings[name]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }
  return (
    <Card title={t("rubricTitle")} description={t("rubricHint")} className="lg:col-span-2">
      <form onSubmit={submit} className="space-y-4">
        {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-4">
          {RATINGS.map((name) => (
            <SelectField
              key={name}
              label={t(`rating.${name}`)}
              value={ratings[name]}
              onChange={(event) => setRatings({ ...ratings, [name]: event.target.value })}
            >
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>
          ))}
        </div>
        {order.rubric ? (
          <p className="text-sm text-ink">
            {t("rubricResult", { score: order.rubric.score, tier: order.rubric.suggested_tier })}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={save.isPending} disabled={!complete}>
            {t("rubricSave")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** The point budget, 1 to 5; once the Work Order is active it changes only with a reason (spec §7.2). */
function BudgetTierForm({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [tier, setTier] = useState(order.budget_tier ? String(order.budget_tier) : "");
  const [reason, setReason] = useState("");
  const locked = isLocked(order.status);
  const save = useMutation({
    mutationFn: () =>
      updateWorkOrder(order.id, {
        budget_tier: tier ? Number(tier) : null,
        ...(locked ? { reason: reason.trim() } : {}),
      }),
    onSuccess: async () => {
      setReason("");
      await refreshWorkflow(queryClient);
    },
  });
  const changed = tier !== (order.budget_tier ? String(order.budget_tier) : "");
  return (
    <Card title={t("budget")} description={locked ? t("budgetLockedHint") : t("budgetHint")}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
        <SelectField label={t("budgetTier")} value={tier} onChange={(event) => setTier(event.target.value)}>
          <option value="">{t("budgetUnset")}</option>
          {BUDGET_TIERS.map((value) => (
            <option key={value} value={value}>
              {t("budgetValue", { tier: value })}
            </option>
          ))}
        </SelectField>
        {order.rubric && String(order.rubric.suggested_tier) !== tier ? (
          <Button size="sm" variant="ghost" onClick={() => setTier(String(order.rubric?.suggested_tier))}>
            {t("useSuggested", { tier: order.rubric.suggested_tier })}
          </Button>
        ) : null}
        {locked ? <TextArea label={t("reason")} required rows={2} value={reason} onChange={setReason} /> : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={save.isPending} disabled={!changed || (locked && !reason.trim())}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
