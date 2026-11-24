"use client";

import { ChevronDown } from "lucide-react";
import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

type SelectFieldProps = ComponentProps<"select"> & { label: string };

/** A native list (keyboard, screen readers and phones handle it), styled like the text fields. */
export function SelectField({ label, id, className, children, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <div className="space-y-1.5">
      <label htmlFor={selectId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          className={cn(
            "h-11 w-full appearance-none rounded-lg border border-line bg-surface ps-3 pe-9 text-sm text-ink shadow-xs transition",
            "focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none disabled:opacity-60",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute inset-y-0 end-3 my-auto size-4 text-muted"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
