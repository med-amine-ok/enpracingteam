import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  error: { icon: CircleAlert, className: "border-racing/20 bg-racing-soft text-racing-strong" },
  warning: { icon: TriangleAlert, className: "border-warning/25 bg-warning-soft text-warning" },
  info: { icon: Info, className: "border-navy/10 bg-info-soft text-navy" },
  success: { icon: CircleCheck, className: "border-success/20 bg-success-soft text-success" },
};

type AlertProps = {
  tone?: keyof typeof tones;
  children: ReactNode;
  className?: string;
};

/** A message in the page. Errors are read out at once by screen readers (role="alert"). */
export function Alert({ tone = "info", children, className }: AlertProps) {
  const { icon: Icon, className: toneClassName } = tones[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm", toneClassName, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
