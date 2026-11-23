"use client";

import { useEffect, useRef, useState } from "react";
import { telemetry } from "@/lib/telemetry";

/** Lights-out start sequence: 5 red lights fill with loading progress, then go out. */
export default function Loader() {
  const [gone, setGone] = useState(false);
  const [out, setOut] = useState(false);
  const numRef = useRef<HTMLSpanElement>(null);
  const lightsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("is-loading");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let shown = 0;
    let raf = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      // lights out
      lightsRef.current?.classList.add("out");
      setTimeout(() => {
        setOut(true);
        document.documentElement.classList.remove("is-loading");
        document.body.classList.add("ready");
      }, reduce ? 0 : 420);
      setTimeout(() => setGone(true), reduce ? 50 : 1600);
    };
    const loop = (now: number) => {
      const minTime = Math.min(1, (now - t0) / (reduce ? 1 : 1900));
      const target = Math.min(minTime, telemetry.ready ? telemetry.load : telemetry.load * 0.95);
      shown += (target - shown) * 0.12;
      if (target >= 1 && shown > 0.995) shown = 1;
      if (numRef.current) numRef.current.textContent = String(Math.round(shown * 100)).padStart(3, "0");
      const lit = Math.floor(shown * 5.001);
      lightsRef.current?.querySelectorAll("i").forEach((el, i) => el.classList.toggle("on", i < lit));
      if (shown >= 1 && telemetry.ready) return finish();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const safety = setTimeout(finish, 9000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, []);

  if (gone) return null;
  return (
    <div className={`loader ${out ? "loader-out" : ""}`} aria-hidden>
      <div className="loader-panel loader-top" />
      <div className="loader-panel loader-bottom" />
      <div className="loader-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-light-ink.png" alt="" className="loader-logo" />
        <div ref={lightsRef} className="loader-lights">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="loader-meta">
          <span>Lights out &amp; away we go</span>
          <span>
            <span ref={numRef}>000</span>%
          </span>
        </div>
      </div>
    </div>
  );
}
