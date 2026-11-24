"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Check,
  CircleCheck,
  CircleX,
  PackageCheck,
  PackageOpen,
  PackageX,
  Pencil,
  Send,
  ShoppingCart,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { PurchaseFinance } from "@/features/finance/purchase-finance";
import { ApiError } from "@/lib/api/errors";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import {
  CURRENCIES,
  approvePurchase,
  cancelOrder,
  cancelPurchase,
  changeOrder,
  closeOrder,
  placeOrder,
  receivePurchase,
  refusePurchase,
  type Currency,
  type OrderWrite,
  type PurchaseAction,
  type PurchaseEvent,
  type PurchaseOrder,
  type PurchaseRequestDetail,
  type PurchaseStatus,
} from "./api";
import { PurchasePriorityBadge, PurchaseStatusBadge, useMoney } from "./badges";
import { GroupedOrderCard } from "./grouped-orders";
import { PurchaseForm } from "./purchase-form";
import { PurchaseTarget } from "./purchases-page";
import { purchasingKeys, refreshPurchasing, usePurchase, useShippingAddresses, useSuppliers } from "./queries";
import { ReceiveForm } from "./receive-form";

const STEPS: PurchaseStatus[] = ["a_valider_chef", "a_valider_operations", "a_commander", "en_commande", "livre"];

const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

type Panel = "approve" | "refuse" | "cancel" | "order" | "changeOrder" | "receive" | "cancelOrder" | "closeOrder";

/** A purchase request: where it stands, what the viewer may do next, its order and its history. */
export function PurchaseView() {
  const t = useTranslations("Purchasing");
  const tErrors = useTranslations("Errors");
  const { id } = useParams<{ id: string }>();
  const purchase = usePurchase(Number(id));
  const [editing, setEditing] = useState(false);

  if (purchase.isError) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <BackLink href="/purchasing">{t("title")}</BackLink>
        <Alert tone="error">{errorText(purchase.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!purchase.data) {
    return (
      <div className="mx-auto max-w-4xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      </div>
    );
  }
  const data = purchase.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/purchasing">{t("title")}</BackLink>
      {editing ? (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("form.editTitle")}</h1>
          <PurchaseForm purchase={data} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
        </section>
      ) : (
        <>
          <Summary purchase={data} onEdit={() => setEditing(true)} />
          <Details purchase={data} />
          {data.order ? <OrderCard purchase={data} order={data.order} /> : null}
          {data.grouped_order ? <GroupedOrderCard purchaseId={data.id} batch={data.grouped_order} /> : null}
          {data.status === "livre" ? <PurchaseFinance purchaseId={data.id} /> : null}
          <History events={data.events} />
        </>
      )}
    </div>
  );
}

