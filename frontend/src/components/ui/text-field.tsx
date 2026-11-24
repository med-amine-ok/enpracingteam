"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type TextFieldProps = Omit<ComponentProps<"input">, "dir"> & {
  label: string;
  icon?: ReactNode;
  /**
   * Writing direction of the value. "ltr" for e-mail addresses and codes, which are written left
   * to right even on Arabic pages; the icon then moves with the text.
   */
  valueDir?: "ltr";
};

export function TextField({ label, icon, valueDir, id, className, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
        {label}
      </label>
      <div className="relative" dir={valueDir}>
        {icon ? (
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <input
          id={inputId}
          className={cn(
            "h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-xs transition",
            "placeholder:text-muted/70 focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none",
            "disabled:opacity-60 aria-invalid:border-racing",
            icon && "ps-9",
            className,
          )}
          {...props}
        />
      </div>
    </div>
  );
}
