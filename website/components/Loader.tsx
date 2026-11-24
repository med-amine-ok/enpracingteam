"use client";

import { useEffect, useRef, useState } from "react";
import { telemetry } from "@/lib/telemetry";

const FACTS = [
  "92 hp · 78 Nm",
  "0–100 km/h in 5 s",
  "314 kg",
  "Top speed 200 km/h",
  "RWD · 6-speed sequential",
  "Best Newcomer · FS UK 2026",
];
const LEDS = 15;
const KEYS_BLOCKED = new Set([
  " ",
  "Spacebar",
  "ArrowDown",
  "ArrowUp",
  "PageDown",
  "PageUp",
  "Home",
  "End",
]);

/**
 * Start sequence. Scrolling is locked until the 3D scene is ready; meanwhile visitors can rev the
 * engine (hold anywhere or Space), shifting through the 6 gears, while the 5 start lights fill with
 * loading progress. When the lights go out, a click measures their reaction time.
 */
export default function Loader() {
  const [gone, setGone] = useState(false);
  const [out, setOut] = useState(false);
  const [reaction, setReaction] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const lightsRef = useRef<HTMLDivElement>(null);
  const rpmRef = useRef<HTMLSpanElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  const ledsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLSpanElement>(null);
  const factRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("is-loading");
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    scrollTo(0, 0);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---- scroll lock: block wheel / touch / keys before Lenis or the browser see them
    const block = (e: Event) => {
      if (e.type === "keydown") {
        // keys: only stop the browser's native scroll, the rev toy still listens to Space
        if (KEYS_BLOCKED.has((e as KeyboardEvent).key)) e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const lockOpts = { capture: true, passive: false } as const;
    addEventListener("wheel", block, lockOpts);
    addEventListener("touchmove", block, lockOpts);
    addEventListener("keydown", block, lockOpts);
    const unlock = () => {
      removeEventListener("wheel", block, lockOpts);
      removeEventListener("touchmove", block, lockOpts);
      removeEventListener("keydown", block, lockOpts);
    };

    // ---- rev toy
    let held = false;
    let rpm = 0.08;
    let gear = 1;
    const down = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== " ") return;
      held = true;
    };
    const up = (e: Event) => {
      if (e.type === "keyup" && (e as KeyboardEvent).key !== " ") return;
      held = false;
    };
    const el = root.current!;
    el.addEventListener("pointerdown", down);
    addEventListener("pointerup", up);
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    const onMove = (e: PointerEvent) => {
      el.style.setProperty("--mx", String(e.clientX / innerWidth - 0.5));
      el.style.setProperty("--my", String(e.clientY / innerHeight - 0.5));
    };
    addEventListener("pointermove", onMove, { passive: true });

    const leds = Array.from(ledsRef.current?.children ?? []) as HTMLElement[];
    let fact = 0;
    const factTimer = setInterval(() => {
      fact = (fact + 1) % FACTS.length;
      if (factRef.current) {
        factRef.current.textContent = FACTS[fact];
        factRef.current.animate(
          [
            { opacity: 0, transform: "translateY(6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 400, easing: "ease-out" },
        );
      }
    }, 2200);

    const t0 = performance.now();
    let last = t0;
    let shown = 0;
    let raf = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      held = false;
      lightsRef.current?.classList.add("out");
      if (stageRef.current) stageRef.current.textContent = "Lights out | go!";
      const outAt = performance.now();
      // reaction test: first click / key after the lights go out
      const react = () => {
        const ms = performance.now() - outAt;
        if (ms < 2500) setReaction((ms / 1000).toFixed(3));
        removeEventListener("pointerdown", react, true);
        removeEventListener("keydown", react, true);
      };
      addEventListener("pointerdown", react, true);
      addEventListener("keydown", react, true);
      setTimeout(() => {
        removeEventListener("pointerdown", react, true);
        removeEventListener("keydown", react, true);
      }, 2500);
      setTimeout(
        () => {
          unlock();
          setOut(true);
          html.classList.remove("is-loading");
          document.body.classList.add("ready");
        },
        reduce ? 0 : 520,
      );
      setTimeout(() => setGone(true), reduce ? 50 : 1700);
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // progress: real model download, held back until the scene has rendered its first frame
      const minTime = Math.min(1, (now - t0) / (reduce ? 1 : 2200));
      const target = Math.min(
        minTime,
        telemetry.ready ? 1 : telemetry.load * 0.92,
      );
      shown += (target - shown) * 0.1;
      if (target >= 1 && shown > 0.995) shown = 1;
      if (numRef.current)
        numRef.current.textContent = String(Math.round(shown * 100)).padStart(
          3,
          "0",
        );
      const lit = Math.floor(shown * 5.001);
      lightsRef.current
        ?.querySelectorAll("i")
        .forEach((l, i) => l.classList.toggle("on", i < lit));
      if (stageRef.current && !finished) {
        stageRef.current.textContent =
          telemetry.load < 1
            ? "Loading car #19"
            : telemetry.ready
              ? "Grid ready"
              : "Warming up the engine";
      }

      // rev: rises while held, auto-shifts at the limiter through 4 gears, falls when released
      if (held) {
        rpm += dt * (1.3 - gear * 0.13);
        if (rpm >= 1) {
          if (gear < 6) {
            gear++;
            rpm = 0.55;
          } else rpm = 0.96 + Math.random() * 0.04; // limiter bounce
        }
      } else {
        rpm = Math.max(0.08, rpm - dt * 0.9);
        if (rpm < 0.3 && gear > 1) gear = 1;
      }
      const idle = held ? 0 : Math.sin(now / 90) * 0.006;
      const r = rpm + idle;
      if (rpmRef.current)
        rpmRef.current.textContent = String(Math.round(r * 12500)).padStart(
          5,
          "0",
        );
      if (gearRef.current) gearRef.current.textContent = String(gear);
      const on = Math.round(r * LEDS);
      leds.forEach((l, i) => l.classList.toggle("on", i < on));
      el.classList.toggle(
        "limiter",
        rpm > 0.95 && Math.floor(now / 70) % 2 === 0,
      );

      if (shown >= 1 && telemetry.ready) return finish();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // never trap people: let them in after 25 s even on a very slow device
    const safety = setTimeout(finish, 25000);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
      clearInterval(factTimer);
      unlock();
      el.removeEventListener("pointerdown", down);
      removeEventListener("pointerup", up);
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("pointermove", onMove);
    };
  }, []);

  useEffect(() => {
    if (!reaction) return;
    const t = setTimeout(() => setReaction(null), 2600);
    return () => clearTimeout(t);
  }, [reaction]);

  return (
    <>
      {!gone && (
        <div
          ref={root}
          className={`loader ${out ? "loader-out" : ""}`}
          role="status"
          aria-label="Loading ENP Racing Team"
        >
          <div className="loader-panel loader-top" />
          <div className="loader-panel loader-bottom" />
          <div className="loader-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-light-ink.png"
              alt=""
              className="loader-logo"
            />
            <div ref={lightsRef} className="loader-lights" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>

            <div className="rev" aria-hidden>
              <div ref={ledsRef} className="rev-leds">
                {Array.from({ length: LEDS }, (_, i) => (
                  <i key={i} className={i < 5 ? "g" : i < 10 ? "r" : "b"} />
                ))}
              </div>
              <div className="rev-read">
                <span className="rev-gear">
                  <small>Gear</small>
                  <span ref={gearRef}>1</span>
                </span>
                <span className="rev-rpm">
                  <span ref={rpmRef}>01000</span>
                  <small>rpm</small>
                </span>
              </div>
            </div>
            <p className="loader-hint">
              <span className="key">Hold</span> anywhere or{" "}
              <span className="key">Space</span> to rev the engine
            </p>

            {/* compositor-only motion: keeps moving even while the main thread compiles shaders */}
            <div className="loader-track" aria-hidden>
              <i />
            </div>
            <div className="loader-meta">
              <span ref={stageRef}>Loading car #19</span>
              <span ref={factRef} className="loader-fact">
                {FACTS[0]}
              </span>
              <span>
                <span ref={numRef}>000</span>%
              </span>
            </div>
          </div>
        </div>
      )}
      {reaction && (
        <div className="reaction" role="status">
          <small>Your reaction time</small>
          <b>{reaction} s</b>
        </div>
      )}
    </>
  );
}
