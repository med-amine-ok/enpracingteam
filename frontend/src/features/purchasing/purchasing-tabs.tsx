"use client";

import { ClipboardList, Factory } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageTabs } from "@/components/ui/page-tabs";
import { Link } from "@/i18n/navigation";
import { buttonClassName } from "@/components/ui/button";

const TABS = [
  { key: "requests", href: "/purchasing", icon: ClipboardList },
  { key: "suppliers", href: "/purchasing/suppliers", icon: Factory },
] as const;

/** The two pages of the purchasing module, side by side under its title. */
export function PurchasingTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  const t = useTranslations("Purchasing");
  return (
    <PageTabs
      label={t("sections")}
      tabs={TABS.map((tab) => ({ ...tab, label: t(`tabs.${tab.key}`) }))}
      current={current}
    />
  );
}

/** "New request": a link styled as the page's main button. */
export function NewPurchaseLink() {
  const t = useTranslations("Purchasing");
  return (
    <Link href="/purchasing/requests/new" className={buttonClassName("primary", "md")}>
      {t("newRequest")}
    </Link>
  );
}
