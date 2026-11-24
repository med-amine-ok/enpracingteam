"use client";

import {
  AlarmClock,
  Ban,
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  ClipboardList,
  CalendarOff,
  Hammer,
  HandHelping,
  TimerOff,
  ShieldX,
  Flag,
  GraduationCap,
  HeartHandshake,
  CalendarHeart,
  Target,
  FileWarning,
  Trophy,
  HandHeart,
  PackageCheck,
  FileCheck,
  FileClock,
  FileX,
  ShieldQuestion,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Megaphone,
  MessageSquare,
  OctagonAlert,
  Package,
  PackageMinus,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  UserPlus,
  WalletMinimal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useMe } from "@/features/auth/use-me";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Ground, SeriousGround } from "@/features/discipline/api";
import type { Notification, NotificationData, NotificationKind } from "./api";
import { useMarkRead } from "./queries";

const ICONS: Record<NotificationKind, LucideIcon> = {
  message: Megaphone,
  task_assigned: UserPlus,
  task_commented: MessageSquare,
  task_blocked: Ban,
  task_done: CircleCheck,
  validation_requested: ShieldAlert,
  validation_signed: ShieldCheck,
  task_due_soon: Clock,
  task_overdue: AlarmClock,
  purchase_approval_requested: ClipboardCheck,
  purchase_to_order: ShoppingCart,
  purchase_updated: Package,
  stock_low: PackageMinus,
  budget_exceeded: WalletMinimal,
  task_submitted: Send,
  task_validated: BadgeCheck,
  task_revision: RotateCcw,
  blocker_declared: OctagonAlert,
  blocker_updated: Wrench,
  meeting_scheduled: CalendarPlus,
  meeting_updated: CalendarX,
  meeting_reminder: CalendarClock,
  excuse_requested: ShieldQuestion,
  excuse_decided: CalendarCheck,
  action_assigned: ClipboardList,
  minutes_published: FileCheck,
  document_review_requested: FileClock,
  document_reviewed: FileX,
  loan_requested: HandHelping,
  loan_decided: PackageCheck,
  loan_overdue: TimerOff,
  reservation_cancelled: CalendarOff,
  certification_granted: Hammer,
  contribution_proposed: HandHeart,
  contribution_decided: HandHeart,
  ranking_published: Trophy,
  ranking_to_publish: Megaphone,
  warning_reported: Flag,
  warning_issued: FileWarning,
  exclusion_pending: ShieldX,
  objective_set: Target,
  training_planned: GraduationCap,
  volunteering_to_validate: HeartHandshake,
  volunteering_decided: HeartHandshake,
  volunteering_reminder: CalendarHeart,
};

/** The ground of a breach or warning, or the serious behaviour of an exclusion, in the reader's language. */
function disciplineGround(data: NotificationData, t: ReturnType<typeof useTranslations<"Discipline">>) {
  const ground = data.ground ?? "";
  if (data.cause !== undefined) {
    return ground ? t(`serious.${ground as SeriousGround}`) : "";
  }
  return t(`ground.${ground as Ground}`);
}

/** The sentence of a purchase update, from what happened (and, for an approval, how far it went). */
function purchaseUpdateKey(data: NotificationData) {
  switch (data.action) {
    case "approved":
      return data.status === "a_valider_operations" ? "purchase_approved_leader" : "purchase_approved";
    case "refused":
      return "purchase_refused";
    case "ordered":
      return "purchase_ordered";
    case "order_cancelled":
      return "purchase_order_cancelled";
    case "received":
      return "purchase_received";
    case "partly_received":
      return "purchase_partly_received";
    case "closed_short":
      return "purchase_closed_short";
    case "cancelled":
      return "purchase_cancelled";
    default:
      return "purchase_updated";
  }
}

const EXCUSE_REASON_KEYS = { exam: 1, illness: 1, family: 1, mission: 1 } as const;
type ExcuseReasonKey = keyof typeof EXCUSE_REASON_KEYS;

/** The sentence of a blocker's update: validated, rejected or resolved. */
function blockerUpdateKey(data: NotificationData) {
  switch (data.status) {
    case "validated":
      return "blocker_validated";
    case "rejected":
      return "blocker_rejected";
    default:
      return "blocker_resolved";
  }
}

