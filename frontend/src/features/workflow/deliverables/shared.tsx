"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import type { Deliverable, Member } from "../api";
import { refreshWorkflow } from "../queries";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

export const labelClass = "block text-xs font-semibold tracking-widest text-muted uppercase";

/** Today in Algiers, as the API's dates (YYYY-MM-DD). */
export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
}

export function memberName(member: Pick<Member, "first_name" | "last_name"> | null | undefined) {
  return member ? `${member.first_name} ${member.last_name}`.trim() : "";
}

/** Dates as the reader writes them, in Latin digits (also in Arabic, as everywhere in the app). */
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

/**
 * A change of the work module: pending while it runs (the button is blocked, so no double submit), the backend's
 * message when it fails, then everything of the module read again (the backend recomputes states and deadlines).
 */
export function useWorkMutation<TVariables = void, TData = unknown>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  onDone?: (data: TData) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (data) => {
      onDone?.(data);
      await refreshWorkflow(queryClient);
    },
  });
}

/** The backend's message of a failed change, in place. */
export function MutationError({ error }: { error: unknown }) {
  const tErrors = useTranslations("Errors");
  if (!error) {
    return null;
  }
  return <Alert tone="error">{errorText(error, tErrors)}</Alert>;
}

/** A labelled multi-line field (user-typed text: its direction follows what is written). */
export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  const hintId = useId();
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
        aria-describedby={hint ? hintId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={textareaClass}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled checkbox with an optional explanation under it. */
export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-start gap-2 text-sm text-ink">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 accent-racing"
        />
        <span>{label}</span>
      </label>
      {hint ? <p className="ps-6 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** An inline form in a panel (no browser validation bubbles: the buttons stay disabled until the form is valid). */
export function Panel({
  title,
  description,
  children,
  onSubmit,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onSubmit: (event: FormEvent) => void;
  className?: string;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn("space-y-4 rounded-lg border border-line bg-canvas p-4", className)}
      noValidate
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      {children}
    </form>
  );
}

export function PanelButtons({
  confirm,
  pending,
  disabled = false,
  onClose,
}: {
  confirm: string;
  pending: boolean;
  disabled?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Deliverables");
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" loading={pending} disabled={disabled}>
        {confirm}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
        {t("close")}
      </Button>
    </div>
  );
}

/**
 * The confirmation of a consequential action (guide §17): a modal that says what will happen, runs the action
 * once (pending, blocked), and shows the backend's message if it fails.
 */
export function ConfirmDialog({
  title,
  children,
  confirm,
  pending,
  error,
  disabled = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  confirm: string;
  pending: boolean;
  error?: unknown;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("Deliverables");
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4">
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-card focus:outline-none"
      >
        <h2 id={titleId} className="font-display text-lg font-bold tracking-wide text-navy uppercase">
          {title}
        </h2>
        {children ? <div className="space-y-3 text-sm text-ink">{children}</div> : null}
        <MutationError error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            {t("close")}
          </Button>
          <Button size="sm" loading={pending} disabled={disabled} onClick={onConfirm}>
            {confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A label and its value, in a description list. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

/** Original deadline always; the effective one and the approved relief only when the backend says they differ. */
export function DeadlineText({ deliverable }: { deliverable: Deliverable }) {
  const t = useTranslations("Deliverables");
  const { day } = useDates();
  if (!deliverable.original_deadline) {
    return <span className="text-muted">—</span>;
  }
  const shifted = !!deliverable.effective_deadline && deliverable.effective_deadline !== deliverable.original_deadline;
  return (
    <span className="inline-flex flex-col">
      <span>{day(deliverable.original_deadline)}</span>
      {shifted ? (
        <span className="text-xs text-muted">{t("effectiveOn", { date: day(deliverable.effective_deadline) })}</span>
      ) : null}
    </span>
  );
}

/** A number the API sends as a decimal string ("40.000"), written without useless zeros. */
export function decimal(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : String(value);
}

/** Only http(s) links are opened (no "javascript:" from a typed URL). */
export function safeUrl(url: string) {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}
