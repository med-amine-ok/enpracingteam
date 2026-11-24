import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type KpiCardProps = {
  label: string;
  value: ReactNode;
  /** A line under the figure ("12 due this week"). */
  hint?: ReactNode;
  icon?: ReactNode;
  /** The colour of the bar on top (racing red by default). */
  accent?: string;
  /** Makes the whole card a link. */
  href?: string;
  className?: string;
};

/** A key figure, as on the Figma's dashboard: a coloured bar on top, a large condensed number. */
export function KpiCard({ label, value, hint, icon, accent, href, className }: KpiCardProps) {
  const body = (
    <>
      <span
        className="absolute inset-x-0 top-0 h-1 bg-racing"
        style={accent ? { background: accent } : undefined}
        aria-hidden="true"
      />
      <span
        className="absolute -end-6 -top-8 size-24 rotate-12 rounded-2xl bg-canvas transition-transform duration-300 group-hover:rotate-6"
        aria-hidden="true"
      />
      <span className="relative flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="eyebrow mb-2 block">{label}</span>
          <span className="block font-display text-4xl leading-none font-bold text-navy">{value}</span>
          {hint ? <span className="mt-2 block text-xs text-muted">{hint}</span> : null}
        </span>
        {icon ? (
          <span className="relative text-subtle opacity-70 [&>svg]:size-7" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </span>
    </>
  );
  const classes = cn(
    "group relative block overflow-hidden rounded-lg border border-line bg-surface p-5 shadow-card transition-all duration-200",
    href && "hover:-translate-y-0.5 hover:shadow-card-hover",
    className,
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
