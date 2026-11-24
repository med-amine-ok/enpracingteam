"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, MapPin, Pencil, Search, ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useDeferredValue, useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMembers } from "@/features/members/use-members";
import type { Task } from "@/features/work/api";
import { useTasks } from "@/features/work/queries";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { addToStock, changeStockLine, countStock, takeFromStock, type StockItemDetail } from "./api";
import { refreshStock, stockKeys, useStockItem, useStockSummary } from "./queries";
import { MovementItem, StockLevelBadge } from "./stock-parts";

const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

type Panel = "take" | "add" | "count" | "edit";

/** A stock line: how many are left, what a manager may record, and its history. */
export function StockItemView() {
  const t = useTranslations("Stock");
  const tErrors = useTranslations("Errors");
  const { id } = useParams<{ id: string }>();
  const item = useStockItem(Number(id));

  if (item.isError) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <BackLink href="/stock">{t("title")}</BackLink>
        <Alert tone="error">{errorText(item.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!item.data) {
    return (
      <div className="mx-auto max-w-4xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      </div>
    );
  }
  const data = item.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/stock">{t("title")}</BackLink>
      <Summary item={data} />
      <Card title={t("history.title")}>
        {data.movements.length === 0 ? (
          <p className="text-sm text-muted">{t("history.empty")}</p>
        ) : (
          <ol className="divide-y divide-line">
            {data.movements.map((movement) => (
              <MovementItem key={movement.id} movement={movement} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function Summary({ item }: { item: StockItemDetail }) {
  const t = useTranslations("Stock");
  const tPurchasing = useTranslations("Purchasing");
  const summary = useStockSummary();
  const [panel, setPanel] = useState<Panel | null>(null);
  const manage = summary.data?.can_manage ?? false;

  return (
    <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{tPurchasing(`category.${item.part.category}`)}</Badge>
            <StockLevelBadge quantity={item.quantity_available} low={item.is_low} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink rtl:text-right">
            <bdi>{item.part.name}</bdi>
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden="true" />
              <bdi>{item.location || t("noPlace")}</bdi>
            </span>
            {item.part.reference ? <bdi dir="ltr">{item.part.reference}</bdi> : null}
          </p>
        </div>
        {/* Under the name on a phone (aligned with it), on its right on a wider screen. */}
        <div className="sm:text-end">
          <p className="text-4xl font-semibold text-ink tabular-nums">{String(item.quantity_available)}</p>
          <p className="text-sm text-muted">{t("threshold", { threshold: String(item.min_threshold) })}</p>
        </div>
      </div>

      {panel === null ? (
        <div className="flex flex-wrap gap-2">
          {manage ? (
            <>
              <Button size="sm" onClick={() => setPanel("take")} disabled={item.quantity_available === 0}>
                <ArrowUpFromLine className="size-4" aria-hidden="true" />
                {t("actions.take")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPanel("add")}>
                <ArrowDownToLine className="size-4" aria-hidden="true" />
                {t("actions.add")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPanel("count")}>
                <ClipboardCheck className="size-4" aria-hidden="true" />
                {t("actions.count")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPanel("edit")}>
                <Pencil className="size-4" aria-hidden="true" />
                {t("actions.edit")}
              </Button>
            </>
          ) : null}
          <Link href={`/purchasing/requests/new?part=${item.part.id}`} className={buttonClassName("secondary", "sm")}>
            <ShoppingCart className="size-4" aria-hidden="true" />
            {t("actions.buy")}
          </Link>
        </div>
      ) : (
        <ActionPanel item={item} panel={panel} onClose={() => setPanel(null)} />
      )}
      {summary.data && !manage ? <p className="text-xs text-muted">{t("askManager")}</p> : null}
    </section>
  );
}

function ActionPanel({ item, panel, onClose }: { item: StockItemDetail; panel: Panel; onClose: () => void }) {
  const t = useTranslations("Stock");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (run: () => Promise<StockItemDetail>) => run(),
    onSuccess: async (saved) => {
      queryClient.setQueryData(stockKeys.line(saved.id), saved);
      onClose();
      await refreshStock(queryClient);
    },
  });
  const error = act.isError ? <Alert tone="error">{errorText(act.error, tErrors)}</Alert> : null;
  const props = { item, pending: act.isPending, error, onClose };

  switch (panel) {
    case "take":
      return <TakeForm {...props} onSubmit={(body) => act.mutate(() => takeFromStock(item.id, body))} />;
    case "add":
      return (
        <QuantityForm
          {...props}
          title={t("panels.addTitle")}
          quantityLabel={t("panels.quantity")}
          notesLabel={t("panels.addNotes")}
          confirm={t("panels.addConfirm")}
          onSubmit={(quantity, notes) => act.mutate(() => addToStock(item.id, { quantity, notes }))}
        />
      );
    case "count":
      return (
        <QuantityForm
          {...props}
          title={t("panels.countTitle")}
          quantityLabel={t("panels.counted")}
          notesLabel={t("panels.countNotes")}
          confirm={t("panels.countConfirm")}
          allowZero
          difference
          onSubmit={(counted, notes) => act.mutate(() => countStock(item.id, { counted, notes }))}
        />
      );
    case "edit":
      return (
        <EditForm
          {...props}
          onSubmit={(location, threshold) =>
            act.mutate(() => changeStockLine(item.id, { location, min_threshold: threshold }))
          }
        />
      );
  }
}

type FormProps = { item: StockItemDetail; pending: boolean; error: ReactNode; onClose: () => void };

function PanelFrame({
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
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {children}
    </form>
  );
}

function PanelButtons({
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
  const t = useTranslations("Stock");
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" loading={pending} disabled={disabled}>
        {confirm}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t("panels.back")}
      </Button>
    </div>
  );
}

/** An exit, recorded by a manager: how many, for which task, handed to whom. */
function TakeForm({
  item,
  pending,
  error,
  onClose,
  onSubmit,
}: FormProps & { onSubmit: (body: Parameters<typeof takeFromStock>[1]) => void }) {
  const t = useTranslations("Stock");
  const members = useMembers();
  const [quantity, setQuantity] = useState("1");
  const [task, setTask] = useState<Task | null>(null);
  const [handedTo, setHandedTo] = useState("");
  const [notes, setNotes] = useState("");
  const notesId = useId();
  const count = Number(quantity);
  const valid = Number.isInteger(count) && count >= 1 && count <= item.quantity_available;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      onSubmit({
        quantity: count,
        task_id: task?.id ?? null,
        handed_to_id: handedTo ? Number(handedTo) : null,
        notes: notes.trim(),
      });
    }
  }

  return (
    <PanelFrame title={t("panels.takeTitle")} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("panels.quantityOf", { available: String(item.quantity_available) })}
          type="number"
          min={1}
          max={item.quantity_available}
          step={1}
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          autoFocus
        />
        <SelectField
          label={t("panels.handedTo")}
          value={handedTo}
          onChange={(event) => setHandedTo(event.target.value)}
        >
          <option value="">{t("panels.nobody")}</option>
          {members.data
            ?.filter((member) => member.status !== "alumni")
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.first_name} {member.last_name}
              </option>
            ))}
        </SelectField>
      </div>
      <TaskPicker task={task} onChange={setTask} />
      <div className="space-y-1.5">
        <label htmlFor={notesId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("panels.notes")}
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
      {!valid && quantity !== "" ? (
        <p className="text-sm text-racing-strong">
          {t("panels.tooMany", { available: String(item.quantity_available) })}
        </p>
      ) : null}
      {error}
      <PanelButtons confirm={t("panels.takeConfirm")} pending={pending} disabled={!valid} onClose={onClose} />
    </PanelFrame>
  );
}

