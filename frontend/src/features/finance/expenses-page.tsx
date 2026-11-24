"use client";

import { Plus, ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import type { ExpenseCategory, ExpenseFilters } from "./api";
import { MANUAL_CATEGORIES } from "./api";
import { ExpenseRow } from "./expense-row";
import { FinanceTabs, useMoney, YearSelect } from "./finance-parts";
import { useExpenses, useFinanceSummary } from "./queries";

type View = "all" | "purchase" | "manual" | "to_impute";

/** Every expense the viewer sees, the latest first; those waiting for a budget for the managers. */
export function ExpensesPage() {
  const t = useTranslations("Finance");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const money = useMoney();
  const params = useSearchParams();
  const summary = useFinanceSummary();
  const [view, setView] = useState<View>(params.get("view") === "to_impute" ? "to_impute" : "all");
  const [chosen, setChosen] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const current = summary.data?.fiscal_year ?? "";
  const year = chosen || current;
  const canSee = summary.data?.can_see_budgets ?? false;
  const manage = summary.data?.can_manage ?? false;

  const filters: ExpenseFilters =
    view === "to_impute"
      ? { to_impute: true }
      : { year, ...(view === "all" ? {} : { source: view }), ...(category ? { category } : {}) };
  const expenses = useExpenses(filters, canSee && (view === "to_impute" || !!year));
  const total = expenses.data?.reduce((sum, expense) => sum + Number(expense.amount), 0) ?? 0;

  const views: { value: View; label: string }[] = [
    { value: "all", label: t("views.all") },
    { value: "purchase", label: t("views.purchase") },
    { value: "manual", label: t("views.manual") },
  ];
  if (summary.data?.can_see_all) {
    views.push({
      value: "to_impute",
      label: t("views.toImpute", { count: summary.data.to_impute ?? 0 }),
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("expensesPageTitle")} description={t("expensesIntro")}>
        {manage ? (
          <Link href="/finance/expenses/new" className={buttonClassName("primary", "md")}>
            <Plus className="size-4" aria-hidden="true" />
            {t("newExpense")}
          </Link>
        ) : null}
      </PageHeader>
      <FinanceTabs current="expenses" summary={summary.data} />

      {summary.isError ? (
        <Alert tone="error">{errorText(summary.error, tErrors)}</Alert>
      ) : summary.data && !canSee ? (
        <Alert tone="info">{t("noAccess.text")}</Alert>
      ) : (
        <>
          <div className="space-y-4">
            <Segmented label={t("views.label")} value={view} onChange={setView} options={views} />
            {view === "to_impute" ? (
              <p className="text-sm text-muted">{t("toImputeIntro")}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:max-w-xl">
                {current ? <YearSelect value={year} current={current} onChange={setChosen} /> : <div />}
                <SelectField
                  label={t("form.category")}
                  value={category}
                  onChange={(event) => setCategory(event.target.value as ExpenseCategory | "")}
                >
                  <option value="">{t("allCategories")}</option>
                  {(["purchase", ...MANUAL_CATEGORIES] as ExpenseCategory[]).map((value) => (
                    <option key={value} value={value}>
                      {t(`category.${value}`)}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
          </div>

          {expenses.isError ? (
            <div className="space-y-3">
              <Alert tone="error">{errorText(expenses.error, tErrors)}</Alert>
              <Button variant="secondary" onClick={() => expenses.refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : !expenses.data ? (
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-xl border border-line bg-surface" />
              ))}
            </div>
          ) : expenses.data.length === 0 ? (
            <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
              <ReceiptText className="size-8 text-muted" aria-hidden="true" />
              <p className="font-medium text-ink">{view === "to_impute" ? t("noneToImpute") : t("noExpense")}</p>
            </div>
          ) : (
            <section className="rounded-xl border border-line bg-surface px-4 shadow-card sm:px-5">
              <p className="border-b border-line py-3 text-sm text-muted">
                {t("journalTotal", { count: expenses.data.length, total: money(total) })}
              </p>
              <ul className="divide-y divide-line">
                {expenses.data.map((expense) => (
                  <ExpenseRow key={expense.id} expense={expense} manage={manage} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
