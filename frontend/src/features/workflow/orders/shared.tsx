"use client";

import { X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { normalizeText } from "@/features/members/search";
import { useMembers, useOrgUnits } from "@/features/members/use-members";
import { cn } from "@/lib/utils";
import type { Member, WorkOrderStatus } from "../api";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none disabled:opacity-60";

const labelClass = "block text-xs font-semibold tracking-widest text-muted uppercase";

/** The lifecycle statuses in which budget and weights may still change without a reason (spec §7.2). */
const UNLOCKED: WorkOrderStatus[] = ["draft", "planning"];

export function isLocked(status: WorkOrderStatus | undefined) {
  return !!status && !UNLOCKED.includes(status);
}

/** The proposal look (guide §11.2): never shown like official work. */
export const proposalOutline = "outline-2 -outline-offset-2 outline-dashed outline-warning/60";

export function isProposal(status: string | null | undefined) {
  return !!status && status !== "approved";
}

export function memberName(member: Pick<Member, "first_name" | "last_name"> | null | undefined) {
  return member ? `${member.first_name} ${member.last_name}`.trim() : "";
}

/** A date (or a date and time) as the reader writes it, in Latin digits even in Arabic. */
export function useDay() {
  const format = useFormatter();
  return (value: string | null | undefined, withTime = false) =>
    value
      ? format.dateTime(new Date(value), {
          dateStyle: "medium",
          ...(withTime ? { timeStyle: "short" } : {}),
          numberingSystem: "latn",
        })
      : "";
}

/** A labelled text area; the text is the member's own, in whatever direction they wrote it. */
export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  required,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  required?: boolean;
  hint?: string;
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
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** The units a Work Order may belong to: the departments and poles (not the board nor the team itself). */
const DEPARTMENT_TYPES = ["club_department", "fs_department", "club_pole"];

export function useDepartments() {
  const units = useOrgUnits();
  const departments = useMemo(
    () =>
      (units.data ?? [])
        .filter((unit) => DEPARTMENT_TYPES.includes(unit.type) && unit.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [units.data],
  );
  return { ...units, departments };
}

/** Members chosen among the active members, found by name. */
export function MemberPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[];
  onChange: (value: number[]) => void;
}) {
  const t = useTranslations("WorkOrders");
  const members = useMembers();
  const [query, setQuery] = useState("");
  const groupId = useId();
  const all = (members.data ?? []).filter((member) => member.status === "active" || value.includes(member.id));
  const words = normalizeText(query);
  const shown = all
    .filter((member) => !words || normalizeText(memberName(member)).includes(words) || value.includes(member.id))
    .sort((a, b) => memberName(a).localeCompare(memberName(b)))
    .slice(0, 40);
  return (
    <fieldset className="space-y-1.5">
      <legend className={labelClass} id={groupId}>
        {label}
      </legend>
      <input
        type="search"
        dir="auto"
        aria-label={t("memberSearch")}
        placeholder={t("memberSearch")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-xs focus:border-navy focus:outline-none"
      />
      <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2" aria-labelledby={groupId}>
        {shown.map((member) => (
          <li key={member.id}>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={value.includes(member.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked ? [...value, member.id] : value.filter((chosen) => chosen !== member.id),
                  )
                }
              />
              <bdi>{memberName(member)}</bdi>
            </label>
          </li>
        ))}
        {members.data && shown.length === 0 ? <li className="text-xs text-muted">{t("noMemberFound")}</li> : null}
      </ul>
      {value.length > 0 ? <p className="text-xs text-muted">{t("membersChosen", { count: value.length })}</p> : null}
    </fieldset>
  );
}

/** A dialog above the page: Escape or the close button leave it; the focus goes inside it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useTranslations("WorkOrders");
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>("textarea, input, select, button:not([data-close])");
    first?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg bg-surface p-5 shadow-card"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-display text-lg font-bold tracking-wide text-navy uppercase">
            {title}
          </h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label={t("close")}
            className="rounded p-1 text-muted hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A small label and its value, in the summary grids. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <dt className="text-2xs font-semibold tracking-widest text-muted uppercase">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}
