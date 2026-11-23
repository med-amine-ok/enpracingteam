"use client";

import { useRef, useState, type ReactNode } from "react";

/** Year switcher for the car section: a timing-screen style tab bar and one panel per year. */
export default function YearTabs({ years, panels }: { years: { year: string; label: string }[]; panels: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = (active + (e.key === "ArrowRight" ? 1 : years.length - 1)) % years.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="years">
      <div className="years-bar" role="tablist" aria-label="Car by year" onKeyDown={onKey}>
        {years.map((y, i) => (
          <button
            key={y.year}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            id={`year-tab-${y.year}`}
            aria-selected={active === i}
            aria-controls={`year-panel-${y.year}`}
            tabIndex={active === i ? 0 : -1}
            className={`years-tab ${active === i ? "is-on" : ""}`}
            onClick={() => setActive(i)}
          >
            <b>{y.year}</b>
            <span>{y.label}</span>
          </button>
        ))}
        <span className="years-ind" style={{ ["--i" as string]: active, ["--n" as string]: years.length }} aria-hidden />
      </div>
      {panels.map((p, i) => (
        <div
          key={years[i].year}
          role="tabpanel"
          id={`year-panel-${years[i].year}`}
          aria-labelledby={`year-tab-${years[i].year}`}
          className={`years-panel ${active === i ? "is-on" : ""}`}
          hidden={active !== i}
        >
          {p}
        </div>
      ))}
    </div>
  );
}
