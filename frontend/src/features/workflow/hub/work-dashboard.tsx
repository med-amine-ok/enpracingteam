"use client";

import { CalendarClock, ClipboardPlus, ListChecks, OctagonAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { LoadError } from "@/components/ui/load-error";
import { Link } from "@/i18n/navigation";
import type { Activity, Blocker, Deliverable, WorkDashboard as Dashboard, Workload } from "../api";
import { DeliverableStates, ImpactBadge, ProgressMeter, SeverityBadge } from "../badges";
import { useWorkDashboard } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { Empty, isoDay, personName, useDates } from "./parts";
import { WorkSearch } from "./work-search";

/** The deadline that counts: the effective one (after approved relief), else the original. */
function deadlineOf(item: Deliverable) {
  return item.effective_deadline ?? item.original_deadline ?? null;
}

/**
 * The work module's home (front guide §5): the member's own work, and for a Head the decisions and risks of the
 * departments they lead. Operational only: no figure here comes from the scoring (guide §2.1).
 */
export function WorkDashboard() {
  const t = useTranslations("WorkHub");
  const dashboard = useWorkDashboard();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <WorkflowHeader current="dashboard" description={t("dashboard.intro")} />
      <WorkSearch />
      {dashboard.isError ? (
        <div className="space-y-3">
          <LoadError error={dashboard.error} />
          <Button variant="secondary" onClick={() => dashboard.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !dashboard.data ? (
        <LinesPlaceholder lines={6} />
      ) : (
        <>
          <MemberPart member={dashboard.data.member} />
          {dashboard.data.head ? <HeadPart head={dashboard.data.head} /> : null}
        </>
      )}
    </div>
  );
}

function MemberPart({ member }: { member: Dashboard["member"] }) {
  const t = useTranslations("WorkHub");
  const { cards } = member;
  const today = isoDay();
  const upcoming = member.deliverables
    .filter((item) => {
      const deadline = deadlineOf(item);
      return deadline && deadline >= today;
    })
    .sort((a, b) => (deadlineOf(a) ?? "").localeCompare(deadlineOf(b) ?? ""))
    .slice(0, 8);
  const mine = "assignee=me";
  return (
    <div className="space-y-6">
      <section aria-label={t("dashboard.myCards")} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t("dashboard.cards.active")} value={cards.active} href={`/work/deliverables?${mine}`} />
        <KpiCard
          label={t("dashboard.cards.dueSoon")}
          value={cards.due_soon}
          hint={t("dashboard.cards.dueSoonHint")}
          href={`/work/deliverables?${mine}&deadline_after=${today}&deadline_before=${isoDay(7)}`}
        />
        <KpiCard
          label={t("dashboard.cards.overdue")}
          value={cards.overdue}
          href={`/work/deliverables?${mine}&deadline_before=${isoDay(-1)}&status=ready,in_progress,revision_requested`}
        />
        <KpiCard
          label={t("dashboard.cards.waiting")}
          value={cards.waiting}
          href={`/work/deliverables?${mine}&dep_state=waiting`}
        />
        <KpiCard
          label={t("dashboard.cards.revision")}
          value={cards.revision_requested}
          href={`/work/deliverables?${mine}&status=revision_requested`}
        />
        <KpiCard label={t("dashboard.cards.blockers")} value={cards.blockers} href="/work/blockers?mine=1" />
        <KpiCard
          label={t("dashboard.cards.validated")}
          value={cards.validated}
          href={`/work/deliverables?${mine}&status=validated`}
        />
        <KpiCard label={t("dashboard.cards.myWork")} value={member.deliverables.length} href="/work/my" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("dashboard.today")} description={t("dashboard.todayIntro")} className="lg:col-span-2">
          {member.deliverables.length === 0 ? (
            <Empty>{t("dashboard.todayEmpty")}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {member.deliverables.map((item) => (
                <DeliverableLine key={item.id} item={item} />
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card title={t("dashboard.quick")}>
            <div className="flex flex-col gap-2">
              <Link href="/work/orders/new" className={buttonClassName("primary", "sm")}>
                <ClipboardPlus className="size-4" aria-hidden="true" />
                {t("dashboard.proposeOrder")}
              </Link>
              <Link href="/work/blockers" className={buttonClassName("secondary", "sm")}>
                <OctagonAlert className="size-4" aria-hidden="true" />
                {t("dashboard.reportBlocker")}
              </Link>
              <Link href="/work/my" className={buttonClassName("secondary", "sm")}>
                <ListChecks className="size-4" aria-hidden="true" />
                {t("dashboard.openMyWork")}
              </Link>
            </div>
          </Card>
          <Card title={t("dashboard.upcoming")}>
            {upcoming.length === 0 ? (
              <Empty>{t("dashboard.upcomingEmpty")}</Empty>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((item) => (
                  <UpcomingLine key={item.id} item={item} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title={t("dashboard.recent")}>
        {member.recent.length === 0 ? (
          <Empty>{t("dashboard.recentEmpty")}</Empty>
        ) : (
          <ul className="space-y-2">
            {member.recent.map((entry) => (
              <ActivityLine key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** A Deliverable with its Work Order, project, progress, deadline and its three states (guide §1.3). */
function DeliverableLine({ item }: { item: Deliverable }) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const { day } = useDates();
  const deadline = deadlineOf(item);
  const moved = item.effective_deadline && item.original_deadline && item.effective_deadline !== item.original_deadline;
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/work/deliverables/${item.id}`}
            dir="auto"
            className="block font-semibold text-ink hover:text-racing"
          >
            {[item.code, item.title].filter(Boolean).join(" · ")}
          </Link>
          <p dir="auto" className="text-xs text-muted">
            {[item.work_order.code, item.work_order.title].filter(Boolean).join(" · ")}
            {item.work_order.project ? ` — ${item.work_order.project.name}` : ""}
          </p>
        </div>
        <DeliverableStates
          status={item.status ?? "draft"}
          depState={item.dep_state ?? "no_blocking_dependencies"}
          executionState={item.execution_state ?? "normal"}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted">
        <ProgressMeter value={item.progress ?? 0} label={tWorkflow("progress")} className="w-48" />
        {deadline ? (
          <span>
            {t("dashboard.deadline", { date: day(deadline) })}
            {moved ? ` (${tWorkflow("originalDeadline")} : ${day(item.original_deadline)})` : ""}
          </span>
        ) : (
          <span>{t("dashboard.noDeadline")}</span>
        )}
      </div>
    </li>
  );
}

function UpcomingLine({ item }: { item: Deliverable }) {
  const { day } = useDates();
  return (
    <li className="flex items-start gap-3 text-sm">
      <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-navy">{day(deadlineOf(item))}</p>
        <Link href={`/work/deliverables/${item.id}`} dir="auto" className="block truncate text-ink hover:text-racing">
          {item.title}
        </Link>
      </div>
    </li>
  );
}

function ActivityLine({ entry }: { entry: Activity }) {
  const tWorkflow = useTranslations("Workflow");
  const { moment } = useDates();
  const who = personName(entry.actor) || tWorkflow("system");
  const text = `${who} ${tWorkflow(`action.${entry.action}`)} · ${tWorkflow(`entity.${entry.entity_type}`)}`;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      {entry.deliverable ? (
        <Link href={`/work/deliverables/${entry.deliverable}`} className="text-ink hover:text-racing">
          {text}
        </Link>
      ) : (
        <span className="text-ink">{text}</span>
      )}
      <span className="text-xs text-muted">{moment(entry.occurred_at)}</span>
    </li>
  );
}

function HeadPart({ head }: { head: NonNullable<Dashboard["head"]> }) {
  const t = useTranslations("WorkHub");
  const { cards } = head;
  return (
    <section className="space-y-6" aria-labelledby="head-part">
      <h2 id="head-part" className="font-display text-2xl font-bold tracking-wide text-navy uppercase">
        {t("dashboard.headTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("dashboard.head.proposals")}
          value={cards.wo_proposals + cards.deliverable_proposals}
          hint={t("dashboard.head.proposalsHint", {
            orders: cards.wo_proposals,
            deliverables: cards.deliverable_proposals,
          })}
          href="/work/proposals"
        />
        <KpiCard
          label={t("dashboard.head.toReview")}
          value={cards.to_review}
          href="/work/deliverables?status=submitted"
        />
        <KpiCard
          label={t("dashboard.head.openBlockers")}
          value={cards.open_blockers}
          href="/work/blockers?status=open"
        />
        <KpiCard label={t("dashboard.head.relief")} value={cards.relief_claims} hint={t("dashboard.head.reliefHint")} />
        <KpiCard label={t("dashboard.head.attention")} value={cards.attention} href="#attention" />
        <KpiCard
          label={t("dashboard.head.activeOrders")}
          value={cards.active_work_orders}
          href="/work/orders?status=active,in_progress"
        />
        <KpiCard label={t("dashboard.head.activeDeliverables")} value={cards.active_deliverables} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("dashboard.head.toReviewList")}>
          <DeliverableList items={head.to_review} empty={t("dashboard.head.toReviewEmpty")} />
        </Card>
        <div id="attention" className="scroll-mt-24">
          <Card title={t("dashboard.head.attentionList")} description={t("dashboard.head.attentionIntro")}>
            <DeliverableList items={head.attention} empty={t("dashboard.head.attentionEmpty")} />
          </Card>
        </div>
        <Card title={t("dashboard.head.workload")}>
          <WorkloadList rows={head.workload} />
        </Card>
        <Card title={t("dashboard.head.highBlockers")}>
          {head.high_blockers.length === 0 ? (
            <Empty>{t("dashboard.head.highBlockersEmpty")}</Empty>
          ) : (
            <ul className="space-y-3">
              {head.high_blockers.map((blocker) => (
                <HighBlocker key={blocker.id} blocker={blocker} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

function DeliverableList({ items, empty }: { items: Deliverable[]; empty: string }) {
  if (items.length === 0) {
    return <Empty>{empty}</Empty>;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <DeliverableLine key={item.id} item={item} />
      ))}
    </ul>
  );
}

/** Open Deliverables by member: a load to balance, not a comparison of results. */
export function WorkloadList({ rows }: { rows: Workload[] }) {
  const t = useTranslations("WorkHub");
  if (rows.length === 0) {
    return <Empty>{t("workloadEmpty")}</Empty>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.member_id} className="flex items-center justify-between gap-3 text-sm">
          <span dir="auto" className="text-ink">
            {row.name}
          </span>
          <span className="text-xs text-muted">{t("openDeliverables", { count: row.open_deliverables })}</span>
        </li>
      ))}
    </ul>
  );
}

function HighBlocker({ blocker }: { blocker: Blocker }) {
  const target = blocker.target;
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={blocker.severity} />
        {blocker.impact ? <ImpactBadge impact={blocker.impact} /> : null}
      </div>
      <p dir="auto" className="text-sm text-ink">
        {blocker.description}
      </p>
      {target ? (
        <Link
          href={target.kind === "deliverable" ? `/work/deliverables/${target.id}` : `/work/orders/${target.id}`}
          dir="auto"
          className="text-xs text-muted hover:text-racing"
        >
          {[target.code, target.title].filter(Boolean).join(" · ")}
        </Link>
      ) : null}
    </li>
  );
}
