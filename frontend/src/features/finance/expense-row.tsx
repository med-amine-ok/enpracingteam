"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Pencil, Trash2, WalletCards } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import {
  changeExpense,
  deleteExpense,
  MANUAL_CATEGORIES,
  recordInvoice,
  type Expense,
  type ExpenseCategory,
} from "./api";
import { CATEGORY_ICONS, textareaClass, useDay, useMoney } from "./finance-parts";
import { refreshFinance, useBudgets } from "./queries";

type Panel = "impute" | "invoice" | "edit" | "delete";

/**
 * One expense: what it was for (the part and its supplier for an order), its budget, its date, who
 * entered it. The finance managers impute it, note its invoice, change or remove it (`manage`).
 */
export function ExpenseRow({
  expense,
  manage,
  showBudget = true,
}: {
  expense: Expense;
  manage: boolean;
  showBudget?: boolean; // false on the budget's own page
}) {
  const t = useTranslations("Finance");
  const money = useMoney();
  const day = useDay();
  const [panel, setPanel] = useState<Panel | null>(null);
  const Icon = CATEGORY_ICONS[expense.category];
  const fromOrder = expense.purchase_request_id !== null;
  const who = `${expense.recorded_by.first_name} ${expense.recorded_by.last_name}`;

  return (
    <li className="space-y-3 py-4">
      <div className="flex gap-3">
        <span
          className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-info-soft text-navy"
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-medium text-ink">
            {fromOrder ? (
              <Link href={`/purchasing/requests/${expense.purchase_request_id}`} className="hover:underline">
                <bdi>{expense.part}</bdi>
              </Link>
            ) : (
              <bdi>{expense.description}</bdi>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            <span>{t(`category.${expense.category}`)}</span>
            {fromOrder && expense.supplier ? (
              <>
                <span aria-hidden="true">·</span>
                <bdi>{expense.supplier}</bdi>
              </>
            ) : null}
            {showBudget ? (
              <>
                <span aria-hidden="true">·</span>
                {expense.budget ? (
                  <Link href={`/finance/budgets/${expense.budget.id}`} className="text-navy hover:underline">
                    <bdi>{expense.budget.org_unit.name}</bdi> {expense.budget.fiscal_year}
                  </Link>
                ) : (
                  <Badge tone="warning">{t("toImpute")}</Badge>
                )}
              </>
            ) : null}
            {expense.invoice ? (
              <Badge tone="success">{t("invoice.badge", { reference: expense.invoice.reference })}</Badge>
            ) : null}
          </p>
          <p className="text-xs text-muted">
            <time dateTime={expense.recorded_at}>{day(expense.recorded_at)}</time> · {t("recordedBy", { who })}
          </p>
        </div>
        <p className="shrink-0 text-end font-semibold text-ink tabular-nums">{money(expense.amount)}</p>
      </div>

      {manage && panel === null ? (
        <div className="flex flex-wrap gap-2 ps-12">
          {fromOrder ? (
            <>
              <Button variant={expense.budget ? "ghost" : "primary"} size="sm" onClick={() => setPanel("impute")}>
                <WalletCards className="size-4" aria-hidden="true" />
                {expense.budget ? t("actions.changeBudget") : t("actions.impute")}
              </Button>
              {expense.invoice ? null : (
                <Button variant="ghost" size="sm" onClick={() => setPanel("invoice")}>
                  <FileCheck2 className="size-4" aria-hidden="true" />
                  {t("actions.invoice")}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setPanel("edit")}>
                <Pencil className="size-4" aria-hidden="true" />
                {t("actions.edit")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPanel("delete")}>
                <Trash2 className="size-4" aria-hidden="true" />
                {t("actions.delete")}
              </Button>
            </>
          )}
        </div>
      ) : null}
      {panel ? <ExpensePanel expense={expense} panel={panel} onClose={() => setPanel(null)} /> : null}
    </li>
  );
}

function ExpensePanel({ expense, panel, onClose }: { expense: Expense; panel: Panel; onClose: () => void }) {
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      onClose();
      await refreshFinance(queryClient);
    },
  });
  const error = act.isError ? <Alert tone="error">{errorText(act.error, tErrors)}</Alert> : null;
  const props = { expense, pending: act.isPending, error, onClose };
  switch (panel) {
    case "impute":
      return <ImputeForm {...props} onSubmit={(budget) => act.mutate(() => changeExpense(expense.id, { budget }))} />;
    case "invoice":
      return <InvoiceForm {...props} onSubmit={(body) => act.mutate(() => recordInvoice(expense.id, body))} />;
    case "edit":
      return <EditForm {...props} onSubmit={(body) => act.mutate(() => changeExpense(expense.id, body))} />;
    case "delete":
      return <DeleteForm {...props} onSubmit={() => act.mutate(() => deleteExpense(expense.id))} />;
  }
}

