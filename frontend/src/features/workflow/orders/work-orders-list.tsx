"use client";

import { Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { WORK_ORDER_STATUSES, type WorkOrder, type WorkOrderStatus } from "../api";
import { ProgressMeter, ProposalBadge, WorkOrderStatusBadge } from "../badges";
import { useSeasons, useWorkMe, useWorkOrders } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { isProposal, proposalOutline, useDay } from "./shared";

/** "all" seasons, or a season id; null until chosen: the current season. */
type SeasonChoice = "all" | number | null;

/** The Work Orders, filtered by status, season and words; the proposals the viewer may see on request. */
export function WorkOrdersList() {
  const t = useTranslations("WorkOrders");
  const tFlow = useTranslations("Workflow");
  const me = useWorkMe();
  const seasons = useSeasons();
  const [status, setStatus] = useState<WorkOrderStatus | "">("");
  const [seasonChoice, setSeasonChoice] = useState<SeasonChoice>(null);
  const [search, setSearch] = useState("");
  const [withProposals, setWithProposals] = useState(false);
  const words = useDeferredValue(search.trim());

  const season =
    seasonChoice === null ? (me.data?.current_season?.id ?? null) : seasonChoice === "all" ? null : seasonChoice;
  // The filters the API reads (season, status, search, proposals=include): typed loosely by the API schema.
  const filters = {
    ...(season ? { season } : {}),
    ...(status ? { status } : {}),
    ...(words ? { search: words } : {}),
    ...(withProposals ? { proposals: "include" } : {}),
  };
  // Waits for the viewer's current season before the first read (or reads everything if that failed).
  const orders = useWorkOrders(filters, seasonChoice !== null || !!me.data || me.isError);

  return (
    <div className="space-y-6">
      <WorkflowHeader current="workOrders" description={t("listIntro")}>
        <Link href="/work/orders/new" className={buttonClassName()}>
          <Plus className="size-4" aria-hidden="true" />
          {t("newWorkOrder")}
        </Link>
      </WorkflowHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label={t("search")}
          type="search"
          icon={<Search />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField
          label={t("status")}
          value={status}
          onChange={(event) => setStatus(event.target.value as WorkOrderStatus | "")}
        >
          <option value="">{t("allStatuses")}</option>
          {WORK_ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {tFlow(`workOrderStatus.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("season")}
          value={season ? String(season) : "all"}
          onChange={(event) => setSeasonChoice(event.target.value === "all" ? "all" : Number(event.target.value))}
        >
          <option value="all">{t("allSeasons")}</option>
          {(seasons.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </SelectField>
        <label className="flex items-center gap-2 self-end pb-3 text-sm text-ink">
          <input type="checkbox" checked={withProposals} onChange={(event) => setWithProposals(event.target.checked)} />
          {t("includeProposals")}
        </label>
      </div>

      <Card>
        {orders.error ? (
          <LoadError error={orders.error} />
        ) : !orders.data ? (
          <LinesPlaceholder lines={4} />
        ) : orders.data.length === 0 ? (
          <div className="grid place-items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted">{t("emptyList")}</p>
            <Link href="/work/orders/new" className={buttonClassName("secondary", "sm")}>
              {t("newWorkOrder")}
            </Link>
          </div>
        ) : (
          <WorkOrdersTable orders={orders.data} />
        )}
      </Card>
    </div>
  );
}

export function WorkOrdersTable({ orders }: { orders: WorkOrder[] }) {
  const t = useTranslations("WorkOrders");
  const tFlow = useTranslations("Workflow");
  const day = useDay();
  // The budget is absent for whoever may not see it (guide §2.1): no column at all then, never an empty one.
  const showBudget = orders.some((order) => "budget_tier" in order);
  const head = "px-3 py-2 text-start text-2xs font-semibold tracking-widest text-muted uppercase";
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[56rem] border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr>
            <th className={head}>{t("code")}</th>
            <th className={head}>{t("titleColumn")}</th>
            <th className={head}>{t("project")}</th>
            <th className={head}>{t("department")}</th>
            <th className={head}>{t("status")}</th>
            <th className={head}>{tFlow("progress")}</th>
            <th className={head}>{t("activeDeliverables")}</th>
            <th className={head}>{t("nextDeadline")}</th>
            {showBudget ? <th className={head}>{t("budget")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className={cn("align-middle", isProposal(order.proposal_status) && proposalOutline)}
              data-proposal={isProposal(order.proposal_status) || undefined}
            >
              <td className="px-3 py-2 font-mono text-xs text-muted tabular-nums" dir="ltr">
                {order.code ?? "—"}
              </td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/work/orders/${order.id}`} className="font-medium text-ink hover:text-racing">
                    <bdi dir="auto">{order.title}</bdi>
                  </Link>
                  <ProposalBadge status={order.proposal_status || null} />
                </span>
              </td>
              <td className="px-3 py-2 text-muted">{order.project?.name ?? "—"}</td>
              <td className="px-3 py-2 text-muted">{order.department?.name}</td>
              <td className="px-3 py-2">{order.status ? <WorkOrderStatusBadge status={order.status} /> : null}</td>
              <td className="px-3 py-2">
                <ProgressMeter value={order.progress} label={t("progressOf", { title: order.title })} />
              </td>
              <td className="px-3 py-2 tabular-nums">{order.deliverable_count}</td>
              <td className="px-3 py-2 text-muted tabular-nums">{day(order.next_deadline) || "—"}</td>
              {showBudget ? (
                <td className="px-3 py-2 tabular-nums">
                  {"budget_tier" in order ? (order.budget_tier ?? t("budgetUnset")) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
