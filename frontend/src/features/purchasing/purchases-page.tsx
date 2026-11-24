"use client";

import { Layers, PackageSearch, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TextField } from "@/components/ui/text-field";
import { normalizeText } from "@/features/members/search";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import type { PurchaseFilters, PurchaseRequest, PurchaseSummary } from "./api";
import { PurchasePriorityBadge, PurchaseStatusBadge, useMoney } from "./badges";
import { OrderTogetherForm } from "./grouped-orders";
import { NewPurchaseLink, PurchasingTabs } from "./purchasing-tabs";
import { usePurchases, usePurchaseSummary } from "./queries";

type View = "open" | "to_approve" | "mine" | "to_order" | "delivered" | "cancelled" | "all";

const FILTERS: Record<View, PurchaseFilters> = {
  open: { open: true },
  to_approve: { to_approve: true },
  mine: { mine: true },
  to_order: { status: "a_commander" },
  delivered: { status: "livre" },
  cancelled: { status: "annule" },
  all: {},
};

/** How many requests each view shows, from the counters (undefined: no number to show). */
function viewCounts(summary: PurchaseSummary | undefined): Partial<Record<View, number>> {
  if (!summary) {
    return {};
  }
  const steps = summary.by_status;
  return {
    open: steps.a_valider_chef + steps.a_valider_operations + steps.a_commander + steps.en_commande,
    to_approve: summary.to_approve,
    mine: summary.mine,
    to_order: steps.a_commander,
  };
}

/** Every word of the search appears in the part (name, reference) or the requester's name. */
function matches(purchase: PurchaseRequest, words: string[]) {
  const text = normalizeText(
    [
      purchase.part.name,
      purchase.part.reference,
      `${purchase.requested_by.first_name} ${purchase.requested_by.last_name}`,
      purchase.subsystem?.name ?? "",
      purchase.org_unit?.name ?? "",
    ].join(" "),
  );
  return words.every((word) => text.includes(word));
}