function Summary({ purchase, onEdit }: { purchase: PurchaseRequestDetail; onEdit: () => void }) {
  const t = useTranslations("Purchasing");
  const format = useFormatter();
  const [panel, setPanel] = useState<Panel | null>(null);
  const { permissions } = purchase;
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });
  const requester = `${purchase.requested_by.first_name} ${purchase.requested_by.last_name}`;

  return (
    <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PurchaseStatusBadge status={purchase.status} />
          <PurchasePriorityBadge priority={purchase.priority} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink rtl:text-right">
          <bdi>{purchase.part.name}</bdi>{" "}
          <span className="text-lg font-normal text-muted">{t("times", { quantity: String(purchase.quantity) })}</span>
        </h1>
        <p className="text-sm text-muted">
          {t.rich("askedBy", {
            who: (chunks) => <bdi className="font-medium text-ink">{chunks}</bdi>,
            name: requester,
            date: date(purchase.created_at),
          })}
        </p>
        <p className="text-sm text-muted">
          {t("forLabel")} <PurchaseTarget purchase={purchase} />
          {purchase.requested_date ? (
            <>
              {" · "}
              {t("neededBy", { date: date(purchase.requested_date) })}
            </>
          ) : null}
        </p>
      </div>

      <Steps status={purchase.status} />
      <NextStep purchase={purchase} />

      {panel === null ? (
        <div className="flex flex-wrap gap-2">
          {permissions.approve ? (
            <>
              <Button size="sm" onClick={() => setPanel("approve")}>
                <Check className="size-4" aria-hidden="true" />
                {t("actions.approve")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPanel("refuse")}>
                {t("actions.refuse")}
              </Button>
            </>
          ) : null}
          {permissions.order ? (
            <Button size="sm" onClick={() => setPanel("order")}>
              <ShoppingCart className="size-4" aria-hidden="true" />
              {t("actions.order")}
            </Button>
          ) : null}
          {permissions.manage_order ? (
            <>
              <Button size="sm" onClick={() => setPanel("receive")}>
                <PackageCheck className="size-4" aria-hidden="true" />
                {t("actions.receive")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPanel("changeOrder")}>
                {t("actions.changeOrder")}
              </Button>
            </>
          ) : null}
          {permissions.cancel_order ? (
            <Button variant="secondary" size="sm" onClick={() => setPanel("cancelOrder")}>
              {t("actions.cancelOrder")}
            </Button>
          ) : null}
          {permissions.close_order ? (
            <Button variant="secondary" size="sm" onClick={() => setPanel("closeOrder")}>
              {t("actions.closeOrder")}
            </Button>
          ) : null}
          {permissions.edit ? (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("actions.edit")}
            </Button>
          ) : null}
          {permissions.cancel ? (
            <Button variant="ghost" size="sm" onClick={() => setPanel("cancel")}>
              {t("actions.cancel")}
            </Button>
          ) : null}
        </div>
      ) : (
        <ActionPanel purchase={purchase} panel={panel} onClose={() => setPanel(null)} />
      )}
    </section>
  );
}