/** The page a notification leads to (none for a message written by hand). */
export function notificationHref(notification: Notification) {
  const { target } = notification;
  const data = notification.data as NotificationData;
  if (target?.type === "task") {
    return `/tasks/${target.id}`;
  }
  if (target?.type === "subsystem" && data.project_id) {
    return `/projects/${data.project_id}?tab=subsystems`;
  }
  if (target?.type === "purchase_request") {
    return `/purchasing/requests/${target.id}`;
  }
  if (target?.type === "stock_item") {
    return `/stock/${target.id}`;
  }
  if (target?.type === "document") {
    return `/documents/${target.id}`;
  }
  if (target?.type === "meeting") {
    return `/meetings/${target.id}`;
  }
  if (target?.type === "equipment") {
    return `/workshop/${target.id}`;
  }
  if (target?.type === "warning") {
    return `/discipline/warnings/${target.id}`;
  }
  if (target?.type === "discipline_report" || target?.type === "exclusion") {
    return "/discipline";
  }
  if (target?.type === "contribution") {
    return "/ranking/contributions";
  }
  if (target?.type === "ranking") {
    return notification.kind === "ranking_to_publish" ? "/ranking/team" : "/ranking";
  }
  if (target?.type === "objective") {
    return "/engagement/objectives";
  }
  if (target?.type === "training") {
    return "/engagement/trainings";
  }
  if (target?.type === "volunteering") {
    return "/engagement";
  }
  if (target?.type === "budget") {
    return `/finance/budgets/${target.id}`;
  }
  return null;
}

/** The sentence, in the language of the page: names typed by members are kept in their own direction. */
export function NotificationText({ notification }: { notification: Notification }) {
  const t = useTranslations("Notifications");
  const tWork = useTranslations("Work");
  const tMeetings = useTranslations("Meetings");
  const tDiscipline = useTranslations("Discipline");
  const format = useFormatter();
  const me = useMe();
  const data = notification.data as NotificationData;
  const actor = notification.actor ? `${notification.actor.first_name} ${notification.actor.last_name}` : t("someone");
  const tags = {
    who: (chunks: ReactNode) => <bdi className="font-medium text-ink">{chunks}</bdi>,
    what: (chunks: ReactNode) => <bdi className="font-medium text-ink">{chunks}</bdi>,
    quote: (chunks: ReactNode) => <bdi>{chunks}</bdi>,
  };
  const date = data.due_date
    ? format.dateTime(new Date(data.due_date), { day: "numeric", month: "long", numberingSystem: "latn" })
    : "";
  const values = {
    actor,
    task: data.task ?? "",
    subsystem: data.subsystem ?? "",
    excerpt: data.excerpt ?? "",
    date,
    part: data.part ?? "",
    quantity: String(data.quantity ?? ""),
    received: data.received ?? 0,
    requester: data.requester ?? "",
    supplier: data.supplier ?? "",
    reason: data.reason ?? "",
    place: data.location || t("noPlace"),
    threshold: String(data.threshold ?? ""),
    unit: data.unit ?? "",
    year: data.fiscal_year ?? "",
    spent: format.number(Number(data.spent ?? 0), { maximumFractionDigits: 2, numberingSystem: "latn" }),
    allocated: format.number(Number(data.allocated ?? 0), { maximumFractionDigits: 2, numberingSystem: "latn" }),
    mark: String(data.quality_mark ?? ""),
    meeting: data.meeting ?? "",
    when: data.starts_at
      ? format.dateTime(new Date(data.starts_at), {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          numberingSystem: "latn",
        })
      : "",
    member: data.member ?? "",
    document: data.document ?? "",
    equipment: data.equipment ?? "",
    count: data.points ?? 0,
    level: String(data.number ?? ""),
    ground: data.ground ? disciplineGround(data, tDiscipline) : "",
    note: data.note ?? "",
    month: data.month
      ? format.dateTime(new Date(`${data.month}-15T12:00:00Z`), {
          month: "long",
          year: "numeric",
          numberingSystem: "latn",
        })
      : "",
    slot:
      data.reserved_from && data.reserved_to
        ? format.dateTimeRange(new Date(data.reserved_from), new Date(data.reserved_to), {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            numberingSystem: "latn",
          })
        : "",
    version: String(data.version ?? ""),
    reasonLabel:
      data.reason && data.reason in EXCUSE_REASON_KEYS ? tMeetings(`reason.${data.reason as ExcuseReasonKey}`) : "",
    severity: data.severity ? tWork(`severity.${data.severity}`) : "",
    objective: data.objective ?? "",
    training: data.training ?? "",
    volunteering: data.volunteering ?? "",
    day: data.date
      ? format.dateTime(new Date(`${data.date}T12:00:00Z`), { day: "numeric", month: "long", numberingSystem: "latn" })
      : "",
  };

  switch (notification.kind) {
    case "task_assigned":
      return data.primary_id != null && data.primary_id === me.data?.id
        ? t.rich("kinds.task_assigned_primary", { ...values, ...tags })
        : t.rich("kinds.task_assigned", { ...values, ...tags });
    case "purchase_approval_requested":
      return data.level === "operations"
        ? t.rich("kinds.purchase_approval_requested_operations", { ...values, ...tags })
        : t.rich("kinds.purchase_approval_requested", { ...values, ...tags });
    case "purchase_updated":
      return t.rich(`kinds.${purchaseUpdateKey(data)}`, { ...values, ...tags });
    case "blocker_updated":
      return t.rich(`kinds.${blockerUpdateKey(data)}`, { ...values, ...tags });
    case "meeting_scheduled":
      return data.mandatory
        ? t.rich("kinds.meeting_scheduled_mandatory", { ...values, ...tags })
        : t.rich("kinds.meeting_scheduled", { ...values, ...tags });
    case "meeting_updated":
      return data.cancelled
        ? t.rich("kinds.meeting_cancelled", { ...values, ...tags })
        : t.rich("kinds.meeting_updated", { ...values, ...tags });
    case "document_reviewed":
      return data.approved
        ? t.rich("kinds.document_approved", { ...values, ...tags })
        : t.rich("kinds.document_rejected", { ...values, ...tags });
    case "contribution_decided":
      return data.approved
        ? t.rich("kinds.contribution_approved", { ...values, ...tags })
        : t.rich("kinds.contribution_refused", { ...values, ...tags });
    case "loan_decided":
      return data.approved
        ? t.rich("kinds.loan_approved", { ...values, ...tags })
        : t.rich("kinds.loan_refused", { ...values, ...tags });
    case "reservation_cancelled":
      if (data.unavailable) {
        return t.rich("kinds.reservation_unavailable", { ...values, ...tags });
      }
      return data.excerpt
        ? t.rich("kinds.reservation_cancelled_reason", { ...values, ...tags })
        : t.rich("kinds.reservation_cancelled", { ...values, ...tags });
    case "objective_set":
      return data.due_date
        ? t.rich("kinds.objective_set_due", { ...values, ...tags })
        : t.rich("kinds.objective_set", { ...values, ...tags });
    case "training_planned":
      return data.starts_at
        ? t.rich("kinds.training_planned_session", { ...values, ...tags })
        : t.rich("kinds.training_planned", { ...values, ...tags });
    case "volunteering_decided":
      return data.approved
        ? t.rich("kinds.volunteering_validated", { ...values, ...tags })
        : t.rich("kinds.volunteering_refused", { ...values, ...tags });
    case "excuse_decided":
      return data.accepted
        ? t.rich("kinds.excuse_accepted", { ...values, ...tags })
        : t.rich("kinds.excuse_refused", { ...values, ...tags });
    case "message":
      return <bdi>{notification.message}</bdi>;
    default:
      return t.rich(`kinds.${notification.kind}`, { ...values, ...tags });
  }
}

