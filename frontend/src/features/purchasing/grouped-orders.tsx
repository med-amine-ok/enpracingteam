"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/errors";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import {
  CURRENCIES,
  orderTogether,
  receiveBatch,
  type Currency,
  type OrderBatch,
  type OrderBatchWrite,
  type PurchaseRequest,
} from "./api";
import { PurchaseStatusBadge, useMoney } from "./badges";
import { refreshPurchasing, useShippingAddresses, useSuppliers } from "./queries";
import { ReceiveForm } from "./receive-form";

type OrderTogetherFormProps = {
  /** The requests to order, all "to order". */
  purchases: PurchaseRequest[];
  onDone: (count: number) => void;
  onClose: () => void;
};

/** Several requests ordered together from one supplier, as one order on its side (decision D-023): what
 * they share, each one's unit price, and the delivery and customs paid once, which the API shares out
 * between them in proportion to their price. */
export function OrderTogetherForm({ purchases, onDone, onClose }: OrderTogetherFormProps) {
  const t = useTranslations("Purchasing");
  const tErrors = useTranslations("Errors");
  const money = useMoney();
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const addresses = useShippingAddresses(true);
  const suggested = [...new Set(purchases.map((purchase) => purchase.suggested_supplier?.id ?? 0))];
  const [supplier, setSupplier] = useState(suggested.length === 1 && suggested[0] ? String(suggested[0]) : "");
  const [currency, setCurrency] = useState<Currency>("DZD");
  const [rate, setRate] = useState("");
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [delivery, setDelivery] = useState("0");
  const [customs, setCustoms] = useState("0");
  const [orderedAt, setOrderedAt] = useState(clubToday(new Date()));
  const [expected, setExpected] = useState("");
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState("");
  const place = useMutation({
    mutationFn: (body: OrderBatchWrite) => orderTogether(body),
    onSuccess: async (batch) => {
      await refreshPurchasing(queryClient);
      onDone(batch.requests.length);
    },
    onError: async (error) => {
      // A request moved meanwhile (409): show the lists as they are now.
      if (error instanceof ApiError && error.status === 409) {
        await refreshPurchasing(queryClient);
      }
    },
  });

  const foreign = currency !== "DZD";
  const short = t(`currencyShort.${currency}`);
  const parts = purchases.reduce((sum, purchase) => sum + purchase.quantity * Number(prices[purchase.id] || 0), 0);
  const total = parts + Number(delivery || 0) + Number(customs || 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    const priced = purchases.every(
      (purchase) => (prices[purchase.id] ?? "") !== "" && Number(prices[purchase.id]) >= 0,
    );
    if (!supplier || !priced || (foreign && !(Number(rate) > 0))) {
      setProblem(t("orderForm.missing"));
      return;
    }
    setProblem("");
    place.mutate({
      supplier_id: Number(supplier),
      currency,
      exchange_rate: foreign ? String(rate) : "1",
      delivery_cost: String(delivery || "0"),
      customs_cost: String(customs || "0"),
      ordered_at: orderedAt || null,
      estimated_delivery_date: expected || null,
      shipping_address_id: address ? Number(address) : null,
      lines: purchases.map((purchase) => ({ request_id: purchase.id, unit_price: String(prices[purchase.id]) })),
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card"
      aria-labelledby="order-together-title"
      noValidate
    >
      <div className="space-y-1">
        <h2 id="order-together-title" className="font-display text-lg font-bold tracking-wide text-navy uppercase">
          {t("batch.title")}
        </h2>
        <p className="text-sm text-muted">{t("batch.intro")}</p>
      </div>
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
        {foreign ? (
          <TextField
            label={t("orderForm.rate", { currency: short })}
            type="number"
            min={0}
            step="0.0001"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        ) : null}
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
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold tracking-widest text-muted uppercase">{t("batch.lines")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {purchases.map((purchase) => (
            <TextField
              key={purchase.id}
              label={t("batch.unitPrice", {
                part: purchase.part.name,
                quantity: String(purchase.quantity),
                currency: short,
              })}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={prices[purchase.id] ?? ""}
              onChange={(event) => setPrices((current) => ({ ...current, [purchase.id]: event.target.value }))}
            />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("batch.delivery", { currency: short })}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={delivery}
          onChange={(event) => setDelivery(event.target.value)}
        />
        <TextField
          label={t("batch.customs", { currency: short })}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={customs}
          onChange={(event) => setCustoms(event.target.value)}
        />
      </div>
      <p className="text-sm text-ink" aria-live="polite">
        {t("batch.total", { count: purchases.length, total: money(total, currency) })}
        {foreign ? ` · ${t("orderForm.totalDinars", { total: money(total * Number(rate || 0)) })}` : null}
      </p>
      {problem ? (
        <Alert tone="error">{problem}</Alert>
      ) : place.isError ? (
        <Alert tone="error">{errorText(place.error, tErrors)}</Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={place.isPending}>
          {t("batch.confirm")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("panels.back")}
        </Button>
      </div>
    </form>
  );
}

/** On a request's page: the requests ordered with it, how many of their parts arrived, and, for
 * Operations, every part still to come received at once. */
export function GroupedOrderCard({ purchaseId, batch }: { purchaseId: number; batch: OrderBatch }) {
  const t = useTranslations("Purchasing");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [receiving, setReceiving] = useState(false);
  const receive = useMutation({
    mutationFn: (body: { actual_delivery_date: string; location: string }) => receiveBatch(batch.id, body),
    onSuccess: async () => {
      setReceiving(false);
      await refreshPurchasing(queryClient);
    },
  });
  const what = (chunks: ReactNode) => <bdi className="font-medium text-ink">{chunks}</bdi>;

  return (
    <Card title={t("grouped.title")}>
      <p className="text-sm text-muted">{t.rich("grouped.intro", { supplier: batch.supplier.name, what })}</p>
      <ul className="mt-3 divide-y divide-line" aria-label={t("grouped.title")}>
        {batch.requests.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
            {row.id === purchaseId ? (
              <span className="min-w-0 flex-1 text-sm">
                <bdi className="font-medium text-ink">{row.part}</bdi>{" "}
                <span className="text-muted">({t("grouped.thisOne")})</span>
              </span>
            ) : (
              <Link
                href={`/purchasing/requests/${row.id}`}
                className="min-w-0 flex-1 text-sm font-medium text-ink hover:underline"
              >
                <bdi>{row.part}</bdi>
              </Link>
            )}
            <span className="text-xs text-muted tabular-nums">
              {t("grouped.receivedOf", { received: String(row.quantity_received), quantity: String(row.quantity) })}
            </span>
            <PurchaseStatusBadge status={row.status} />
          </li>
        ))}
      </ul>
      {batch.can_receive ? (
        <div className="mt-4">
          {receiving ? (
            <ReceiveForm
              title={t("grouped.receiveAllTitle")}
              hint={t("panels.receiveHint")}
              pending={receive.isPending}
              error={receive.isError ? <Alert tone="error">{errorText(receive.error, tErrors)}</Alert> : null}
              onSubmit={({ day, location }) => receive.mutate({ actual_delivery_date: day, location })}
              onClose={() => setReceiving(false)}
            />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setReceiving(true)}>
              <PackageCheck className="size-4" aria-hidden="true" />
              {t("grouped.receiveAll")}
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
