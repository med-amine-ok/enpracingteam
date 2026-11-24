"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { changeBudget, type BudgetDetail } from "./api";
import { ExpenseRow, PanelButtons, PanelFrame } from "./expense-row";
import { BudgetBar, BudgetStateBadge, textareaClass, useDay, useMoney } from "./finance-parts";
import { financeKeys, refreshFinance, useBudget, useFinanceSummary } from "./queries";

/** A budget: its figures, the budgets of the units below it, the orders in progress and the expenses. */
export function BudgetView() {
  const t = useTranslations("Finance");
  const tErrors = useTranslations("Errors");
  const { id } = useParams<{ id: string }>();
  const budget = useBudget(Number(id));
  const summary = useFinanceSummary();
  const manage = summary.data?.can_manage ?? false;

  if (budget.isError) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <BackLink href="/finance">{t("title")}</BackLink>
        <Alert tone="error">{errorText(budget.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!budget.data) {
    return (
      <div className="mx-auto max-w-4xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      </div>
    );
  }
  const data = budget.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/finance">{t("title")}</BackLink>
      <Summary budget={data} manage={manage} />
      {data.children.length > 0 ? <Below budget={data} /> : null}
      {data.committed_orders.length > 0 ? <Committed budget={data} /> : null}
      <Card
        title={t("expensesTitle")}
        action={
          manage ? (
            <Link
              href={`/finance/expenses/new?budget=${data.id}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-navy hover:underline"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("newExpense")}
            </Link>
          ) : null
        }
      >
        {data.expenses.length === 0 ? (
          <p className="text-sm text-muted">{t("noExpense")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.expenses.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} manage={manage} showBudget={false} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Summary({ budget, manage }: { budget: BudgetDetail; manage: boolean }) {
  const t = useTranslations("Finance");
  const money = useMoney();
  const [editing, setEditing] = useState(false);
  const figures = [
    { label: t("figures.allocated"), value: budget.allocated_amount },
    { label: t("figures.spent"), value: budget.spent },
    { label: t("figures.committed"), value: budget.committed },
    { label: t("figures.remaining"), value: budget.remaining },
  ];
  return (
    <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{t("yearBadge", { year: budget.fiscal_year })}</Badge>
            <BudgetStateBadge budget={budget} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink rtl:text-right">
            <bdi>{budget.org_unit.name}</bdi>
          </h1>
          {budget.notes ? (
            <p className="text-sm whitespace-pre-line text-muted">
              <bdi>{budget.notes}</bdi>
            </p>
          ) : null}
        </div>
        {manage && !editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            {t("actions.editBudget")}
          </Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {figures.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd
              className={cn(
                "mt-0.5 text-lg font-semibold tabular-nums",
                Number(value) < 0 ? "text-racing-strong" : "text-ink",
              )}
            >
              {money(value)}
            </dd>
          </div>
        ))}
      </dl>
      <BudgetBar budget={budget} />
      {editing ? <EditBudgetForm budget={budget} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}

/** The budgets of the units below, and the total with them. */
function Below({ budget }: { budget: BudgetDetail }) {
  const t = useTranslations("Finance");
  const money = useMoney();
  const total = budget.with_children;
  return (
    <Card
      title={t("below.title")}
      description={t("below.total", {
        spent: money(total.spent),
        allocated: money(total.allocated_amount),
        left: money(total.remaining),
      })}
    >
      <ul className="divide-y divide-line">
        {budget.children.map((child) => (
          <li key={child.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/finance/budgets/${child.id}`} className="font-medium text-ink hover:underline">
                  <bdi>{child.org_unit.name}</bdi>
                </Link>
                <BudgetStateBadge budget={child} />
              </div>
              <p className="text-sm text-muted">
                {t("row.spentOf", { spent: money(child.spent), allocated: money(child.allocated_amount) })}
              </p>
            </div>
            <BudgetBar budget={child} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The orders in progress counted on this budget until they are delivered. */
function Committed({ budget }: { budget: BudgetDetail }) {
  const t = useTranslations("Finance");
  const money = useMoney();
  const day = useDay();
  return (
    <Card title={t("committedTitle")} description={t("committedIntro")}>
      <ul className="divide-y divide-line">
        {budget.committed_orders.map((order) => (
          <li key={order.purchase_request_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <Link
                href={`/purchasing/requests/${order.purchase_request_id}`}
                className="font-medium text-ink hover:underline"
              >
                <bdi>{order.part}</bdi>
              </Link>
              <p className="text-muted">
                <bdi>{order.supplier}</bdi>
                {order.ordered_at ? <> · {t("orderedOn", { date: day(order.ordered_at) })}</> : null}
              </p>
            </div>
            <p className="font-semibold text-ink tabular-nums">{money(order.total_dzd)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EditBudgetForm({ budget, onClose }: { budget: BudgetDetail; onClose: () => void }) {
  const t = useTranslations("Finance");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(Number(budget.allocated_amount)));
  const [notes, setNotes] = useState(budget.notes);
  const notesId = useId();
  const valid = amount !== "" && Number(amount) >= 0;
  const save = useMutation({
    mutationFn: () => changeBudget(budget.id, { allocated_amount: amount, notes: notes.trim() }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(financeKeys.budget(saved.id), saved);
      onClose();
      await refreshFinance(queryClient);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      save.mutate();
    }
  }

  return (
    <PanelFrame title={t("editBudgetTitle")} onSubmit={submit}>
      <TextField
        label={t("form.allocated")}
        type="number"
        min={0}
        step="1"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        autoFocus
      />
      <div className="space-y-1.5">
        <label htmlFor={notesId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("form.notes")}
        </label>
        <textarea
          id={notesId}
          rows={2}
          dir="auto"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={textareaClass}
        />
      </div>
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <PanelButtons confirm={t("edit.confirm")} pending={save.isPending} disabled={!valid} onClose={onClose} />
    </PanelFrame>
  );
}