/** The five steps of a request, the current one marked (a cancelled request shows none). */
function Steps({ status }: { status: PurchaseStatus }) {
  const t = useTranslations("Purchasing");
  if (status === "annule") {
    return null;
  }
  const current = STEPS.indexOf(status);
  return (
    <ol aria-label={t("stepsLabel")} className="grid gap-2 sm:grid-cols-5">
      {STEPS.map((step, index) => {
        const done = index < current || status === "livre";
        const isCurrent = index === current && status !== "livre";
        return (
          <li
            key={step}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium",
              done && "border-success/20 bg-success-soft text-success",
              isCurrent && "border-navy bg-info-soft text-navy",
              !done && !isCurrent && "border-line text-muted",
            )}
          >
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[0.7rem]",
                done ? "bg-success text-white" : isCurrent ? "bg-navy text-white" : "bg-canvas",
              )}
              aria-hidden="true"
            >
              {done ? <Check className="size-3" /> : index + 1}
            </span>
            <span className="sr-only">{`${index + 1}. `}</span>
            {t(`status.${step}`)}
            {done ? <span className="sr-only">{t("stepDone")}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** What the request waits for now, in a sentence. */
function NextStep({ purchase }: { purchase: PurchaseRequestDetail }) {
  const t = useTranslations("Purchasing");
  const format = useFormatter();
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "long", numberingSystem: "latn" });
  if (purchase.status === "annule") {
    const last = purchase.events.at(-1);
    return (
      <Alert tone="warning">
        <p className="font-medium">{last?.action === "refused" ? t("next.refused") : t("next.annule")}</p>
        {last?.comment ? (
          <p className="mt-1">
            «&nbsp;<bdi>{last.comment}</bdi>&nbsp;»
          </p>
        ) : null}
      </Alert>
    );
  }
  const received = purchase.order?.quantity_received ?? 0;
  if (purchase.status === "en_commande" && received > 0) {
    return (
      <p className="text-sm text-ink">{t("next.partlyReceived", { received, quantity: String(purchase.quantity) })}</p>
    );
  }
  if (purchase.status === "en_commande" && purchase.order?.estimated_delivery_date) {
    return (
      <p className="text-sm text-ink">{t("next.expected", { date: date(purchase.order.estimated_delivery_date) })}</p>
    );
  }
  if (purchase.status === "livre" && purchase.order?.actual_delivery_date) {
    return (
      <p className="text-sm text-ink">{t("next.delivered", { date: date(purchase.order.actual_delivery_date) })}</p>
    );
  }
  return <p className="text-sm text-ink">{t(`next.${purchase.status}`)}</p>;
}

/** The form of the chosen action, under the buttons; the request is read again after it. */
function ActionPanel({
  purchase,
  panel,
  onClose,
}: {
  purchase: PurchaseRequestDetail;
  panel: Panel;
  onClose: () => void;
}) {
  const t = useTranslations("Purchasing");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (run: () => Promise<PurchaseRequestDetail>) => run(),
    onSuccess: async (saved) => {
      queryClient.setQueryData(purchasingKeys.purchase(saved.id), saved);
      onClose();
      await refreshPurchasing(queryClient);
    },
    onError: async (error) => {
      // Someone acted first (409): show where the request stands now.
      if (error instanceof ApiError && error.status === 409) {
        await refreshPurchasing(queryClient);
      }
    },
  });
  const error = act.isError ? <Alert tone="error">{errorText(act.error, tErrors)}</Alert> : null;
  const id = purchase.id;

  switch (panel) {
    case "approve":
      return (
        <TextPanel
          title={t("panels.approveTitle")}
          label={t("panels.comment")}
          optional
          confirm={t("panels.approveConfirm")}
          pending={act.isPending}
          error={error}
          onConfirm={(comment) => act.mutate(() => approvePurchase(id, comment))}
          onClose={onClose}
        />
      );
    case "refuse":
    case "cancel":
    case "cancelOrder":
    case "closeOrder":
      return (
        <TextPanel
          title={t(`panels.${panel}Title`)}
          label={t("panels.reason")}
          confirm={t(`panels.${panel}Confirm`)}
          pending={act.isPending}
          error={error}
          onConfirm={(reason) =>
            act.mutate(() =>
              panel === "refuse"
                ? refusePurchase(id, reason)
                : panel === "cancel"
                  ? cancelPurchase(id, reason)
                  : panel === "closeOrder"
                    ? closeOrder(id, reason)
                    : cancelOrder(id, reason),
            )
          }
          onClose={onClose}
        />
      );
    case "order":
    case "changeOrder":
      return (
        <OrderForm
          purchase={purchase}
          order={panel === "changeOrder" ? purchase.order : null}
          pending={act.isPending}
          error={error}
          onSubmit={(body) => act.mutate(() => (panel === "order" ? placeOrder(id, body) : changeOrder(id, body)))}
          onClose={onClose}
        />
      );
    case "receive":
      return (
        <ReceiveForm
          title={t("panels.receiveTitle")}
          hint={t("panels.receiveHint")}
          parts={{ quantity: purchase.quantity, received: purchase.order?.quantity_received ?? 0 }}
          pending={act.isPending}
          error={error}
          onSubmit={({ day, location, quantity }) =>
            act.mutate(() => receivePurchase(id, { actual_delivery_date: day, location, quantity }))
          }
          onClose={onClose}
        />
      );
  }
}

type TextPanelProps = {
  title: string;
  label: string;
  /** The text may stay empty (an approval comment); else the confirmation waits for it. */
  optional?: boolean;
  confirm: string;
  pending: boolean;
  error: ReactNode;
  onConfirm: (text: string) => void;
  onClose: () => void;
};

function TextPanel({ title, label, optional = false, confirm, pending, error, onConfirm, onClose }: TextPanelProps) {
  const t = useTranslations("Purchasing");
  const [text, setText] = useState("");
  const fieldId = useId();
  const ready = optional || text.trim().length > 0;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) {
      onConfirm(text.trim());
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="space-y-1.5">
        <label htmlFor={fieldId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {label}
        </label>
        <textarea
          id={fieldId}
          rows={2}
          dir="auto"
          autoFocus
          required={!optional}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={textareaClass}
        />
      </div>
      {error}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={!ready}>
          {confirm}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("panels.back")}
        </Button>
      </div>
    </form>
  );
}

