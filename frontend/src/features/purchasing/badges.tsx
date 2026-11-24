"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { Currency, PurchasePriority, PurchaseStatus, SupplierStatus, SupplierType } from "./api";

const STATUS_TONES: Record<PurchaseStatus, BadgeTone> = {
  a_valider_chef: "warning",
  a_valider_operations: "warning",
  a_commander: "info",
  en_commande: "strong",
  livre: "success",
  annule: "danger",
};

const PRIORITY_TONES: Record<PurchasePriority, BadgeTone> = { high: "danger", medium: "warning", low: "neutral" };

const SUPPLIER_STATUS_TONES: Record<SupplierStatus, BadgeTone> = {
  validee: "success",
  en_attente: "warning",
  refusee: "danger",
  pas_encore_envoyee: "neutral",
};

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  const t = useTranslations("Purchasing");
  return <Badge tone={STATUS_TONES[status]}>{t(`status.${status}`)}</Badge>;
}

/** P1 / P2 / P3, as in the team's sheet, with the word for screen readers and the tooltip. */
export function PurchasePriorityBadge({ priority }: { priority: PurchasePriority | "" | null | undefined }) {
  const t = useTranslations("Purchasing");
  if (!priority) {
    return null;
  }
  return (
    <Badge tone={PRIORITY_TONES[priority]}>
      <span aria-hidden="true" title={t(`priority.${priority}`)}>
        {t(`priorityCode.${priority}`)}
      </span>
      <span className="sr-only">{t(`priority.${priority}`)}</span>
    </Badge>
  );
}

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  const t = useTranslations("Purchasing");
  return <Badge tone={SUPPLIER_STATUS_TONES[status]}>{t(`supplierStatus.${status}`)}</Badge>;
}

export function SupplierTypeBadge({ type }: { type: SupplierType | "" | null | undefined }) {
  const t = useTranslations("Purchasing");
  if (!type) {
    return null;
  }
  return <Badge tone="info">{t(`supplierType.${type}`)}</Badge>;
}

/**
 * An amount in its currency, with Latin digits in every language: "10 000,00 DA", "12,50 €".
 * Dinars are written "DA" (the team's habit) rather than the "DZD" of the browsers.
 */
export function useMoney() {
  const t = useTranslations("Purchasing");
  const format = useFormatter();
  return (amount: string | number | null | undefined, currency: Currency = "DZD") => {
    if (amount === null || amount === undefined || amount === "") {
      return "—";
    }
    const value = Number(amount);
    if (currency === "DZD") {
      return t("dinars", {
        amount: format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2, numberingSystem: "latn" }),
      });
    }
    return format.number(value, { style: "currency", currency, numberingSystem: "latn" });
  };
}
