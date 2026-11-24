"use client";

import { BellOff, CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { errorText } from "@/lib/error-text";
import { NotificationItem } from "./notification-item";
import { useMarkAllRead, useNotifications, useUnreadCount } from "./queries";

/** All my notifications (the 50 newest), or only the unread ones. */
export function NotificationsPage() {
  const t = useTranslations("Notifications");
  const tErrors = useTranslations("Errors");
  const [scope, setScope] = useState<"all" | "unread">("all");
  const list = useNotifications(scope === "unread");
  const count = useUnreadCount();
  const readAll = useMarkAllRead();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t("scopeLabel")}
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: t("all") },
            { value: "unread", label: t("unread") },
          ]}
        />
        {count.data ? (
          <Button variant="secondary" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending}>
            <CheckCheck className="size-4" aria-hidden="true" />
            {t("markAllRead")}
          </Button>
        ) : null}
      </div>
      {list.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(list.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => list.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !list.data ? (
        <LinesPlaceholder lines={4} />
      ) : list.data.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
          <BellOff className="size-8 text-muted" aria-hidden="true" />
          <p className="font-medium text-ink">{scope === "unread" ? t("emptyUnread") : t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {list.data.map((notification) => (
            <li key={notification.id}>
              <NotificationItem notification={notification} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
