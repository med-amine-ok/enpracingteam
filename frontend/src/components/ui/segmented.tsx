"use client";

import { cn } from "@/lib/utils";

type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
};

/** A few mutually exclusive choices shown side by side ("All" / "Mine"). Never wider than its place: on a phone,
 * the choices that do not fit are reached by sliding them sideways. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex max-w-full [scrollbar-width:none] overflow-x-auto rounded-lg border border-line bg-surface p-0.5 shadow-xs"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
            option.value === value ? "bg-navy text-white" : "text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
