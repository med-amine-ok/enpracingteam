"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { Link } from "@/i18n/navigation";
import { NotificationItem } from "./notification-item";
import { useMarkAllRead, useNotifications, useUnreadCount } from "./queries";

const SHOWN = 8;

/**
 * The bell of the top bar: how many notifications are unread, and the newest ones in a panel.
 * `enabled`: once the member is known (no question to the API before).
 */
export function NotificationBell({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Notifications");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const count = useUnreadCount(enabled);
  const list = useNotifications(false, enabled && open);
  const readAll = useMarkAllRead();
  const unread = count.data ?? 0;

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={t("bell", { count: unread, shown: String(unread) })}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="relative grid size-9 place-items-center rounded-full text-ink transition-colors hover:bg-canvas"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread > 0 ? (
          <span
            className="absolute -end-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-racing px-1 text-2xs font-semibold text-white"
            aria-hidden="true"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label={t("title")}
          // On a phone, the whole width under the top bar; from tablets, hung under the bell.
          className="fixed inset-x-2 top-16 z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-11 sm:w-[22rem]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => readAll.mutate()}
                disabled={readAll.isPending}
                className="text-xs font-medium text-navy underline-offset-2 hover:underline disabled:opacity-60"
              >
                {t("markAllRead")}
              </button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {list.error ? (
              <div className="p-4">
                <LoadError error={list.error} />
              </div>
            ) : list.data ? (
              list.data.length > 0 ? (
                <ul className="divide-y divide-line">
                  {list.data.slice(0, SHOWN).map((notification) => (
                    <li key={notification.id}>
                      <NotificationItem notification={notification} onOpen={() => setOpen(false)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-muted">{t("empty")}</p>
              )
            ) : (
              <div className="p-4">
                <LinesPlaceholder lines={3} />
              </div>
            )}
          </div>
          <div className="border-t border-line px-4 py-2.5 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-navy underline-offset-2 hover:underline"
            >
              {t("seeAll")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
