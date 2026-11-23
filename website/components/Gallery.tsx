"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { GALLERY } from "@/lib/content";
import { Icon } from "@/components/ui";

/** Photo mosaic from the team's Instagram, with a keyboard-friendly lightbox. */
export default function Gallery() {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const go = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + GALLERY.length) % GALLERY.length)), []);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    addEventListener("keydown", onKey);
    document.documentElement.classList.add("menu-open");
    return () => {
      removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("menu-open");
    };
  }, [open, close, go]);

  const cur = open === null ? null : GALLERY[open];

  return (
    <>
      <div className="mosaic" data-stagger>
        {GALLERY.map((g, i) => (
          <button key={g.src} className={`tile tile-${g.span ?? "n"}`} onClick={() => setOpen(i)} aria-label={`Open photo: ${g.caption}`}>
            <Image src={g.src} alt={g.caption} fill sizes="(max-width: 800px) 100vw, 40vw" style={{ objectFit: "cover" }} />
            <span className="tile-cap">
              <b>{String(i + 1).padStart(2, "0")}</b>
              {g.caption}
            </span>
          </button>
        ))}
      </div>

      <div className={`lightbox ${cur ? "open" : ""}`} role="dialog" aria-modal="true" aria-hidden={!cur} aria-label="Photo viewer">
        <div className="lightbox-scrim" onClick={close} />
        {cur && (
          <figure className="lightbox-fig">
            <Image src={cur.src} alt={cur.caption} fill sizes="90vw" style={{ objectFit: "contain" }} priority />
            <figcaption>
              <span className="sec-code">{String((open ?? 0) + 1).padStart(2, "0")}/{GALLERY.length}</span>
              {cur.caption}
            </figcaption>
          </figure>
        )}
        <button className="lb-btn lb-close" onClick={close} aria-label="Close">
          <Icon name="close" />
        </button>
        <button className="lb-btn lb-prev" onClick={() => go(-1)} aria-label="Previous photo">
          <span style={{ display: "grid", transform: "scaleX(-1)" }}>
            <Icon name="arrow" />
          </span>
        </button>
        <button className="lb-btn lb-next" onClick={() => go(1)} aria-label="Next photo">
          <Icon name="arrow" />
        </button>
      </div>
    </>
  );
}
