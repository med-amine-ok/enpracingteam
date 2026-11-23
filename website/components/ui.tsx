import type { ReactNode } from "react";

/** Inline icons | one consistent 24px stroke set (no glyph arrows). */
export function Icon({
  name,
  size = 18,
}: {
  name: "arrow" | "down" | "up-right" | "close" | "plus";
  size?: number;
}) {
  const d = {
    arrow: "M4 12h15M13 6l6 6-6 6",
    down: "M12 4v14M6 12l6 6 6-6M5 21h14",
    "up-right": "M7 17 17 7M8 7h9v9",
    close: "M6 6l12 12M18 6 6 18",
    plus: "M12 5v14M5 12h14",
  }[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

type BtnProps = {
  href: string;
  children: string;
  variant?: "primary" | "ghost" | "paper";
  icon?: "arrow" | "down" | "up-right";
  size?: "sm" | "md" | "lg";
  download?: boolean;
  external?: boolean;
  className?: string;
};

/**
 * Notched "number-board" button: label + square cap holding the icon.
 * The label rolls to a duplicate on hover (data-label), the icon exits and re-enters.
 */
export function Btn({
  href,
  children,
  variant = "primary",
  icon = "arrow",
  size = "md",
  download,
  external,
  className = "",
}: BtnProps) {
  return (
    <a
      href={href}
      className={`btn btn-${variant} btn-${size} ${className}`}
      {...(download ? { download: true } : {})}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className="btn-label" data-label={children}>
        <span>{children}</span>
      </span>
      <span className="btn-cap">
        <span className="btn-ico">
          <Icon name={icon} />
        </span>
        <span className="btn-ico btn-ico-2">
          <Icon name={icon} />
        </span>
      </span>
    </a>
  );
}

/** Timing-screen style section header: sector code · name · ruler · meta, then title + description. */
export function SectionHead({
  code,
  name,
  meta,
  title,
  desc,
  light,
}: {
  code: string;
  name: string;
  meta?: string;
  title: ReactNode[];
  desc?: string;
  light?: boolean;
}) {
  return (
    <header className={`sec-head ${light ? "is-light" : ""}`}>
      <div className="sec-bar" data-reveal>
        <span className="sec-code">{code}</span>
        <span className="sec-name">{name}</span>
        <span className="sec-ruler" aria-hidden />
        {meta && <span className="sec-meta">{meta}</span>}
      </div>
      <div className="sec-body">
        <h2 className="sec-title" data-split>
          {title.map((l, i) => (
            <span className="line" key={i}>
              <span>{l}</span>
            </span>
          ))}
        </h2>
        {desc && (
          <p className="sec-desc" data-reveal data-delay="0.15">
            {desc}
          </p>
        )}
      </div>
    </header>
  );
}

/** Crop/registration marks drawn on the four corners of a plate. */
export function Marks() {
  return (
    <span className="marks" aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
