"use client";

import { useEffect, useRef, useState } from "react";
import { NAV, SITE } from "@/lib/content";
import { telemetry } from "@/lib/telemetry";
import { Btn } from "@/components/ui";

const LEDS = 12;
const MAX_KMH = 200;

/** Fixed UI: navigation, lap-progress bar and the steering-wheel display (HUD). */
export default function Chrome() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const progRef = useRef<HTMLDivElement>(null);
  const kmhRef = useRef<HTMLElement>(null);
  const gearRef = useRef<HTMLElement>(null);
  const ledsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(scrollY > 60);
      // the speedometer belongs to the 3D drive: park it once the scene is over
      const scene = document.querySelector<HTMLElement>(".scene");
      document.documentElement.classList.toggle("hud-off", !!scene && scrollY > scene.offsetHeight - innerHeight * 0.6);
      const h = document.documentElement.scrollHeight - innerHeight;
      if (progRef.current) progRef.current.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });

    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), {
      rootMargin: "-45% 0px -50% 0px",
    });
    NAV.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });

    // scene speed while racing, otherwise scroll velocity
    const leds = ledsRef.current ? Array.from(ledsRef.current.children) : [];
    let shown = 0;
    let lit = -1;
    let raf = 0;
    const hud = () => {
      const target = Math.max(telemetry.speed, Math.min(Math.abs(telemetry.scrollVel) * 3, 180));
      shown += (target - shown) * 0.1;
      const v = Math.round(shown);
      if (kmhRef.current) kmhRef.current.textContent = String(v).padStart(3, "0");
      if (gearRef.current) gearRef.current.textContent = v < 2 ? "N" : String(Math.min(4, 1 + Math.floor(v / 52)));
      const n = Math.round((Math.min(shown, MAX_KMH) / MAX_KMH) * LEDS);
      if (n !== lit) {
        lit = n;
        leds.forEach((el, i) => el.classList.toggle("on", i < n));
        ledsRef.current?.classList.toggle("limit", n >= LEDS);
      }
      raf = requestAnimationFrame(hud);
    };
    raf = requestAnimationFrame(hud);

    return () => {
      removeEventListener("scroll", onScroll);
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", open);
  }, [open]);

  return (
    <>
      <div className="lapbar" aria-hidden>
        <div ref={progRef} className="lapbar-fill" />
      </div>
      <header className={`nav ${scrolled ? "nav-scrolled" : ""}`}>
        <div className="wrap nav-inner">
          <a href="#top" className="brand" aria-label="ENP Racing Team home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/r-mark.png" alt="" className="brand-mark" />
            <span className="brand-text">
              ENP Racing Team
              <small>National Polytechnic School · Algiers</small>
            </span>
          </a>
          <nav className={`nav-links ${open ? "open" : ""}`} aria-label="Main navigation">
            {NAV.map((n, i) => (
              <a key={n.id} href={`#${n.id}`} className={active === n.id ? "active" : ""} onClick={() => setOpen(false)}>
                <small>S0{i + 1}</small>
                <span>{n.label}</span>
              </a>
            ))}
            <span className="nav-cta" onClick={() => setOpen(false)}>
              <Btn href={SITE.dossier} download icon="down" size="sm">
                Sponsorship deck
              </Btn>
            </span>
          </nav>
          <button
            className={`nav-toggle ${open ? "open" : ""}`}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <i />
            <i />
          </button>
        </div>
      </header>

      <div className="hud" aria-hidden>
        <div ref={ledsRef} className="hud-leds">
          {Array.from({ length: LEDS }, (_, i) => (
            <i key={i} className={i < 4 ? "g" : i < 8 ? "r" : "w"} />
          ))}
        </div>
        <div className="hud-screen">
          <div className="hud-speed">
            <b ref={kmhRef}>000</b>
            <span>km/h</span>
          </div>
          <div className="hud-gear">
            <b ref={gearRef}>N</b>
            <span>Gear</span>
          </div>
        </div>
        <div className="hud-foot">
          <span>#19</span>
          <span>ENP·RT</span>
        </div>
      </div>
    </>
  );
}
