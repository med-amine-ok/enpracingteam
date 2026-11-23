"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { telemetry } from "@/lib/telemetry";

/**
 * Global motion layer: Lenis smooth scrolling wired to GSAP ScrollTrigger, plus
 * declarative data-attribute animations used by the (server-rendered) sections:
 *   data-reveal            fade/slide in        (data-reveal="left|right|up|scale")
 *   data-split             headline lines rise from a mask
 *   data-count="12.5"      count-up number      (data-decimals)
 *   data-parallax="0.2"    vertical parallax
 *   data-highlight         words light up as you scroll past
 *   data-hscroll           pinned horizontal scroller (child: [data-hscroll-track])
 *   data-clip              image wipes open
 *   data-bar="0.8"         progress bar fills to value
 *   data-draw              svg strokes draw
 */
export default function Motion() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const lenis = new Lenis({ duration: 1.15, smoothWheel: !reduce, wheelMultiplier: 0.95 });
    (window as unknown as { __lenis: Lenis }).__lenis = lenis;
    lenis.on("scroll", (l: Lenis) => {
      telemetry.scrollVel = l.velocity;
      ScrollTrigger.update();
    });
    const raf = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    // anchor links → smooth scroll
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const id = a.getAttribute("href")!;
      if (id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el as HTMLElement, { offset: id === "#top" ? 0 : -10, duration: 1.6 });
    };
    document.addEventListener("click", onClick);

    const ctx = gsap.context(() => {
      if (reduce) {
        document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
          el.textContent = Number(el.dataset.count).toFixed(Number(el.dataset.decimals || 0));
        });
        return;
      }

      // reveals
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        const dir = el.dataset.reveal;
        const from: gsap.TweenVars = { opacity: 0, y: 60 };
        if (dir === "left") Object.assign(from, { x: -80, y: 0 });
        if (dir === "right") Object.assign(from, { x: 80, y: 0 });
        if (dir === "scale") Object.assign(from, { scale: 0.92, y: 30 });
        gsap.from(el, {
          ...from,
          duration: 1.2,
          ease: "expo.out",
          delay: Number(el.dataset.delay || 0),
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        });
      });

      // staggered groups
      gsap.utils.toArray<HTMLElement>("[data-stagger]").forEach((group) => {
        gsap.from(group.children, {
          opacity: 0,
          y: 50,
          duration: 1.1,
          ease: "expo.out",
          stagger: 0.09,
          scrollTrigger: { trigger: group, start: "top 85%", once: true },
        });
      });

      // headline lines
      gsap.utils.toArray<HTMLElement>("[data-split]").forEach((el) => {
        const lines = el.querySelectorAll(".line > span");
        gsap.fromTo(
          lines,
          { yPercent: 115, rotate: 3 },
          {
            yPercent: 0,
            rotate: 0,
            duration: 1.3,
            ease: "expo.out",
            stagger: 0.1,
            scrollTrigger: { trigger: el, start: "top 85%", once: true },
          },
        );
      });

      // counters
      gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
        const end = Number(el.dataset.count);
        const dec = Number(el.dataset.decimals || 0);
        const o = { v: 0 };
        gsap.to(o, {
          v: end,
          duration: 2.2,
          ease: "power3.out",
          onUpdate: () => (el.textContent = o.v.toFixed(dec)),
          scrollTrigger: { trigger: el, start: "top 90%", once: true },
        });
      });

      // parallax
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((el) => {
        const k = Number(el.dataset.parallax || 0.2);
        gsap.fromTo(
          el,
          { yPercent: -k * 50 },
          {
            yPercent: k * 50,
            ease: "none",
            scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true },
          },
        );
      });

      // image wipes
      gsap.utils.toArray<HTMLElement>("[data-clip]").forEach((el) => {
        gsap.fromTo(
          el,
          { clipPath: "inset(12% 12% 12% 12% round 28px)" },
          {
            clipPath: "inset(0% 0% 0% 0% round 0px)",
            ease: "none",
            scrollTrigger: { trigger: el, start: "top 90%", end: "top 25%", scrub: true },
          },
        );
      });

      // word highlight
      gsap.utils.toArray<HTMLElement>("[data-highlight]").forEach((el) => {
        const words = el.textContent!.split(/\s+/);
        el.innerHTML = words.map((w) => `<span class="hw">${w}</span>`).join(" ");
        gsap.fromTo(
          el.querySelectorAll(".hw"),
          { opacity: 0.14 },
          {
            opacity: 1,
            stagger: 0.08,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 45%", scrub: true },
          },
        );
      });

      // progress bars
      gsap.utils.toArray<HTMLElement>("[data-bar]").forEach((el) => {
        gsap.fromTo(
          el,
          { scaleX: 0 },
          {
            scaleX: Number(el.dataset.bar),
            duration: 1.8,
            ease: "expo.out",
            scrollTrigger: { trigger: el, start: "top 90%", once: true },
          },
        );
      });

      // instrument gauges: needle sweeps, arc fills
      gsap.utils.toArray<HTMLElement>("[data-needle]").forEach((el) => {
        const fill = el.parentElement?.querySelector<SVGPathElement>("[data-gauge]");
        const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: "top 88%", once: true } });
        tl.fromTo(el, { "--a": "-90deg" }, { "--a": `${el.dataset.needle}deg`, duration: 1.8, ease: "elastic.out(1, 0.55)" }, 0);
        if (fill) tl.fromTo(fill, { strokeDashoffset: Number(fill.dataset.gauge) }, { strokeDashoffset: 0, duration: 1.4, ease: "power3.out" }, 0);
      });

      // svg strokes
      gsap.utils.toArray<SVGPathElement>("[data-draw]").forEach((el) => {
        const len = el.getTotalLength?.() || 600;
        gsap.fromTo(
          el,
          { strokeDasharray: len, strokeDashoffset: len },
          { strokeDashoffset: 0, duration: 2, ease: "power2.inOut", scrollTrigger: { trigger: el, start: "top 85%", once: true } },
        );
      });

      // pinned horizontal scroller (desktop only)
      const mm = gsap.matchMedia();
      mm.add("(min-width: 900px)", () => {
        gsap.utils.toArray<HTMLElement>("[data-hscroll]").forEach((wrap) => {
          const track = wrap.querySelector<HTMLElement>("[data-hscroll-track]");
          if (!track) return;
          const dist = () => Math.max(0, track.scrollWidth - innerWidth + 80);
          gsap.to(track, {
            x: () => -dist(),
            ease: "none",
            scrollTrigger: {
              trigger: wrap,
              start: "top top",
              end: () => "+=" + dist(),
              pin: true,
              scrub: 0.6,
              invalidateOnRefresh: true,
              onUpdate: (st) => wrap.style.setProperty("--hp", String(st.progress)),
            },
          });
        });
      });
    });

    // re-measure once fonts/images settle
    const t = setTimeout(() => ScrollTrigger.refresh(), 600);
    addEventListener("load", () => ScrollTrigger.refresh());

    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onClick);
      gsap.ticker.remove(raf);
      ctx.revert();
      lenis.destroy();
    };
  }, []);

  return null;
}
