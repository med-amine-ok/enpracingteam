"use client";

import {
  ClipboardList,
  Database,
  FileBarChart,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListChecks,
  OctagonAlert,
  PackageCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs, type PageTab } from "@/components/ui/page-tabs";
import { useWorkMe } from "./queries";

export type WorkflowTab =
  | "dashboard"
  | "myWork"
  | "workOrders"
  | "deliverables"
  | "proposals"
  | "dependencies"
  | "blockers"
  | "reports"
  | "rankingData";

const TABS: { key: WorkflowTab; href: string; icon: PageTab["icon"]; adminsOnly?: boolean }[] = [
  { key: "dashboard", href: "/work", icon: LayoutDashboard },
  { key: "myWork", href: "/work/my", icon: ListChecks },
  { key: "workOrders", href: "/work/orders", icon: ClipboardList },
  { key: "deliverables", href: "/work/deliverables", icon: PackageCheck },
  { key: "proposals", href: "/work/proposals", icon: Inbox },
  { key: "dependencies", href: "/work/dependencies", icon: GitBranch },
  { key: "blockers", href: "/work/blockers", icon: OctagonAlert },
  { key: "reports", href: "/work/reports", icon: FileBarChart },
  // The ranking data: the club admins only (decision of 25/11/2026), never shown to anybody else (guide §2.1).
  { key: "rankingData", href: "/work/ranking-data", icon: Database, adminsOnly: true },
];

/** The title of a work-module page and the module's tabs under it (guide §3: role-aware navigation). */
export function WorkflowHeader({
  current,
  title,
  description,
  children,
}: {
  current: WorkflowTab;
  /** Defaults to the tab's name. */
  title?: ReactNode;
  description?: string;
  /** Actions at the end of the title (buttons). */
  children?: ReactNode;
}) {
  const t = useTranslations("Workflow");
  const me = useWorkMe();
  const tabs = TABS.filter(({ adminsOnly }) => !adminsOnly || Boolean(me.data?.scoring)).map(({ key, href, icon }) => ({
    key,
    href,
    icon,
    label: t(`tabs.${key}`),
  }));
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t("title")} title={title ?? t(`tabs.${current}`)} description={description}>
        {children}
      </PageHeader>
      <PageTabs label={t("tabsLabel")} tabs={tabs} current={current} />
    </div>
  );
}
