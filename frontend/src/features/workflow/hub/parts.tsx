"use client";

import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { searchWork, type Member } from "../api";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none disabled:opacity-60";

export const labelClass = "block text-xs font-semibold tracking-widest text-muted uppercase";

/** "Lina Demo", or an empty string for nobody. */
export function personName(member: Member | null | undefined) {
  return member ? `${member.first_name} ${member.last_name}`.trim() : "";
}

/** Today in Algiers, as the API's dates (YYYY-MM-DD), shifted by `days`. */
export function isoDay(days = 0) {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(date);
}

/** Dates in the reader's language, always with Latin digits. */
export function useDates() {
  const format = useFormatter();
  return {
    day: (value: string | null | undefined) =>
      value ? format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" }) : "",
    moment: (value: string | null | undefined) =>
      value
        ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" })
        : "",
  };
}

/** A labelled text area. */
export function TextArea({
  label,
  value,
  onChange,
  required,
  rows = 2,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  rows?: number;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <textarea
        id={id}
        dir="auto"
        rows={rows}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={textareaClass}
      />
    </div>
  );
}

/** A term and its value in a <dl>. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd dir="auto" className="text-ink">
        {children}
      </dd>
    </div>
  );
}

/** A framed form under an item (resolve, cancel…), its error and its buttons. */
export function ActionPanel({
  title,
  confirm,
  pending,
  disabled,
  error,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  confirm: string;
  pending: boolean;
  disabled?: boolean;
  error: unknown;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("WorkHub");
  const tErrors = useTranslations("Errors");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending && !disabled) {
      onSubmit();
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-canvas p-4" aria-label={title}>
      <p className="text-sm font-semibold text-navy">{title}</p>
      {children}
      {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={disabled}>
          {confirm}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
          {t("close")}
        </Button>
      </div>
    </form>
  );
}

/** Text typed in a search box, once the typing pauses. */
export function useDebounced(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** The accessible Work Orders, Deliverables, Milestones and blockers matching the words (2 characters at least). */
export function useWorkSearch(words: string) {
  const query = useDebounced(words.trim());
  return useQuery({
    queryKey: ["workflow", "search", query],
    queryFn: () => searchWork(query),
    enabled: query.length >= 2,
  });
}

export type WorkTarget = { kind: "deliverable" | "work_order"; id: number; label: string };

/** Picks the affected Deliverable or Work Order through the work search. */
export function WorkTargetPicker({
  value,
  onChange,
}: {
  value: WorkTarget | null;
  onChange: (target: WorkTarget | null) => void;
}) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const id = useId();
  const [words, setWords] = useState("");
  const search = useWorkSearch(words);
  if (value) {
    return (
      <div className="space-y-1.5">
        <p className={labelClass}>{t("blockers.target")}</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          <span className="text-xs text-muted">{tWorkflow(`entity.${value.kind}`)}</span>
          <span dir="auto" className="font-medium text-ink">
            {value.label}
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            {t("change")}
          </Button>
        </div>
      </div>
    );
  }
  const options: WorkTarget[] = [
    ...(search.data?.deliverables ?? []).map((item) => ({
      kind: "deliverable" as const,
      id: item.id,
      label: [item.code, item.title].filter(Boolean).join(" · "),
    })),
    ...(search.data?.work_orders ?? []).map((item) => ({
      kind: "work_order" as const,
      id: item.id,
      label: [item.code, item.title].filter(Boolean).join(" · "),
    })),
  ];
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {t("blockers.target")}
      </label>
      <input
        id={id}
        type="search"
        dir="auto"
        value={words}
        placeholder={t("blockers.targetPlaceholder")}
        onChange={(event) => setWords(event.target.value)}
        className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none"
      />
      {words.trim().length >= 2 && search.data && options.length === 0 ? (
        <p className="text-xs text-muted">{t("search.empty")}</p>
      ) : null}
      {options.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {options.map((option) => (
            <li key={`${option.kind}-${option.id}`}>
              <button
                type="button"
                onClick={() => onChange(option)}
                className={cn("flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-canvas")}
              >
                <span className="text-xs text-muted">{tWorkflow(`entity.${option.kind}`)}</span>
                <span dir="auto" className="text-ink">
                  {option.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** "Nothing to show" in a section. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}