/** The purchase requests of the club: what awaits whom, the viewer's own, the history. */
export function PurchasesPage() {
  const t = useTranslations("Purchasing");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const summary = usePurchaseSummary();
  const [view, setView] = useState<View>("open");
  const [query, setQuery] = useState("");
  // Operations tick requests to order, then order them together (decision D-023).
  const [chosen, setChosen] = useState<number[]>([]);
  const [ordering, setOrdering] = useState(false);
  const [ordered, setOrdered] = useState(0);
  const purchases = usePurchases(FILTERS[view]);
  const words = normalizeText(useDeferredValue(query)).split(/\s+/).filter(Boolean);
  const shown = purchases.data?.filter((purchase) => matches(purchase, words));
  const counts = viewCounts(summary.data);
  const choosing = view === "to_order" && !!summary.data?.can_manage;
  const together = purchases.data?.filter((purchase) => chosen.includes(purchase.id)) ?? [];

  function show(value: View) {
    setView(value);
    setChosen([]);
    setOrdering(false);
    setOrdered(0);
  }

  function toggle(id: number) {
    setOrdered(0);
    setChosen((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  }
  // "To approve by me" only for those who have some; "To order" only for Operations.
  const views: View[] = [
    "open",
    ...(counts.to_approve ? (["to_approve"] as const) : []),
    "mine",
    ...(summary.data?.can_manage ? (["to_order"] as const) : []),
    "delivered",
    "cancelled",
    "all",
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("title")} description={t("intro")}>
        <NewPurchaseLink />
      </PageHeader>
      <PurchasingTabs current="requests" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div role="group" aria-label={t("viewLabel")} className="flex flex-wrap gap-2">
          {views.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === view}
              onClick={() => show(value)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors",
                value === view ? "border-navy bg-navy text-white" : "border-line bg-surface text-muted hover:text-ink",
                value === "to_approve" && value !== view && "border-warning/40 text-warning",
              )}
            >
              {t(`views.${value}`)}
              {counts[value] !== undefined ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    value === view ? "bg-white/20" : "bg-canvas text-ink",
                  )}
                >
                  {String(counts[value])}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-72">
          <TextField
            label={t("searchLabel")}
            type="search"
            icon={<Search />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        </div>
      </div>

      {ordered > 0 ? <Alert tone="success">{t("batch.done", { count: ordered })}</Alert> : null}
      {choosing && ordering ? (
        <OrderTogetherForm
          purchases={together}
          onDone={(count) => {
            setOrdering(false);
            setChosen([]);
            setOrdered(count);
          }}
          onClose={() => setOrdering(false)}
        />
      ) : choosing && (shown?.length ?? 0) > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
          <p className="text-sm text-muted" aria-live="polite">
            {chosen.length < 2 ? t("batch.hint") : t("batch.selected", { count: chosen.length })}
          </p>
          <Button size="sm" disabled={together.length < 2} onClick={() => setOrdering(true)}>
            <Layers className="size-4" aria-hidden="true" />
            {t("actions.orderTogether", { count: together.length })}
          </Button>
        </div>
      ) : null}

      {purchases.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(purchases.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => purchases.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !shown ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
          <PackageSearch className="size-8 text-muted" aria-hidden="true" />
          <p className="font-medium text-ink">{words.length ? t("noMatch") : t(`empty.${view}`)}</p>
        </div>
      ) : (
        <section
          aria-label={t(`views.${view}`)}
          className="overflow-hidden rounded-xl border border-line bg-surface shadow-card"
        >
          <div
            aria-hidden="true"
            className="hidden gap-4 border-b border-line bg-canvas px-5 py-2.5 text-xs font-medium text-muted md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,1.5fr)]"
          >
            <span>{t("columns.part")}</span>
            <span>{t("columns.for")}</span>
            <span>{t("columns.requester")}</span>
            <span className="md:text-end">{t("columns.status")}</span>
          </div>
          <ul className="divide-y divide-line">
            {shown.map((purchase) => (
              <PurchaseRow
                key={purchase.id}
                purchase={purchase}
                choice={
                  choosing && !ordering
                    ? { checked: chosen.includes(purchase.id), onChange: () => toggle(purchase.id) }
                    : undefined
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Project · subsystem, or the unit: what the part is for. */
export function PurchaseTarget({
  purchase,
}: {
  purchase: Pick<PurchaseRequest, "project" | "subsystem" | "org_unit">;
}) {
  const names = purchase.subsystem ? [purchase.project?.name, purchase.subsystem.name] : [purchase.org_unit?.name];
  return (
    <>
      {names
        .filter((name): name is string => !!name)
        .map((name, index) => (
          <span key={index}>
            {index > 0 ? " · " : null}
            <bdi>{name}</bdi>
          </span>
        ))}
    </>
  );
}

type Choice = { checked: boolean; onChange: () => void };

function PurchaseRow({ purchase, choice }: { purchase: PurchaseRequest; choice?: Choice }) {
  const t = useTranslations("Purchasing");
  const format = useFormatter();
  const money = useMoney();
  const requester = `${purchase.requested_by.first_name} ${purchase.requested_by.last_name}`;
  return (
    <li className="relative grid gap-3 px-4 py-4 transition-colors hover:bg-canvas sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,1.5fr)] md:items-center md:gap-4">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {choice ? (
            // Above the link that covers the row.
            <input
              type="checkbox"
              checked={choice.checked}
              onChange={choice.onChange}
              aria-label={t("batch.select", { part: purchase.part.name })}
              className="relative z-10 size-4 cursor-pointer accent-navy"
            />
          ) : null}
          <PurchasePriorityBadge priority={purchase.priority} />
          {/* The whole row opens the request (the link covers it). */}
          <Link
            href={`/purchasing/requests/${purchase.id}`}
            className="font-medium text-ink after:absolute after:inset-0 hover:underline focus-visible:underline"
          >
            <bdi>{purchase.part.name}</bdi>
          </Link>
          <span className="text-sm text-muted">{t("times", { quantity: String(purchase.quantity) })}</span>
        </div>
        {purchase.part.reference ? (
          <p className="text-xs text-muted" dir="auto">
            {purchase.part.reference}
          </p>
        ) : null}
      </div>
      <p className="min-w-0 text-sm text-muted">
        <PurchaseTarget purchase={purchase} />
      </p>
      <div className="min-w-0 text-sm">
        <p className="truncate text-ink">
          <bdi>{requester}</bdi>
        </p>
        {purchase.requested_date ? (
          <p className="text-xs text-muted">
            {t("neededBy", {
              date: format.dateTime(new Date(purchase.requested_date), {
                dateStyle: "medium",
                numberingSystem: "latn",
              }),
            })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-col md:items-end">
        <PurchaseStatusBadge status={purchase.status} />
        {purchase.order ? (
          <span className="text-xs text-muted">
            <bdi>{purchase.order.supplier.name}</bdi>
            {purchase.order.total_price_dzd ? ` · ${money(purchase.order.total_price_dzd)}` : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}
