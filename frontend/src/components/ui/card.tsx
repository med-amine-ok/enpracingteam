import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CardProps = {
  title?: string;
  description?: string;
  /** Shown at the end of the title line (a button, a count…). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Card({ title, description, action, className, children }: CardProps) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface p-5 shadow-card sm:p-6", className)}>
      {title ? (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="space-y-1">
            {/* The Figma's section titles: a red bar, then condensed capitals. */}
            <h2 className="flex items-center gap-2.5 font-display text-lg leading-tight font-bold tracking-wide text-navy uppercase">
              <span className="h-4 w-1 shrink-0 rounded-full bg-racing" aria-hidden="true" />
              {title}
            </h2>
            {description ? <p className="text-sm text-muted">{description}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Grey bars standing for text while the API has not answered. */
export function LinesPlaceholder({ lines }: { lines: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="h-4 animate-pulse rounded bg-line" style={{ width: `${85 - index * 15}%` }} />
      ))}
    </div>
  );
}
