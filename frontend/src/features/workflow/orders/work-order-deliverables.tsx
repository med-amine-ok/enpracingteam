"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { createDeliverable, setWeights, type Deliverable, type WorkOrderDetail } from "../api";
import { DeliverableStates, ProgressMeter, ProposalBadge } from "../badges";
import { refreshWorkflow, useDeliverables } from "../queries";
import { MemberPicker, TextArea, isLocked, isProposal, proposalOutline, useDay } from "./shared";

/** The Work Order's Deliverables, the Head's point allocation and the way to add (or propose) one. */
export function WorkOrderDeliverables({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  // Every Deliverable of the Work Order, with the proposals the viewer may see (theirs; all of them for the Head).
  const deliverables = useDeliverables({ work_order: order.id, proposals: "include" } as never);
  const [adding, setAdding] = useState(false);
  const mode = order.rights.plan ? "official" : order.rights.propose_deliverable ? "proposal" : null;
  return (
    <div className="space-y-6">
      <Card
        title={t("tab.deliverables")}
        action={
          mode && !adding ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {mode === "official" ? t("addDeliverable") : t("proposeDeliverable")}
            </Button>
          ) : null
        }
      >
        {deliverables.error ? (
          <LoadError error={deliverables.error} />
        ) : !deliverables.data ? (
          <LinesPlaceholder lines={3} />
        ) : deliverables.data.length === 0 ? (
          <p className="text-sm text-muted">{t("noDeliverables")}</p>
        ) : (
          <ul className="space-y-2">
            {deliverables.data.map((item) => (
              <DeliverableRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </Card>
      {adding && mode ? <DeliverableForm order={order} mode={mode} onDone={() => setAdding(false)} /> : null}
      {order.rights.plan && order.credit_plan ? <WeightEditor order={order} /> : null}
    </div>
  );
}

function DeliverableRow({ item }: { item: Deliverable }) {
  const t = useTranslations("WorkOrders");
  const day = useDay();
  const format = useFormatter();
  const decimal = (value: string, digits: number) =>
    format.number(Number(value), { maximumFractionDigits: digits, numberingSystem: "latn" });
  const deadline = item.effective_deadline ?? item.original_deadline;
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line px-4 py-3",
        isProposal(item.proposal_status) && cn("border-transparent", proposalOutline),
      )}
    >
      <div className="min-w-48 flex-1 space-y-1">
        <Link href={`/work/deliverables/${item.id}`} className="font-medium text-ink hover:text-racing">
          {item.code ? (
            <span className="me-2 font-mono text-xs text-muted" dir="ltr">
              {item.code}
            </span>
          ) : null}
          <bdi dir="auto">{item.title}</bdi>
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <ProposalBadge status={item.proposal_status || null} />
          {!isProposal(item.proposal_status) && item.status ? (
            <DeliverableStates
              status={item.status}
              depState={item.dep_state ?? "no_blocking_dependencies"}
              executionState={item.execution_state ?? "normal"}
            />
          ) : null}
        </div>
      </div>
      <ProgressMeter value={item.progress} label={t("progressOf", { title: item.title })} className="w-40" />
      <span className="text-xs text-muted tabular-nums">
        {deadline ? t("deadlineOn", { date: day(deadline) }) : t("noDeadline")}
      </span>
      {/* Weight and points come only to the Head (guide §2.1). */}
      {item.weight != null ? (
        <span className="text-xs text-muted tabular-nums">
          {t("weightValue", { weight: decimal(item.weight, 3) })}
          {item.allocated_points != null ? ` · ${t("pointsValue", { points: decimal(item.allocated_points, 2) })}` : ""}
        </span>
      ) : null}
    </li>
  );
}

const WEIGHT = /^\d{1,3}([.,]\d{1,3})?$/;

/** Thousandths of a percent, to add weights without rounding errors; null when the text is no valid weight. */
export function thousandths(value: string) {
  const text = value.trim();
  if (!text) {
    return 0;
  }
  if (!WEIGHT.test(text)) {
    return null;
  }
  const result = Math.round(Number(text.replace(",", ".")) * 1000);
  return result > 100_000 ? null : result;
}

/** What is wrong with a set of weights (spec §7.3): a bad weight, over 100 %, or not 100 % once active. */
export function checkWeights(values: string[], locked: boolean) {
  const parsed = values.map(thousandths);
  const invalid = parsed.some((value) => value === null);
  const total = parsed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return {
    total: total / 1000,
    invalid,
    over: total > 100_000,
    notHundred: total !== 100_000,
    blocking: invalid || total > 100_000 || (locked && total !== 100_000),
  };
}

/** The Head's point allocation editor (guide §15.5): weights, live total, allocated points, the backend's
 * problems; once the Work Order is active, a change totals 100 % and gives its reason. */
export function WeightEditor({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const lines = order.credit_plan ?? [];
  const initial = Object.fromEntries(lines.map((line) => [line.id, String(Number(line.weight))]));
  // The Head's edits only: a Deliverable added meanwhile shows its official weight.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const weights: Record<number, string> = { ...initial, ...edits };
  const [reason, setReason] = useState("");
  const locked = isLocked(order.status);
  const check = checkWeights(
    lines.map((line) => weights[line.id] ?? ""),
    locked,
  );
  const tier = order.budget_tier ?? null;
  const points = (weight: string) => {
    const value = thousandths(weight);
    return tier && value !== null
      ? format.number((tier * value) / 100_000, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          numberingSystem: "latn",
        })
      : "—";
  };
  const save = useMutation({
    mutationFn: () =>
      setWeights(
        order.id,
        Object.fromEntries(
          lines.map((line) => [String(line.id), ((thousandths(weights[line.id] ?? "") ?? 0) / 1000).toFixed(3)]),
        ),
        reason.trim(),
      ),
    onSuccess: async () => {
      setReason("");
      await refreshWorkflow(queryClient);
      setEdits({});
    },
  });
  const changed = lines.some((line) => (weights[line.id] ?? "") !== initial[line.id]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }
  const totalText = format.number(check.total, { maximumFractionDigits: 3, numberingSystem: "latn" });

  return (
    <Card title={t("allocationTitle")} description={tier ? t("allocationBudget", { tier }) : t("allocationNoBudget")}>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">{t("noDeliverables")}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
          {order.plan_problems.length > 0 ? (
            <Alert tone="warning">
              <p className="font-semibold">{t("planProblems")}</p>
              <ul className="list-disc ps-5">
                {order.plan_problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-2xs font-semibold tracking-widest text-muted uppercase">
                <th className="py-2 text-start">{t("deliverable")}</th>
                <th className="w-32 py-2 text-end">{t("weight")}</th>
                <th className="w-32 py-2 text-end">{t("allocatedPoints")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-line">
                  <td className="py-2">
                    {line.code ? (
                      <span className="me-2 font-mono text-xs text-muted" dir="ltr">
                        {line.code}
                      </span>
                    ) : null}
                    <bdi dir="auto">{line.title}</bdi>
                  </td>
                  <td className="py-2 text-end">
                    <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      aria-label={t("weightOf", { title: line.title })}
                      aria-invalid={thousandths(weights[line.id] ?? "") === null || undefined}
                      value={weights[line.id] ?? ""}
                      onChange={(event) => setEdits({ ...edits, [line.id]: event.target.value })}
                      className="h-9 w-24 rounded-lg border border-line bg-surface px-2 text-end text-sm tabular-nums aria-invalid:border-racing"
                    />
                    <span className="ms-1 text-muted">%</span>
                  </td>
                  <td className="py-2 text-end tabular-nums">{points(weights[line.id] ?? "")}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-semibold">
                <td className="py-2">{t("total")}</td>
                <td className="py-2 text-end tabular-nums" data-testid="weights-total">
                  {totalText} %
                </td>
                <td className="py-2 text-end tabular-nums">
                  {tier
                    ? format.number((tier * check.total) / 100, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                        numberingSystem: "latn",
                      })
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
          {check.invalid ? (
            <p role="alert" className="text-sm text-racing-strong">
              {t("weightInvalid")}
            </p>
          ) : check.over ? (
            <p role="alert" className="text-sm text-racing-strong">
              {t("weightOver", { total: totalText })}
            </p>
          ) : check.notHundred ? (
            <p
              role={locked ? "alert" : undefined}
              className={cn("text-sm", locked ? "text-racing-strong" : "text-warning")}
            >
              {locked ? t("weightMustBeHundred", { total: totalText }) : t("weightNotYetHundred", { total: totalText })}
            </p>
          ) : null}
          {locked ? <TextArea label={t("reason")} required rows={2} value={reason} onChange={setReason} /> : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              loading={save.isPending}
              disabled={!changed || check.blocking || (locked && !reason.trim())}
            >
              {t("saveWeights")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** A new Deliverable: official for the Head (with its dates, weight and members), a proposal for anybody else. */
function DeliverableForm({
  order,
  mode,
  onDone,
}: {
  order: WorkOrderDetail;
  mode: "official" | "proposal";
  onDone: () => void;
}) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const official = mode === "official";
  const locked = isLocked(order.status);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");
  const [justification, setJustification] = useState("");
  const [start, setStart] = useState("");
  const [deadline, setDeadline] = useState("");
  const [weight, setWeight] = useState("");
  const [members, setMembers] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const weightValue = thousandths(weight);
  const save = useMutation({
    mutationFn: (submit: boolean) =>
      official
        ? createDeliverable({
            work_order: order.id,
            title: title.trim(),
            description,
            acceptance_criteria: criteria,
            start_date: start || null,
            original_deadline: deadline || null,
            ...(weight.trim() && weightValue !== null ? { weight: (weightValue / 1000).toFixed(3) } : {}),
            member_ids: members,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            submit: true,
          })
        : createDeliverable(
            {
              work_order: order.id,
              title: title.trim(),
              description,
              acceptance_criteria: criteria,
              justification,
              submit,
            },
            true,
          ),
    onSuccess: async () => {
      await refreshWorkflow(queryClient);
      onDone();
    },
  });
  const datesWrong = !!start && !!deadline && deadline < start;
  const needsReason = official && locked && !!weight.trim();
  const blocked = !title.trim() || weightValue === null || datesWrong || (needsReason && !reason.trim());
  return (
    <Card
      title={official ? t("addDeliverable") : t("proposeDeliverable")}
      description={official ? t("addDeliverableHint") : t("proposeDeliverableHint")}
      className={cn(!official && proposalOutline)}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(true);
        }}
      >
        {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
        <TextField
          label={t("titleColumn")}
          required
          maxLength={255}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextArea label={t("description")} value={description} onChange={setDescription} />
        <TextArea
          label={official ? t("acceptanceCriteria") : t("suggestedCriteria")}
          value={criteria}
          onChange={setCriteria}
        />
        {official ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label={t("startDate")} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              <TextField
                label={t("deadline")}
                type="date"
                min={start || undefined}
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                aria-invalid={datesWrong || undefined}
              />
              <TextField
                label={t("weightPercent")}
                inputMode="decimal"
                valueDir="ltr"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                aria-invalid={weightValue === null || undefined}
              />
            </div>
            {datesWrong ? <p className="text-xs text-racing-strong">{t("deadlineBeforeStart")}</p> : null}
            {weightValue === null ? <p className="text-xs text-racing-strong">{t("weightInvalid")}</p> : null}
            <MemberPicker label={t("members")} value={members} onChange={setMembers} />
            {needsReason ? (
              <TextArea label={t("reason")} required rows={2} value={reason} onChange={setReason} />
            ) : null}
          </>
        ) : (
          <TextArea label={t("justification")} value={justification} onChange={setJustification} />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onDone} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          {!official ? (
            <Button
              variant="secondary"
              onClick={() => save.mutate(false)}
              loading={save.isPending && save.variables === false}
              disabled={blocked || save.isPending}
            >
              {t("saveDraft")}
            </Button>
          ) : null}
          <Button
            type="submit"
            loading={save.isPending && save.variables !== false}
            disabled={blocked || save.isPending}
          >
            {official ? t("create") : t("submitProposal")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
