"use client";

import {
  BedDouble,
  Bus,
  Handshake,
  Megaphone,
  PiggyBank,
  Receipt,
  ReceiptText,
  ShoppingCart,
  Ticket,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { PageTabs } from "@/components/ui/page-tabs";
import { SelectField } from "@/components/ui/select-field";
import { cn } from "@/lib/utils";
import type { Budget, ExpenseCategory, FinanceSummary } from "./api";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

const TABS = [
  { key: "budgets", href: "/finance", icon: PiggyBank, right: "budgets" },
  { key: "expenses", href: "/finance/expenses", icon: ReceiptText, right: "budgets" },
  { key: "sponsors", href: "/finance/sponsors", icon: Handshake, right: "sponsors" },
] as const;

/** The pages of the finance module, under its title: those the viewer may see (all while unknown). */
export function FinanceTabs({ current, summary }: { current: (typeof TABS)[number]["key"]; summary?: FinanceSummary }) {
  const t = useTranslations("Finance");
  const shown = TABS.filter(
    ({ right }) =>
      !summary || (right === "budgets" ? summary.can_see_budgets : summary.can_see_sponsors) || right === current,
  );
  return (
    <PageTabs
      label={t("sections")}
      tabs={shown.map((tab) => ({ ...tab, label: t(`tabs.${tab.key}`) }))}
      current={current}
    />
  );
}

/** Amounts in dinars, written the way of the page's language (12 500 DA, ١٢ ٥٠٠ is avoided: latin digits). */
export function useMoney() {
  const t = useTranslations("Finance");
  const format = useFormatter();
  return (amount: string | number) =>
    t("money", {
      amount: format.number(Number(amount), { maximumFractionDigits: 2, numberingSystem: "latn" }),
    });
}

/** The budget years around `current` ("2026-2027"): the next one and the three before, newest first. */
export function yearsAround(current: string) {
  const first = Number(current.slice(0, 4));
  if (!first) {
    return [current];
  }
  return [1, 0, -1, -2, -3].map((shift) => `${first + shift}-${first + shift + 1}`);
}

export function YearSelect({
  value,
  current,
  onChange,
}: {
  value: string;
  current: string;
  onChange: (year: string) => void;
}) {
  const t = useTranslations("Finance");
  return (
    <SelectField label={t("year")} value={value} onChange={(event) => onChange(event.target.value)}>
      {yearsAround(current).map((year) => (
        <option key={year} value={year}>
          {year === current ? t("currentYear", { year }) : year}
        </option>
      ))}
    </SelectField>
  );
}

type Figures = Pick<Budget, "allocated_amount" | "spent" | "committed">;

/** Spent then committed, in % of the allocation (0 when nothing is allocated). */
function shares({ allocated_amount, spent, committed }: Figures) {
  const allocated = Number(allocated_amount);
  if (allocated <= 0) {
    return { spent: Number(spent) > 0 ? 100 : 0, committed: 0 };
  }
  const spentShare = Math.min(100, (Number(spent) / allocated) * 100);
  return { spent: spentShare, committed: Math.min(100 - spentShare, (Number(committed) / allocated) * 100) };
}

/**
 * How much of a budget is spent (dark) and committed by the orders in progress (light): red when the
 * expenses are above the allocation, orange when the orders in progress will take it above.
 */
export function BudgetBar({
  budget,
  className,
}: {
  budget: Figures & Pick<Budget, "is_over" | "will_exceed">;
  className?: string;
}) {
  const t = useTranslations("Finance");
  const share = shares(budget);
  const percent =
    Number(budget.allocated_amount) > 0
      ? Math.round((Number(budget.spent) / Number(budget.allocated_amount)) * 100)
      : null;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        role="meter"
        aria-label={t("bar.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share.spent)}
        aria-valuetext={percent === null ? t("bar.nothingAllocated") : t("bar.spent", { percent: String(percent) })}
        className="flex h-2.5 overflow-hidden rounded-full bg-canvas ring-1 ring-line ring-inset"
      >
        <div
          className={cn("h-full", budget.is_over ? "bg-racing" : budget.will_exceed ? "bg-warning" : "bg-navy")}
          style={{ width: `${share.spent}%` }}
        />
        <div className="h-full bg-navy/30" style={{ width: `${share.committed}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted">
        <span>{percent === null ? t("bar.nothingAllocated") : t("bar.spent", { percent: String(percent) })}</span>
        {Number(budget.committed) > 0 ? <span>{t("bar.committed")}</span> : null}
      </p>
    </div>
  );
}

/** "Over budget" when the expenses are above the allocation, "Will exceed" when the orders will take it above. */
export function BudgetStateBadge({ budget }: { budget: Pick<Budget, "is_over" | "will_exceed"> }) {
  const t = useTranslations("Finance");
  if (budget.is_over) {
    return <Badge tone="danger">{t("state.over")}</Badge>;
  }
  return budget.will_exceed ? <Badge tone="warning">{t("state.willExceed")}</Badge> : null;
}

export const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
  purchase: ShoppingCart,
  registration: Ticket,
  transport: Bus,
  accommodation: BedDouble,
  communication: Megaphone,
  tooling: Wrench,
  other: Receipt,
};

/** A day ("2026-10-15") in the page's language. */
export function useDay() {
  const format = useFormatter();
  return (day: string) =>
    format.dateTime(new Date(`${day}T12:00:00`), { dateStyle: "medium", numberingSystem: "latn" });
}