type OrderFormProps = {
  purchase: PurchaseRequestDetail;
  /** The order to change; null: a new order. */
  order: PurchaseOrder | null;
  pending: boolean;
  error: ReactNode;
  onSubmit: (body: OrderWrite) => void;
  onClose: () => void;
};

/** Supplier, prices in its currency at the rate actually paid, dates; the totals as they will be saved. */
function OrderForm({ purchase, order, pending, error, onSubmit, onClose }: OrderFormProps) {
  const t = useTranslations("Purchasing");
  const money = useMoney();
  const suppliers = useSuppliers();
  const addresses = useShippingAddresses(true);
  const [supplier, setSupplier] = useState(String(order?.supplier.id ?? purchase.suggested_supplier?.id ?? ""));
  const [currency, setCurrency] = useState<Currency>(order?.currency ?? "DZD");
  const [rate, setRate] = useState(order && order.currency !== "DZD" ? order.exchange_rate : "");
  const [unitPrice, setUnitPrice] = useState(order?.unit_price ?? "");
  const [delivery, setDelivery] = useState(order?.delivery_cost ?? "0");
  const [customs, setCustoms] = useState(order?.customs_cost ?? "0");
  const [orderedAt, setOrderedAt] = useState(order?.ordered_at ?? clubToday(new Date()));
  const [expected, setExpected] = useState(order?.estimated_delivery_date ?? "");
  const [address, setAddress] = useState(String(order?.shipping_address?.id ?? ""));
  const [problem, setProblem] = useState("");

  const foreign = currency !== "DZD";
  const total = purchase.quantity * Number(unitPrice || 0) + Number(delivery || 0) + Number(customs || 0);
  const totalDinars = total * (foreign ? Number(rate || 0) : 1);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!supplier || unitPrice === "" || Number(unitPrice) < 0 || (foreign && !(Number(rate) > 0))) {
      setProblem(t("orderForm.missing"));
      return;
    }
    setProblem("");
    onSubmit({
      supplier_id: Number(supplier),
      unit_price: String(unitPrice),
      currency,
      exchange_rate: foreign ? String(rate) : "1",
      delivery_cost: String(delivery || "0"),
      customs_cost: String(customs || "0"),
      ordered_at: orderedAt || null,
      estimated_delivery_date: expected || null,
      shipping_address_id: address ? Number(address) : null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-canvas p-4" noValidate>
      <h2 className="text-sm font-semibold text-ink">
        {order ? t("panels.changeOrderTitle") : t("panels.orderTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("orderForm.supplier")}
          value={supplier}
          onChange={(event) => setSupplier(event.target.value)}
        >
          <option value="">{t("orderForm.chooseSupplier")}</option>
          {suppliers.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("orderForm.currency")}
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {t(`currency.${code}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t("orderForm.unitPrice", { currency: t(`currencyShort.${currency}`) })}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={unitPrice}
          onChange={(event) => setUnitPrice(event.target.value)}
        />
        {foreign ? (
          <TextField
            label={t("orderForm.rate", { currency: t(`currencyShort.${currency}`) })}
            type="number"
            min={0}
            step="0.0001"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        ) : null}
        <TextField
          label={t("orderForm.delivery", { currency: t(`currencyShort.${currency}`) })}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={delivery}
          onChange={(event) => setDelivery(event.target.value)}
        />
        <TextField
          label={t("orderForm.customs", { currency: t(`currencyShort.${currency}`) })}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={customs}
          onChange={(event) => setCustoms(event.target.value)}
        />
        <TextField
          label={t("orderForm.orderedAt")}
          type="date"
          value={orderedAt}
          onChange={(event) => setOrderedAt(event.target.value)}
        />
        <TextField
          label={t("orderForm.expected")}
          type="date"
          value={expected}
          onChange={(event) => setExpected(event.target.value)}
        />
        {addresses.data && addresses.data.length > 0 ? (
          <SelectField
            label={t("orderForm.address")}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          >
            <option value="">{t("orderForm.noAddress")}</option>
            {addresses.data.map((item) => (
              <option key={item.id} value={item.id}>
                {[item.country, item.address].filter(Boolean).join(" — ")}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
      <p className="text-sm text-ink" aria-live="polite">
        {t("orderForm.total", {
          quantity: String(purchase.quantity),
          total: money(total, currency),
        })}
        {foreign ? ` · ${t("orderForm.totalDinars", { total: money(totalDinars) })}` : null}
      </p>
      {problem ? <Alert tone="error">{problem}</Alert> : error}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {order ? t("panels.changeOrderConfirm") : t("panels.orderConfirm")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("panels.back")}
        </Button>
      </div>
    </form>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function Details({ purchase }: { purchase: PurchaseRequestDetail }) {
  const t = useTranslations("Purchasing");
  const { part } = purchase;
  return (
    <Card title={t("details.title")}>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label={t("details.category")}>{t(`category.${part.category}`)}</Fact>
        {part.reference ? (
          <Fact label={t("details.reference")}>
            <bdi>{part.reference}</bdi>
          </Fact>
        ) : null}
        {part.material ? (
          <Fact label={t("details.material")}>
            <bdi>{part.material}</bdi>
          </Fact>
        ) : null}
        {part.process ? (
          <Fact label={t("details.process")}>
            <bdi>{part.process}</bdi>
          </Fact>
        ) : null}
        {purchase.suggested_supplier ? (
          <Fact label={t("details.suggestedSupplier")}>
            <bdi>{purchase.suggested_supplier.name}</bdi>
          </Fact>
        ) : null}
      </dl>
      {part.description ? (
        <p dir="auto" className="mt-4 text-sm whitespace-pre-line text-ink rtl:text-right">
          {part.description}
        </p>
      ) : null}
      {purchase.notes ? (
        <div className="mt-4 rounded-lg bg-canvas px-4 py-3">
          <p className="text-xs text-muted">{t("details.notes")}</p>
          <p dir="auto" className="text-sm whitespace-pre-line text-ink rtl:text-right">
            {purchase.notes}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function OrderCard({ purchase, order }: { purchase: PurchaseRequestDetail; order: PurchaseOrder }) {
  const t = useTranslations("Purchasing");
  const format = useFormatter();
  const money = useMoney();
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });
  const currency = order.currency;
  // Closed with what arrived: only the parts that arrived are paid (decision D-023).
  const billed =
    order.status === "livre" && order.quantity_received > 0
      ? Math.min(order.quantity_received, purchase.quantity)
      : purchase.quantity;
  return (
    <Card title={t("orderCard.title")}>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label={t("orderCard.supplier")}>
          <bdi>{order.supplier.name}</bdi>
        </Fact>
        {order.ordered_at ? <Fact label={t("orderCard.orderedAt")}>{date(order.ordered_at)}</Fact> : null}
        {order.status === "livre" && order.actual_delivery_date ? (
          <Fact label={t("orderCard.deliveredOn")}>{date(order.actual_delivery_date)}</Fact>
        ) : order.estimated_delivery_date ? (
          <Fact label={t("orderCard.expected")}>{date(order.estimated_delivery_date)}</Fact>
        ) : null}
        {order.quantity_received > 0 ? (
          <Fact label={t("orderCard.received")}>
            {t("orderCard.receivedValue", {
              received: String(order.quantity_received),
              quantity: String(purchase.quantity),
            })}
          </Fact>
        ) : null}
      </dl>
      <table className="mt-5 w-full text-sm">
        <caption className="sr-only">{t("orderCard.amounts")}</caption>
        <tbody className="divide-y divide-line">
          <AmountRow
            label={t("orderCard.parts", {
              quantity: String(billed),
              price: money(order.unit_price, currency),
            })}
            amount={order.unit_price === null ? "—" : money(Number(order.unit_price) * billed, currency)}
          />
          <AmountRow label={t("orderCard.delivery")} amount={money(order.delivery_cost, currency)} />
          <AmountRow label={t("orderCard.customs")} amount={money(order.customs_cost, currency)} />
          <AmountRow label={t("orderCard.total")} amount={money(order.total_price, currency)} strong />
          {currency !== "DZD" ? (
            <>
              <AmountRow
                label={t("orderCard.rate")}
                amount={t("orderCard.rateValue", {
                  unit: money(1, currency),
                  dinars: money(order.exchange_rate),
                })}
              />
              <AmountRow label={t("orderCard.totalDinars")} amount={money(order.total_price_dzd)} strong />
            </>
          ) : null}
        </tbody>
      </table>
      {order.shipping_address ? (
        <p className="mt-4 text-sm text-muted">
          {t("orderCard.shippedTo")}{" "}
          <bdi className="text-ink">
            {[order.shipping_address.country, order.shipping_address.address].filter(Boolean).join(" — ")}
          </bdi>
        </p>
      ) : null}
    </Card>
  );
}

function AmountRow({ label, amount, strong = false }: { label: string; amount: string; strong?: boolean }) {
  return (
    <tr className={cn(strong && "font-semibold")}>
      <th scope="row" className="py-2 text-start font-normal text-muted">
        {label}
      </th>
      <td className="py-2 text-end text-ink tabular-nums">{amount}</td>
    </tr>
  );
}

const EVENT_ICONS: Record<PurchaseAction, LucideIcon> = {
  requested: Send,
  approved: CircleCheck,
  refused: CircleX,
  ordered: ShoppingCart,
  order_cancelled: Undo2,
  received: PackageCheck,
  partly_received: PackageOpen,
  closed_short: PackageX,
  cancelled: Ban,
};

/** The sentence of a history line: an approval names its level (from the status it reached). */
function eventKey(event: PurchaseEvent) {
  if (event.action === "approved") {
    if (event.status === "a_valider_operations") {
      return "approvedLeader";
    }
    return event.actor ? "approvedOperations" : "approvedOperationsUnnamed";
  }
  switch (event.action) {
    case "order_cancelled":
      return "orderCancelled";
    case "partly_received":
      return "partlyReceived";
    case "closed_short":
      return "closedShort";
    default:
      return event.action;
  }
}

function History({ events }: { events: PurchaseEvent[] }) {
  const t = useTranslations("Purchasing");
  const format = useFormatter();
  return (
    <Card title={t("history.title")}>
      <ol className="space-y-4">
        {events.map((event) => {
          const Icon = EVENT_ICONS[event.action];
          const actor = event.actor ? `${event.actor.first_name} ${event.actor.last_name}` : t("someone");
          return (
            <li key={event.id} className="flex gap-3">
              <span
                className={cn(
                  "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                  event.action === "refused" || event.action === "cancelled" || event.action === "order_cancelled"
                    ? "bg-racing-soft text-racing-strong"
                    : "bg-info-soft text-navy",
                )}
                aria-hidden="true"
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="text-ink">
                  {t.rich(`history.${eventKey(event)}`, {
                    who: (chunks) => <bdi className="font-medium">{chunks}</bdi>,
                    actor,
                    count: event.quantity ?? 0,
                  })}
                </p>
                {event.comment ? (
                  <p className="text-muted">
                    «&nbsp;<bdi>{event.comment}</bdi>&nbsp;»
                  </p>
                ) : null}
                <time dateTime={event.created_at} className="block text-xs text-muted">
                  {format.dateTime(new Date(event.created_at), {
                    dateStyle: "medium",
                    timeStyle: "short",
                    numberingSystem: "latn",
                  })}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
