"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useRouter } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { createExpense, MANUAL_CATEGORIES, type ExpenseCategory } from "./api";
import { textareaClass, YearSelect } from "./finance-parts";
import { refreshFinance, useBudget, useBudgets, useFinanceSummary } from "./queries";

/**
 * An expense that is not a purchase (registration, transport...), entered by the treasurer or an
 * admin: the budget it is taken from, how much, when, and why. ?budget=<id> chooses the budget.
 */
export function NewExpense() {
  const t = useTranslations("Finance");
  const tErrors = useTranslations("Errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const summary = useFinanceSummary();
  const preset = useBudget(Number(params.get("budget") ?? 0));
  const [chosenYear, setChosenYear] = useState("");
  const current = summary.data?.fiscal_year ?? "";
  const year = chosenYear || preset.data?.fiscal_year || current;
  const budgets = useBudgets(year, !!summary.data?.can_manage);
  const [chosenBudget, setChosenBudget] = useState("");
  const budget = chosenBudget || (preset.data && preset.data.fiscal_year === year ? String(preset.data.id) : "");
  const [category, setCategory] = useState<ExpenseCategory>("registration");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(() => clubToday(new Date()));
  const [description, setDescription] = useState("");
  const descriptionId = useId();
  const valid = budget !== "" && amount !== "" && Number(amount) >= 0 && day !== "" && description.trim() !== "";

  const create = useMutation({
    mutationFn: () =>
      createExpense({ budget: Number(budget), category, amount, recorded_at: day, description: description.trim() }),
    onSuccess: async (created) => {
      await refreshFinance(queryClient);
      router.push(created.budget ? `/finance/budgets/${created.budget.id}` : "/finance/expenses");
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      create.mutate();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/finance/expenses">{t("expensesPageTitle")}</BackLink>
      <Card title={t("newExpenseTitle")} description={t("newExpenseIntro")}>
        {summary.data && !summary.data.can_manage ? (
          <Alert tone="info">{t("onlyManagers")}</Alert>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              {current ? (
                <YearSelect
                  value={year}
                  current={current}
                  onChange={(value) => {
                    setChosenYear(value);
                    setChosenBudget("");
                  }}
                />
              ) : (
                <div />
              )}
              <SelectField
                label={t("form.budget")}
                value={budget}
                onChange={(event) => setChosenBudget(event.target.value)}
              >
                <option value="">{t("form.chooseBudget")}</option>
                {budgets.data?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.org_unit.name}
                  </option>
                ))}
              </SelectField>
            </div>
            {budgets.data?.length === 0 ? <p className="text-sm text-muted">{t("noBudgetYear", { year })}</p> : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                label={t("form.category")}
                value={category}
                onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
              >
                {MANUAL_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`category.${value}`)}
                  </option>
                ))}
              </SelectField>
              <TextField
                label={t("form.amount")}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <TextField
                label={t("form.date")}
                type="date"
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={descriptionId}
                className="block text-xs font-semibold tracking-widest text-muted uppercase"
              >
                {t("form.reason")}
              </label>
              <textarea
                id={descriptionId}
                rows={3}
                dir="auto"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("form.reasonPlaceholder")}
                className={textareaClass}
              />
            </div>
            {create.isError ? <Alert tone="error">{errorText(create.error, tErrors)}</Alert> : null}
            <Button type="submit" loading={create.isPending} disabled={!valid}>
              {t("form.createExpense")}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