/** The task the parts are taken for: searched by its title. */
function TaskPicker({ task, onChange }: { task: Task | null; onChange: (task: Task | null) => void }) {
  const t = useTranslations("Stock");
  const [search, setSearch] = useState("");
  const words = useDeferredValue(search).trim();
  const tasks = useTasks({ search: words }, words.length >= 2);
  if (task) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
        <p className="min-w-0">
          {t("panels.forTask")} <bdi className="font-medium text-ink">{task.title}</bdi>
          <span className="text-muted">
            {" "}
            · <bdi>{task.project.name}</bdi>
          </span>
        </p>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("panels.otherTask")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <TextField
        label={t("panels.task")}
        type="search"
        icon={<Search />}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("panels.taskPlaceholder")}
      />
      {tasks.data && words.length >= 2 ? (
        tasks.data.length === 0 ? (
          <p className="text-sm text-muted">{t("panels.noTask")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {tasks.data.slice(0, 6).map((found) => (
              <li key={found.id}>
                <button
                  type="button"
                  onClick={() => onChange(found)}
                  className="flex w-full flex-col items-start px-4 py-2 text-start text-sm hover:bg-canvas"
                >
                  <bdi className="font-medium text-ink">{found.title}</bdi>
                  <bdi className="text-xs text-muted">{found.project.name}</bdi>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

type QuantityFormProps = FormProps & {
  title: string;
  quantityLabel: string;
  notesLabel: string;
  confirm: string;
  /** A count may be 0 (nothing left); an entry is at least 1. */
  allowZero?: boolean;
  /** Shows the difference with the stock (a count). */
  difference?: boolean;
  onSubmit: (quantity: number, notes: string) => void;
};

/** A manual entry or a count: a number and why (required). */
function QuantityForm({
  item,
  pending,
  error,
  onClose,
  title,
  quantityLabel,
  notesLabel,
  confirm,
  allowZero = false,
  difference = false,
  onSubmit,
}: QuantityFormProps) {
  const t = useTranslations("Stock");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const notesId = useId();
  const count = Number(quantity);
  const valid = quantity !== "" && Number.isInteger(count) && count >= (allowZero ? 0 : 1) && notes.trim().length > 0;
  const gap = count - item.quantity_available;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      onSubmit(count, notes.trim());
    }
  }

  return (
    <PanelFrame title={title} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={quantityLabel}
          type="number"
          min={allowZero ? 0 : 1}
          step={1}
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          autoFocus
        />
        {difference && quantity !== "" && Number.isInteger(count) ? (
          <p className="self-end pb-3 text-sm text-ink" aria-live="polite">
            {gap === 0
              ? t("panels.noDifference")
              : t("panels.difference", { difference: gap > 0 ? `+${gap}` : String(gap) })}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={notesId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {notesLabel}
        </label>
        <textarea
          id={notesId}
          rows={2}
          dir="auto"
          required
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={textareaClass}
        />
      </div>
      {error}
      <PanelButtons confirm={confirm} pending={pending} disabled={!valid} onClose={onClose} />
    </PanelFrame>
  );
}

function EditForm({
  item,
  pending,
  error,
  onClose,
  onSubmit,
}: FormProps & { onSubmit: (location: string, threshold: number) => void }) {
  const t = useTranslations("Stock");
  const [location, setLocation] = useState(item.location);
  const [threshold, setThreshold] = useState(String(item.min_threshold));
  const count = Number(threshold);
  const valid = threshold !== "" && Number.isInteger(count) && count >= 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      onSubmit(location.trim(), count);
    }
  }

  return (
    <PanelFrame title={t("panels.editTitle")} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("panels.location")}
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          autoFocus
        />
        <TextField
          label={t("panels.threshold")}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
        />
      </div>
      {error}
      <PanelButtons confirm={t("panels.editConfirm")} pending={pending} disabled={!valid} onClose={onClose} />
    </PanelFrame>
  );
}