type FormProps = { expense: Expense; pending: boolean; error: ReactNode; onClose: () => void };

export function PanelFrame({
  title,
  children,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-line bg-canvas p-4" noValidate>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </form>
  );
}

export function PanelButtons({
  confirm,
  pending,
  disabled = false,
  onClose,
}: {
  confirm: string;
  pending: boolean;
  disabled?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Finance");
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" loading={pending} disabled={disabled}>
        {confirm}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t("back")}
      </Button>
    </div>
  );
}

/** The budget an expense goes to: one of its year's budgets, by unit. */
function ImputeForm({
  expense,
  pending,
  error,
  onClose,
  onSubmit,
}: FormProps & { onSubmit: (budget: number) => void }) {
  const t = useTranslations("Finance");
  const budgets = useBudgets(expense.fiscal_year);
  const [budget, setBudget] = useState(expense.budget ? String(expense.budget.id) : "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (budget) {
      onSubmit(Number(budget));
    }
  }

  return (
    <PanelFrame title={t("impute.title", { year: expense.fiscal_year })} onSubmit={submit}>
      {expense.suggested_unit ? (
        <p className="text-sm text-muted">{t("impute.suggested", { unit: expense.suggested_unit.name })}</p>
      ) : null}
      <SelectField
        label={t("impute.budget")}
        value={budget}
        onChange={(event) => setBudget(event.target.value)}
        autoFocus
      >
        <option value="">{t("impute.choose")}</option>
        {budgets.data?.map((option) => (
          <option key={option.id} value={option.id}>
            {option.org_unit.name}
          </option>
        ))}
      </SelectField>
      {budgets.data?.length === 0 ? <p className="text-sm text-muted">{t("impute.noBudget")}</p> : null}
      {error}
      <PanelButtons confirm={t("impute.confirm")} pending={pending} disabled={!budget} onClose={onClose} />
    </PanelFrame>
  );
}

/** The supplier's invoice of a delivered order: its reference, its amount, its date. */
function InvoiceForm({
  expense,
  pending,
  error,
  onClose,
  onSubmit,
}: FormProps & { onSubmit: (body: Parameters<typeof recordInvoice>[1]) => void }) {
  const t = useTranslations("Finance");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(Number(expense.amount)));
  const [issued, setIssued] = useState("");
  const valid = reference.trim() !== "" && amount !== "" && Number(amount) >= 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      onSubmit({ reference: reference.trim(), total_amount: amount, issued_at: issued || null });
    }
  }

  return (
    <PanelFrame title={t("invoice.title", { supplier: expense.supplier ?? "" })} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label={t("invoice.reference")}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          valueDir="ltr"
          autoFocus
        />
        <TextField
          label={t("invoice.amount")}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <TextField
          label={t("invoice.date")}
          type="date"
          value={issued}
          onChange={(event) => setIssued(event.target.value)}
        />
      </div>
      {error}
      <PanelButtons confirm={t("invoice.confirm")} pending={pending} disabled={!valid} onClose={onClose} />
    </PanelFrame>
  );
}

/** What an expense entered by hand was: its kind, amount, date and reason. */
function EditForm({
  expense,
  pending,
  error,
  onClose,
  onSubmit,
}: FormProps & { onSubmit: (body: Parameters<typeof changeExpense>[1]) => void }) {
  const t = useTranslations("Finance");
  const [category, setCategory] = useState<ExpenseCategory>(expense.category);
  const [amount, setAmount] = useState(String(Number(expense.amount)));
  const [day, setDay] = useState(expense.recorded_at);
  const [description, setDescription] = useState(expense.description);
  const descriptionId = useId();
  const valid = amount !== "" && Number(amount) >= 0 && description.trim() !== "" && day !== "";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      onSubmit({ category, amount, recorded_at: day, description: description.trim() });
    }
  }

  return (
    <PanelFrame title={t("edit.title")} onSubmit={submit}>
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
        <TextField label={t("form.date")} type="date" value={day} onChange={(event) => setDay(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={descriptionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("form.reason")}
        </label>
        <textarea
          id={descriptionId}
          rows={2}
          dir="auto"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={textareaClass}
        />
      </div>
      {error}
      <PanelButtons confirm={t("edit.confirm")} pending={pending} disabled={!valid} onClose={onClose} />
    </PanelFrame>
  );
}

function DeleteForm({ pending, error, onClose, onSubmit }: FormProps & { onSubmit: () => void }) {
  const t = useTranslations("Finance");
  return (
    <PanelFrame
      title={t("delete.title")}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <p className="text-sm text-muted">{t("delete.text")}</p>
      {error}
      <PanelButtons confirm={t("delete.confirm")} pending={pending} onClose={onClose} />
    </PanelFrame>
  );
}
