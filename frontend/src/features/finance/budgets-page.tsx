"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, PiggyBank, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useOrgUnits } from "@/features/members/use-members";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { createBudget, type Budget, type FinanceSummary } from "./api";
import { PanelButtons, PanelFrame } from "./expense-row";
import { BudgetBar, BudgetStateBadge, FinanceTabs, textareaClass, useMoney, YearSelect } from "./finance-parts";
import { refreshFinance, useBudgets, useFinanceSummary } from "./queries";

/** The budgets of a year the viewer sees, unit by unit (the units below under theirs), with their figures. */
export function BudgetsPage() {
  const t = useTranslations("Finance");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const summary = useFinanceSummary();
  const [chosen, setChosen] = useState("");
  const current = summary.data?.fiscal_year ?? "";
  const year = chosen || current;
  const canSee = summary.data?.can_see_budgets ?? false;
  const budgets = useBudgets(year, canSee);
  const [adding, setAdding] = useState(false);
  const manage = summary.data?.can_manage ?? false;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("title")} description={t("intro")}>
        {manage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAdding(true)} disabled={adding}>
              <Plus className="size-4" aria-hidden="true" />
              {t("newBudget")}
            </Button>
            <Link href="/finance/expenses/new" className={buttonClassName("primary", "md")}>
              <Plus className="size-4" aria-hidden="true" />
              {t("newExpense")}
            </Link>
          </div>
        ) : null}
      </PageHeader>
      <FinanceTabs current="budgets" summary={summary.data} />

      {summary.isError ? (
        <Alert tone="error">{errorText(summary.error, tErrors)}</Alert>
      ) : summary.data && !canSee ? (
        <NoBudgets summary={summary.data} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-end">
            {current ? <YearSelect value={year} current={current} onChange={setChosen} /> : <div />}
            <Counters summary={summary.data} />
          </div>
          {adding ? <NewBudgetForm year={year} budgets={budgets.data ?? []} onClose={() => setAdding(false)} /> : null}
          {budgets.isError ? (
            <div className="space-y-3">
              <Alert tone="error">{errorText(budgets.error, tErrors)}</Alert>
              <Button variant="secondary" onClick={() => budgets.refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : !budgets.data ? (
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-xl border border-line bg-surface" />
              ))}
            </div>
          ) : budgets.data.length === 0 ? (
            <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
              <PiggyBank className="size-8 text-muted" aria-hidden="true" />
              <p className="font-medium text-ink">{t("noBudgetYear", { year })}</p>
              {manage ? <p className="text-sm text-muted">{t("noBudgetYearManager")}</p> : null}
            </div>
          ) : (
            <>
              <Totals budgets={budgets.data} />
              <BudgetTree budgets={budgets.data} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** For those who see no budget: who sees them, and the sponsors if they may see those. */
function NoBudgets({ summary }: { summary: FinanceSummary }) {
  const t = useTranslations("Finance");
  return (
    <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
      <Lock className="size-8 text-muted" aria-hidden="true" />
      <p className="font-medium text-ink">{t("noAccess.title")}</p>
      <p className="max-w-xl text-sm text-muted">{t("noAccess.text")}</p>
      {summary.can_see_sponsors ? (
        <Link href="/finance/sponsors" className="text-sm font-medium text-navy hover:underline">
          {t("noAccess.sponsors")}
        </Link>
      ) : null}
    </div>
  );
}

/** Budgets above their allocation, and expenses waiting for a budget (for those who see them all). */
function Counters({ summary }: { summary?: FinanceSummary }) {
  const t = useTranslations("Finance");
  if (!summary) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2 sm:justify-end">
      {summary.over_budget > 0 ? (
        <span className="rounded-full bg-racing-soft px-3 py-1 text-sm font-medium text-racing-strong">
          {t("overCount", { count: summary.over_budget })}
        </span>
      ) : null}
      {summary.to_impute ? (
        <Link
          href="/finance/expenses?view=to_impute"
          className="rounded-full bg-warning-soft px-3 py-1 text-sm font-medium text-warning hover:underline"
        >
          {t("toImputeCount", { count: summary.to_impute })}
        </Link>
      ) : null}
    </div>
  );
}

/** Allocated, spent, committed and left, for all the budgets shown (each unit has its own budget). */
function Totals({ budgets }: { budgets: Budget[] }) {
  const t = useTranslations("Finance");
  const money = useMoney();
  const sum = (field: "allocated_amount" | "spent" | "committed" | "remaining") =>
    budgets.reduce((total, budget) => total + Number(budget[field]), 0);
  const figures = [
    { label: t("figures.allocated"), value: sum("allocated_amount") },
    { label: t("figures.spent"), value: sum("spent") },
    { label: t("figures.committed"), value: sum("committed") },
    { label: t("figures.remaining"), value: sum("remaining") },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {figures.map(({ label, value }) => (
        <div key={label} className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className={cn("mt-1 text-lg font-semibold tabular-nums", value < 0 ? "text-racing-strong" : "text-ink")}>
            {money(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Each budget under the nearest budget of a unit above its unit (the FS team, then its departments). */
function BudgetTree({ budgets }: { budgets: Budget[] }) {
  const units = useOrgUnits();
  const ordered = useMemo(() => {
    const parents = new Map(units.data?.map((unit) => [unit.id, unit.parent ?? null]));
    const byUnit = new Map(budgets.map((budget) => [budget.org_unit.id, budget]));
    const above = (budget: Budget) => {
      let unit = budget.parent_unit_id;
      const seen = new Set<number>();
      while (unit !== null && unit !== undefined && !seen.has(unit)) {
        seen.add(unit);
        const found = byUnit.get(unit);
        if (found) {
          return found.id;
        }
        unit = parents.get(unit) ?? null;
      }
      return null;
    };
    const children = new Map<number | null, Budget[]>();
    for (const budget of budgets) {
      const parent = above(budget);
      children.set(parent, [...(children.get(parent) ?? []), budget]);
    }
    const rows: { budget: Budget; depth: number }[] = [];
    const visit = (parent: number | null, depth: number) => {
      for (const budget of (children.get(parent) ?? []).sort((a, b) =>
        a.org_unit.name.localeCompare(b.org_unit.name),
      )) {
        rows.push({ budget, depth });
        visit(budget.id, depth + 1);
      }
    };
    visit(null, 0);
    return rows;
  }, [budgets, units.data]);

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      {ordered.map(({ budget, depth }) => (
        <BudgetRow key={budget.id} budget={budget} depth={depth} />
      ))}
    </ul>
  );
}

function BudgetRow({ budget, depth }: { budget: Budget; depth: number }) {
  const t = useTranslations("Finance");
  const money = useMoney();
  return (
    <li
      className="relative grid gap-3 px-4 py-4 transition-colors hover:bg-canvas sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center sm:px-5"
      style={{ paddingInlineStart: `${1 + depth * 1.5}rem` }}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/finance/budgets/${budget.id}`}
            className="font-medium text-ink after:absolute after:inset-0 hover:underline focus-visible:underline"
          >
            <bdi>{budget.org_unit.name}</bdi>
          </Link>
          <BudgetStateBadge budget={budget} />
        </div>
        <p className="text-sm text-muted">
          {t("row.spentOf", { spent: money(budget.spent), allocated: money(budget.allocated_amount) })}
          {" · "}
          <span className={cn(Number(budget.remaining) < 0 && "font-medium text-racing-strong")}>
            {t("row.left", { left: money(budget.remaining) })}
          </span>
        </p>
      </div>
      <BudgetBar budget={budget} />
    </li>
  );
}

/** A new budget for a unit that has none this year: its amount and where the money comes from. */
function NewBudgetForm({ year, budgets, onClose }: { year: string; budgets: Budget[]; onClose: () => void }) {
  const t = useTranslations("Finance");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const units = useOrgUnits();
  const [unit, setUnit] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const notesId = useId();
  const taken = new Set(budgets.map((budget) => budget.org_unit.id));
  const choices = (units.data ?? [])
    .filter((option) => option.is_active && !taken.has(option.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const valid = unit !== "" && amount !== "" && Number(amount) >= 0;
  const create = useMutation({
    mutationFn: () =>
      createBudget({ org_unit: Number(unit), fiscal_year: year, allocated_amount: amount, notes: notes.trim() }),
    onSuccess: async () => {
      onClose();
      await refreshFinance(queryClient);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      create.mutate();
    }
  }

  return (
    <Card>
      <PanelFrame title={t("newBudgetTitle", { year })} onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={t("form.unit")} value={unit} onChange={(event) => setUnit(event.target.value)} autoFocus>
            <option value="">{t("form.chooseUnit")}</option>
            {choices.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t("form.allocated")}
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
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
            placeholder={t("form.notesPlaceholder")}
            className={textareaClass}
          />
        </div>
        {create.isError ? <Alert tone="error">{errorText(create.error, tErrors)}</Alert> : null}
        <PanelButtons confirm={t("form.createBudget")} pending={create.isPending} disabled={!valid} onClose={onClose} />
      </PanelFrame>
    </Card>
  );
}