type NotificationItemProps = {
  notification: Notification;
  /** After a click (the bell's panel closes). */
  onOpen?: () => void;
};

/** One notification: what happened, in which project, when; opening it marks it read. */
export function NotificationItem({ notification, onOpen }: NotificationItemProps) {
  const t = useTranslations("Notifications");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const markRead = useMarkRead();
  const data = notification.data as NotificationData;
  const Icon = ICONS[notification.kind];
  const late = [
    "task_overdue",
    "stock_low",
    "budget_exceeded",
    "task_revision",
    "blocker_declared",
    "excuse_requested",
    "volunteering_reminder",
  ].includes(notification.kind);
  const href = notificationHref(notification);

  function open() {
    if (!notification.is_read) {
      markRead.mutate(notification.id);
    }
    onOpen?.();
  }

  const content = (
    <>
      <span
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
          late ? "bg-racing-soft text-racing-strong" : "bg-info-soft text-navy",
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className={cn("block text-sm leading-snug", notification.is_read ? "text-muted" : "text-ink")}>
          <NotificationText notification={notification} />
        </span>
        <span className="block text-xs text-muted">
          {data.project ? (
            <>
              <bdi>{data.project}</bdi>
              {" · "}
            </>
          ) : null}
          <time dateTime={notification.created_at}>{format.relativeTime(new Date(notification.created_at), now)}</time>
        </span>
      </span>
      {notification.is_read ? null : (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-racing" aria-hidden="true" />
      )}
      {notification.is_read ? null : <span className="sr-only">{t("unreadMark")}</span>}
    </>
  );
  const itemClass = cn(
    "flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-canvas",
    !notification.is_read && "bg-info-soft/40",
  );
  return href ? (
    <Link href={href} onClick={open} className={itemClass}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={open} className={itemClass}>
      {content}
    </button>
  );
}
