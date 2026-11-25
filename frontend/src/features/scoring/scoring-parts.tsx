"use client";

import { ArrowLeft, Calculator, FileClock, FlaskConical, LayoutDashboard, ListChecks } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useSyncExternalStore, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs, type PageTab } from "@/components/ui/page-tabs";
import { SelectField } from "@/components/ui/select-field";
import { useSeasons, useWorkMe } from "@/features/workflow/queries";
import { Link } from "@/i18n/navigation";
import { isNotFound, type Member, type RunStatus } from "./api";

export type ScoringTab = "dashboard" | "runs" | "formulas" | "data" | "audit";

const TABS: { key: ScoringTab; href: string; icon: PageTab["icon"] }[] = [
  { key: "dashboard", href: "/scoring", icon: LayoutDashboard },
  { key: "runs", href: "/scoring/runs", icon: Calculator },
  { key: "formulas", href: "/scoring/formulas", icon: FlaskConical },
  { key: "data", href: "/scoring/data", icon: ListChecks },
  { key: "audit", href: "/scoring/audit", icon: FileClock },
];

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

/** The title of a scoring page and the workspace's tabs under it (guide §3.4). */
export function ScoringHeader({
  current,
  title,
  description,
  children,
}: {
  current: ScoringTab;
  /** Defaults to the tab's name. */
  title?: ReactNode;
  description?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("Scoring");
  const tabs = TABS.map(({ key, href, icon }) => ({ key, href, icon, label: t(`tabs.${key}`) }));
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t("eyebrow")} title={title ?? t(`tabs.${current}`)} description={description}>
        {children}
      </PageHeader>
      <PageTabs label={t("tabsLabel")} tabs={tabs} current={current} />
    </div>
  );
}

/** What a non-admin sees: the app's plain "page not found", never a hint that the workspace exists (guide §17). */
export function ScoringNotFound() {
  const t = useTranslations("NotFound");
  return (
    <div className="mx-auto max-w-sm space-y-5 py-16 text-center" data-testid="scoring-not-found">
      <p className="text-sm font-semibold text-racing">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("title")}</h1>
      <p className="text-sm text-muted">{t("description")}</p>
      <Link href="/" className={buttonClassName("secondary", "md")}>
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        {t("back")}
      </Link>
    </div>
  );
}

/** A failed read: a 404 is the generic "page not found", anything else says why. */
export function QueryFailure({ error }: { error: unknown }) {
  return isNotFound(error) ? <ScoringNotFound /> : <LoadError error={error} />;
}

/** Renders the page only for a scoring admin (GET /api/work/me/ → scoring.admin); anybody else gets "not found". */
const noSubscription = () => () => {};

export function ScoringGate({ children }: { children: ReactNode }) {
  const me = useWorkMe();
  // The server never knows the viewer: until the page is mounted, both draw the same placeholder (no hydration
  // mismatch when the viewer's rights are already in the browser's cache).
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  if (me.isError) {
    return <QueryFailure error={me.error} />;
  }
  if (!mounted || !me.data) {
    return (
      <div className="mx-auto max-w-6xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={5} />
        </Card>
      </div>
    );
  }
  if (!me.data.scoring?.admin) {
    return <ScoringNotFound />;
  }
  return <>{children}</>;
}

/** What the viewer may do in the workspace: configuration and publication are separate rights (guide §2.3). */
export function useScoringRights() {
  const me = useWorkMe();
  return { config: Boolean(me.data?.scoring?.config), publish: Boolean(me.data?.scoring?.publish) };
}

export function PanelPlaceholder({ lines = 5 }: { lines?: number }) {
  return (
    <Card>
      <LinesPlaceholder lines={lines} />
    </Card>
  );
}

/** A season list (GET /api/work/seasons/); "" stands for the backend's current season. */
export function SeasonSelect({
  value,
  onChange,
  allowAll = false,
}: {
  value: number | null;
  onChange: (season: number | null) => void;
  /** An "every season" choice (run lists) rather than "current season". */
  allowAll?: boolean;
}) {
  const t = useTranslations("Scoring");
  const seasons = useSeasons();
  return (
    <SelectField
      label={t("season")}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
    >
      <option value="">{allowAll ? t("allSeasons") : t("currentSeason")}</option>
      {(seasons.data ?? []).map((season) => (
        <option key={season.id} value={season.id}>
          {season.label}
        </option>
      ))}
    </SelectField>
  );
}

export function memberName(member: Member | null | undefined) {
  return member ? `${member.first_name} ${member.last_name}` : "—";
}

/** A backend decimal ("12.345") in the reader's language, or "—". Shown as given: never recomputed. */
export function useDecimal() {
  const format = useFormatter();
  return (value: string | number | null | undefined, digits = 3) => {
    if (value == null || value === "") {
      return "—";
    }
    const number = Number(value);
    return Number.isNaN(number)
      ? String(value)
      : format.number(number, { maximumFractionDigits: digits, numberingSystem: "latn" });
  };
}

/** A date and time, or a date, in the reader's language (Latin digits, also in Arabic). */
export function useWhen() {
  const format = useFormatter();
  return {
    dateTime: (value: string | null | undefined) =>
      value
        ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })
        : "—",
    date: (value: string | null | undefined) =>
      value ? format.dateTime(new Date(`${value}T12:00:00`), { dateStyle: "medium", numberingSystem: "latn" }) : "—",
  };
}

const RUN_TONES: Record<RunStatus, BadgeTone> = { running: "info", completed: "success", failed: "danger" };

export function RunStatusBadge({ status }: { status: RunStatus | undefined }) {
  const t = useTranslations("Scoring");
  const value = status ?? "running";
  return <Badge tone={RUN_TONES[value]}>{t(`runStatus.${value}`)}</Badge>;
}

export function PublishedBadge({ published }: { published: boolean | undefined }) {
  const t = useTranslations("Scoring");
  return published ? <Badge tone="strong">{t("published")}</Badge> : <Badge>{t("notPublished")}</Badge>;
}

const LEVEL_TONES: Record<string, BadgeTone> = { error: "danger", warning: "warning", info: "info" };

export function LevelBadge({ level }: { level: string }) {
  const t = useTranslations("Scoring");
  const known = level === "error" || level === "warning" || level === "info";
  return <Badge tone={LEVEL_TONES[level] ?? "neutral"}>{known ? t(`level.${level}`) : level}</Badge>;
}

/** A labelled multi-line field. */
export function TextArea({
  label,
  value,
  onChange,
  required,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold tracking-widest text-muted uppercase">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={textareaClass}
      />
    </div>
  );
}

/** A table that scrolls sideways on a phone. */
export function TableFrame({ children, minWidth = "40rem" }: { children: ReactNode; minWidth?: string }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:mx-0">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export const th = "px-3 py-2 text-start text-xs font-medium text-muted";
export const thEnd = "px-3 py-2 text-end text-xs font-medium text-muted";
export const td = "px-3 py-2 align-top";
export const tdEnd = "px-3 py-2 text-end align-top tabular-nums";

const SEVERITIES = ["minor", "moderate", "major", "critical"] as const;

export function severityLabel(t: ReturnType<typeof useTranslations<"Scoring">>, severity: string | null) {
  if (!severity) {
    return "—";
  }
  return (SEVERITIES as readonly string[]).includes(severity)
    ? t(`severity.${severity as (typeof SEVERITIES)[number]}`)
    : severity;
}
