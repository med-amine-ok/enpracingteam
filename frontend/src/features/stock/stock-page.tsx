"use client";

import { Boxes, MapPin, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { normalizeText } from "@/features/members/search";
import { PART_CATEGORIES, type PartCategory } from "@/features/purchasing/api";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import type { StockItem } from "./api";
import { useStock, useStockSummary } from "./queries";
import { StockLevelBadge, StockTabs } from "./stock-parts";

function matches(item: StockItem, words: string[]) {
  const text = normalizeText([item.part.name, item.part.reference, item.location].join(" "));
  return words.every((word) => text.includes(word));
}

/** The stock: where each part is and how many are left, the low lines first. */
export function StockPage() {
  const t = useTranslations("Stock");
  const tShell = useTranslations("Shell");
  const tPurchasing = useTranslations("Purchasing");
  const tErrors = useTranslations("Errors");
  const summary = useStockSummary();
  const [scope, setScope] = useState<"all" | "low">("all");
  const [category, setCategory] = useState<PartCategory | "">("");
  const [query, setQuery] = useState("");
  const stock = useStock(scope === "low" ? { low: true } : {});
  const words = normalizeText(useDeferredValue(query)).split(/\s+/).filter(Boolean);
  const shown = stock.data?.filter((item) => matches(item, words) && (!category || item.part.category === category));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("title")} description={t("intro")}>
        {summary.data?.can_manage ? (
          <Link href="/stock/new" className={buttonClassName("primary", "md")}>
            {t("newLine")}
          </Link>
        ) : null}
      </PageHeader>
      <StockTabs current="lines" />

      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,14rem)] sm:items-end">
        <Segmented
          label={t("scopeLabel")}
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: summary.data ? t("allCount", { count: String(summary.data.lines) }) : t("all") },
            { value: "low", label: summary.data ? t("lowCount", { count: String(summary.data.low) }) : t("low") },
          ]}
        />
        <TextField
          label={t("searchLabel")}
          type="search"
          icon={<Search />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
        />
        <SelectField
          label={t("category")}
          value={category}
          onChange={(event) => setCategory(event.target.value as PartCategory | "")}
        >
          <option value="">{t("allCategories")}</option>
          {PART_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {tPurchasing(`category.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>

      {stock.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(stock.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => stock.refetch()}>
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
          <Boxes className="size-8 text-muted" aria-hidden="true" />
          <p className="font-medium text-ink">
            {words.length || category ? t("noMatch") : scope === "low" ? t("noneLow") : t("empty")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {shown.map((item) => (
            <StockRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StockRow({ item }: { item: StockItem }) {
  const t = useTranslations("Stock");
  const tPurchasing = useTranslations("Purchasing");
  return (
    <li className="relative flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 transition-colors hover:bg-canvas sm:px-5">
      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={`/stock/${item.id}`}
          className="font-medium text-ink after:absolute after:inset-0 hover:underline focus-visible:underline"
        >
          <bdi>{item.part.name}</bdi>
        </Link>
        <p className="text-xs text-muted">
          {[tPurchasing(`category.${item.part.category}`), item.part.reference].filter(Boolean).join(" · ")}
        </p>
      </div>
      <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted sm:w-48">
        <MapPin className="size-4 shrink-0" aria-hidden="true" />
        <bdi className="truncate">{item.location || t("noPlace")}</bdi>
      </p>
      <div className="flex items-center gap-3 sm:w-52 sm:justify-end">
        <StockLevelBadge quantity={item.quantity_available} low={item.is_low} />
        <p className="text-end">
          <span className="block text-xl font-semibold text-ink tabular-nums">{String(item.quantity_available)}</span>
          <span className="block text-xs text-muted">{t("threshold", { threshold: String(item.min_threshold) })}</span>
        </p>
      </div>
    </li>
  );
}
