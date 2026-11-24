"use client";

import { ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, History, type LucideIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { PageTabs } from "@/components/ui/page-tabs";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { StockMovement, StockMovementType } from "./api";

const TABS = [
  { key: "lines", href: "/stock", icon: Boxes },
  { key: "journal", href: "/stock/movements", icon: History },
] as const;

/** The two pages of the stock module, side by side under its title. */
export function StockTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  const t = useTranslations("Stock");
  return (
    <PageTabs
      label={t("sections")}
      tabs={TABS.map((tab) => ({ ...tab, label: t(`tabs.${tab.key}`) }))}
      current={current}
    />
  );
}

/** "Out of stock" at zero, "Low" at the threshold or below, nothing otherwise. */
export function StockLevelBadge({ quantity, low }: { quantity: number; low: boolean }) {
  const t = useTranslations("Stock");
  if (quantity === 0) {
    return <Badge tone="danger">{t("level.empty")}</Badge>;
  }
  return low ? <Badge tone="warning">{t("level.low")}</Badge> : null;
}

const ICONS: Record<StockMovementType, LucideIcon> = {
  in: ArrowDownToLine,
  out: ArrowUpFromLine,
  adjustment: ClipboardCheck,
};

/** One movement: what came in or went out, who did it, for which task or purchase, when. */
export function MovementItem({
  movement,
  showPart = false,
  showTask = true,
}: {
  movement: StockMovement;
  showPart?: boolean;
  showTask?: boolean; // false on the task's own page
}) {
  const task = showTask ? movement.task : null;
  const t = useTranslations("Stock");
  const format = useFormatter();
  const Icon = ICONS[movement.movement_type];
  const who = `${movement.moved_by.first_name} ${movement.moved_by.last_name}`;
  const name = (chunks: ReactNode) => <bdi className="font-medium text-ink">{chunks}</bdi>;
  const kind = movement.movement_type === "adjustment" ? "count" : movement.movement_type === "out" ? "take" : "add";
  return (
    <li className="flex gap-3 py-3">
      <span
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
          movement.change < 0 ? "bg-racing-soft text-racing-strong" : "bg-success-soft text-success",
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p className="text-ink">
          <span className="font-semibold tabular-nums" dir="ltr">
            {movement.change > 0 ? `+${movement.change}` : String(movement.change)}
          </span>{" "}
          {showPart ? (
            <Link href={`/stock/${movement.stock_item.id}`} className="font-medium hover:underline">
              <bdi>{movement.stock_item.part}</bdi>
            </Link>
          ) : null}{" "}
          {t.rich(`history.${kind}`, { who: name, actor: who })}
          {movement.handed_to ? (
            <>
              {" "}
              ·{" "}
              {t.rich("history.handedTo", {
                who: name,
                name: `${movement.handed_to.first_name} ${movement.handed_to.last_name}`,
              })}
            </>
          ) : null}
        </p>
        {task || movement.purchase_request_id ? (
          <p className="text-muted">
            {task ? (
              <>
                {t("history.forTask")}{" "}
                <Link href={`/tasks/${task.id}`} className="text-navy hover:underline">
                  <bdi>{task.title}</bdi>
                </Link>
              </>
            ) : null}
            {movement.purchase_request_id ? (
              <Link href={`/purchasing/requests/${movement.purchase_request_id}`} className="text-navy hover:underline">
                {t("history.fromPurchase")}
              </Link>
            ) : null}
          </p>
        ) : null}
        {movement.notes ? (
          <p className="text-muted">
            «&nbsp;<bdi>{movement.notes}</bdi>&nbsp;»
          </p>
        ) : null}
        <time dateTime={movement.moved_at} className="block text-xs text-muted">
          {showPart && movement.stock_item.location ? (
            <>
              <bdi>{movement.stock_item.location}</bdi>
              {" · "}
            </>
          ) : null}
          {format.dateTime(new Date(movement.moved_at), {
            dateStyle: "medium",
            timeStyle: "short",
            numberingSystem: "latn",
          })}
        </time>
      </div>
    </li>
  );
}
