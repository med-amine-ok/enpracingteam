"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { Link } from "@/i18n/navigation";
import { fetchWorkOrderDependencies, type DependencyLink, type WorkOrderDetail } from "../api";
import { useWorkOrderActivity, workflowKeys } from "../queries";
import { memberName, useDay } from "./shared";

/** The dependencies of its Deliverables (spec §10.9: no Work Order dependency of its own). */
export function WorkOrderDependencies({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  // Under the module's key: every change of the module reads it again (refreshWorkflow).
  const links = useQuery({
    queryKey: [...workflowKeys.all, "work-order-dependencies", order.id],
    queryFn: () => fetchWorkOrderDependencies(order.id),
  });
  return (
    <Card title={t("tab.dependencies")} description={t("dependenciesHint")}>
      {links.error ? (
        <LoadError error={links.error} />
      ) : !links.data ? (
        <LinesPlaceholder lines={3} />
      ) : links.data.length === 0 ? (
        <p className="text-sm text-muted">{t("noDependencies")}</p>
      ) : (
        <ul className="space-y-2">
          {links.data.map((link) => (
            <DependencyRow key={link.id} link={link} />
          ))}
        </ul>
      )}
    </Card>
  );
}

const STATE_TONES = {
  waiting: "warning",
  released: "success",
  informational: "neutral",
  cancelled: "neutral",
} as const;

function DependencyRow({ link }: { link: DependencyLink }) {
  const tFlow = useTranslations("Workflow");
  const end = (item: DependencyLink["prerequisite"]) => (
    <Link href={`/work/deliverables/${item.id}`} className="font-medium text-ink hover:text-racing">
      {item.code ? (
        <span className="me-1.5 font-mono text-xs text-muted" dir="ltr">
          {item.code}
        </span>
      ) : null}
      <bdi dir="auto">{item.title}</bdi>
    </Link>
  );
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line px-4 py-3 text-sm">
      {end(link.prerequisite)}
      <ArrowRight className="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
      {end(link.dependent)}
      <span className="ms-auto flex flex-wrap gap-1.5">
        <Badge tone="info">{tFlow(`dependencyType.${link.link_type}`)}</Badge>
        {link.release_condition && link.link_type === "blocks" ? (
          <Badge>{tFlow(`releaseCondition.${link.release_condition}`)}</Badge>
        ) : null}
        <Badge tone={STATE_TONES[link.state]}>{tFlow(`linkState.${link.state}`)}</Badge>
      </span>
    </li>
  );
}

/** Who did what and when, the Deliverables' events included (newest first, as the API sends them). */
export function WorkOrderActivity({ order }: { order: WorkOrderDetail }) {
  const t = useTranslations("WorkOrders");
  const tFlow = useTranslations("Workflow");
  const day = useDay();
  const activity = useWorkOrderActivity(order.id);
  return (
    <Card title={t("tab.activity")}>
      {activity.error ? (
        <LoadError error={activity.error} />
      ) : !activity.data ? (
        <LinesPlaceholder lines={4} />
      ) : activity.data.length === 0 ? (
        <p className="text-sm text-muted">{tFlow("noneYet")}</p>
      ) : (
        <ol className="space-y-3 border-s border-line ps-4">
          {activity.data.map((event) => (
            <li key={event.id} className="relative space-y-0.5 text-sm">
              <span className="absolute -start-[1.3rem] top-1.5 size-2 rounded-full bg-racing" aria-hidden="true" />
              <p className="text-ink">
                {t("activityLine", {
                  actor: memberName(event.actor) || tFlow("system"),
                  action: tFlow(`action.${event.action}`),
                  entity: tFlow(`entity.${event.entity_type}`),
                })}
              </p>
              <time dateTime={event.occurred_at} className="block text-xs text-muted tabular-nums">
                {day(event.occurred_at, true)}
              </time>
              {event.reason ? (
                <p dir="auto" className="text-xs whitespace-pre-line text-muted">
                  {event.reason}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
