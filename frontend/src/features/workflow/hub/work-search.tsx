"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { LoadError } from "@/components/ui/load-error";
import { Link } from "@/i18n/navigation";
import { BlockerStatusBadge, DeliverableStatusBadge, WorkOrderStatusBadge } from "../badges";
import { useWorkSearch } from "./parts";

/** The work module's search: Work Orders, Deliverables, Milestones and blockers the viewer may see, by type. */
export function WorkSearch() {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const id = useId();
  const [words, setWords] = useState("");
  const search = useWorkSearch(words);
  const data = search.data;
  const typed = words.trim().length >= 2;
  const total = data
    ? data.work_orders.length + data.deliverables.length + data.milestones.length + data.blockers.length
    : 0;
  return (
    <section className="space-y-3" role="search" aria-label={t("search.label")}>
      <label htmlFor={id} className="sr-only">
        {t("search.label")}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted"
          aria-hidden="true"
        />
        <input
          id={id}
          type="search"
          dir="auto"
          value={words}
          onChange={(event) => setWords(event.target.value)}
          placeholder={t("search.placeholder")}
          className="h-11 w-full rounded-lg border border-line bg-surface ps-9 pe-3 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none"
        />
      </div>
      {typed && search.isError ? <LoadError error={search.error} /> : null}
      {typed && data && total === 0 ? <p className="text-sm text-muted">{t("search.empty")}</p> : null}
      {typed && data && total > 0 ? (
        <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-card sm:grid-cols-2">
          <Group title={tWorkflow("tabs.workOrders")} show={data.work_orders.length > 0}>
            {data.work_orders.map((item) => (
              <Row key={item.id} href={`/work/orders/${item.id}`} badge={<WorkOrderStatusBadge status={item.status} />}>
                {[item.code, item.title].filter(Boolean).join(" · ")}
              </Row>
            ))}
          </Group>
          <Group title={tWorkflow("tabs.deliverables")} show={data.deliverables.length > 0}>
            {data.deliverables.map((item) => (
              <Row
                key={item.id}
                href={`/work/deliverables/${item.id}`}
                badge={<DeliverableStatusBadge status={item.status} />}
              >
                {[item.code, item.title].filter(Boolean).join(" · ")}
              </Row>
            ))}
          </Group>
          <Group title={t("search.milestones")} show={data.milestones.length > 0}>
            {data.milestones.map((item) => (
              <Row key={item.id} href={`/work/deliverables/${item.deliverable}`}>
                {item.title}
                {item.is_completed ? <span className="ms-2 text-xs text-success">{t("search.completed")}</span> : null}
              </Row>
            ))}
          </Group>
          <Group title={tWorkflow("tabs.blockers")} show={data.blockers.length > 0}>
            {data.blockers.map((item) => (
              <Row
                key={item.id}
                href={
                  item.deliverable
                    ? `/work/deliverables/${item.deliverable}`
                    : item.work_order
                      ? `/work/orders/${item.work_order}`
                      : "/work/blockers"
                }
                badge={<BlockerStatusBadge status={item.status} />}
              >
                {item.description}
              </Row>
            ))}
          </Group>
        </div>
      ) : null}
    </section>
  );
}

function Group({ title, show, children }: { title: string; show: boolean; children: ReactNode }) {
  if (!show) {
    return null;
  }
  return (
    <div className="space-y-1.5">
      <h3 className="eyebrow">{title}</h3>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Row({ href, badge, children }: { href: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <Link href={href} dir="auto" className="min-w-0 truncate text-sm text-ink hover:text-racing">
        {children}
      </Link>
      {badge}
    </li>
  );
}
