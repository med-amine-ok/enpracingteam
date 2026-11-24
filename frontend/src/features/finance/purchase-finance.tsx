"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { ExpenseRow } from "./expense-row";
import { useExpenses, useFinanceSummary } from "./queries";

/**
 * On the page of a delivered purchase: the expense its order became (its budget, its invoice), for
 * those who see that budget. The finance managers impute it and note the invoice from here.
 */
export function PurchaseFinance({ purchaseId }: { purchaseId: number }) {
  const t = useTranslations("Finance");
  const summary = useFinanceSummary();
  const canSee = summary.data?.can_see_budgets ?? false;
  const expenses = useExpenses({ purchase_request: purchaseId }, canSee);
  if (!summary.data || !canSee || !expenses.data) {
    return null;
  }
  const [expense] = expenses.data;
  if (!expense && !summary.data.can_see_all) {
    return null; // its budget is not one the viewer sees
  }
  return (
    <Card title={t("purchaseCard.title")} description={t("purchaseCard.intro")}>
      {expense ? (
        <ul>
          <ExpenseRow expense={expense} manage={summary.data.can_manage} />
        </ul>
      ) : (
        <p className="text-sm text-muted">{t("purchaseCard.noExpense")}</p>
      )}
    </Card>
  );
}
