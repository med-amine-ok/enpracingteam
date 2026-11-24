"use client";

import { MapPin, Plus, Search, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { CATEGORIES, STATUSES, type Equipment, type EquipmentCategory, type EquipmentStatus } from "./api";
import { useEquipmentList, useWorkshopRights } from "./queries";
import { EquipmentStatusBadge, WorkshopTabs } from "./workshop-parts";

/** The workshop's machines and tools: search, category, status. */
export function WorkshopPage() {
  const t = useTranslations("Workshop");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const rights = useWorkshopRights();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EquipmentCategory | "">("");
  const [status, setStatus] = useState<EquipmentStatus | "">("");
  const words = useDeferredValue(query.trim());
  const items = useEquipmentList({
    ...(words ? { q: words } : {}),
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("title")} description={t("intro")}>
        {rights.data?.manage ? (
          <Link href="/workshop/new" className={buttonClassName("primary", "sm")}>
            <Plus className="size-4" aria-hidden="true" />
            {t("newEquipment")}
          </Link>
        ) : null}
      </PageHeader>
      <WorkshopTabs current="equipment" />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <TextField
            label={t("search")}
            type="search"
            icon={<Search />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="w-52">
          <SelectField
            label={t("categoryLabel")}
            value={category}
            onChange={(event) => setCategory(event.target.value as EquipmentCategory | "")}
          >
            <option value="">{t("allCategories")}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-44">
          <SelectField
            label={t("statusLabel")}
            value={status}
            onChange={(event) => setStatus(event.target.value as EquipmentStatus | "")}
          >
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      {items.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(items.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => items.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !items.data ? (
        <LinesPlaceholder lines={5} />
      ) : items.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.data.map((item) => (
            <EquipmentCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EquipmentCard({ item }: { item: Equipment }) {
  const t = useTranslations("Workshop");
  return (
    <li>
      <Link
        href={`/workshop/${item.id}`}
        className="block h-full space-y-2 rounded-xl border border-line bg-surface p-4 shadow-xs transition-colors hover:border-navy/30"
      >
        <span className="flex items-start justify-between gap-2">
          <span dir="auto" className="min-w-0 font-medium text-ink">
            {item.name}
          </span>
          <EquipmentStatusBadge status={item.status} />
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{t(`category.${item.category}`)}</Badge>
          {item.requires_certification ? (
            <Badge tone={item.certified ? "success" : "warning"}>
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              {item.certified ? t("certified") : t("certificationRequired")}
            </Badge>
          ) : null}
          {!item.loanable ? <Badge tone="neutral">{t("staysInWorkshop")}</Badge> : null}
        </span>
        {item.location ? (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <MapPin className="size-3.5" aria-hidden="true" />
            <bdi>{item.location}</bdi>
          </span>
        ) : null}
      </Link>
    </li>
  );
}
