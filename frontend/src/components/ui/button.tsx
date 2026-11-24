import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The team's Figma (decision D-022): bold capitals, spaced (not in Arabic: globals.css).
const variants = {
  primary: "bg-racing text-white shadow-sm hover:bg-racing-hover",
  secondary: "border border-line bg-surface text-ink shadow-xs hover:border-racing hover:text-racing",
  ghost: "text-muted hover:bg-navy/5 hover:text-racing",
};

const sizes = {
  md: "h-11 px-4 text-xs",
  sm: "h-9 px-3 text-2xs",
};

/** The look of a button, for a link that acts as one (a page's "New…" action). */
export function buttonClassName(variant: keyof typeof variants = "primary", size: keyof typeof sizes = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-bold tracking-widest uppercase transition-all",
    "active:translate-y-px",
    variants[variant],
    sizes[size],
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Shows a spinner and blocks the button while an action runs. */
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClassName(variant, size), "disabled:pointer-events-none disabled:opacity-60", className)}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
