import type { ReactNode } from "react";

/** Title of a page, in the team's Figma capitals, with its introduction and optional actions at the end. */
export function PageHeader({
  title,
  description,
  eyebrow,
  children,
}: {
  title: ReactNode;
  description?: string;
  /** A short label above the title ("Logistique", "Équipe"). */
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="font-display text-3xl leading-none font-extrabold tracking-wider text-navy uppercase sm:text-4xl">
          {title}
        </h1>
        {description ? <p className="text-sm text-muted sm:text-base">{description}</p> : null}
      </div>
      {children}
    </header>
  );
}
