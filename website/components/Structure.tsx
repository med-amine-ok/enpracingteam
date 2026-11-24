"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/ui";
import { MEMBERS, type Member } from "@/lib/members";
import {
  CLUB_DEPARTMENTS,
  FS_DEPARTMENTS,
  FS_LEADERSHIP,
  GOVERNANCE,
  type Unit,
} from "@/lib/content";

type Edge = { from: string; to: string[]; kind?: "fs" };

const EDGES: Edge[] = [
  { from: "root", to: ["board", "bureau"] },
  { from: "root", to: CLUB_DEPARTMENTS.map((d) => d.id) },
  { from: "projet", to: ["fs"], kind: "fs" },
  { from: "fs", to: FS_DEPARTMENTS.map((d) => d.id), kind: "fs" },
];

const SPECIAL: Record<string, Unit> = {
  board: {
    id: "board",
    name: GOVERNANCE.board.name,
    short: "Conseil",
    members: 0,
    roles: ["Governance", "Strategic direction"],
    blurb: GOVERNANCE.board.text,
  },
  bureau: {
    id: "bureau",
    name: GOVERNANCE.bureau.name,
    short: "Bureau",
    members: 0,
    roles: [
      "Department heads",
      "FS technical leads",
      "Team Lead & Chief Engineer",
    ],
    blurb: GOVERNANCE.bureau.text,
  },
  fs: {
    id: "fs",
    name: "Formula Student Team",
    short: "Formula Student",
    members: 37,
    lead: FS_LEADERSHIP,
    roles: FS_DEPARTMENTS.map((d) => d.name),
    blurb:
      "The technical core: five departments that design, build and race the car.",
  },
};
const isLead = (m: Member) =>
  !m.junior && /lead|head|manager|chief|journalist|production/i.test(m.role);
const roster = (id: string) => MEMBERS[id] ?? [];
const leadName = (u: Unit) =>
  roster(u.id).find(isLead)?.name ?? u.lead?.[0]?.name;
const count = (u: Unit) => roster(u.id).length || u.members;

const ALL: Record<string, Unit> = Object.fromEntries(
  [...CLUB_DEPARTMENTS, ...FS_DEPARTMENTS, ...Object.values(SPECIAL)].map(
    (u) => [u.id, u],
  ),
);

export default function Structure() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<
    { d: string; kind?: string; key: string }[]
  >([]);
  const [dots, setDots] = useState<{ x: number; y: number }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [sel, setSel] = useState<Unit | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);

  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    if (innerWidth < 900) {
      setPaths([]);
      setDots([]);
      return;
    }
    const b = box.getBoundingClientRect();
    const rect = (id: string) => {
      const el = box.querySelector<HTMLElement>(`[data-node="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
    };
    const out: { d: string; kind?: string; key: string }[] = [];
    const junctions: { x: number; y: number }[] = [];
    EDGES.forEach((e, ei) => {
      const p = rect(e.from);
      if (!p) return;
      const kids = e.to.map(rect).filter(Boolean) as NonNullable<
        ReturnType<typeof rect>
      >[];
      if (!kids.length) return;
      const x0 = p.x + p.w / 2;
      const y0 = p.y + p.h;
      if (ei === 0) {
        // governance: side branches at mid-height of the row
        kids.forEach((k, i) => {
          const ky = k.y + k.h / 2;
          const kx = k.x + (k.x + k.w / 2 < x0 ? k.w : 0);
          out.push({ key: `g${i}`, d: `M${x0},${y0} V${ky} H${kx}` });
          junctions.push({ x: x0, y: ky });
        });
        return;
      }
      const top = Math.min(...kids.map((k) => k.y));
      const busY = top - 34;
      const xs = kids.map((k) => k.x + k.w / 2);
      const minX = Math.min(...xs, x0);
      const maxX = Math.max(...xs, x0);
      out.push({ key: `t${ei}`, d: `M${x0},${y0} V${busY}`, kind: e.kind });
      out.push({ key: `b${ei}`, d: `M${minX},${busY} H${maxX}`, kind: e.kind });
      kids.forEach((k, i) =>
        out.push({
          key: `k${ei}-${i}`,
          d: `M${k.x + k.w / 2},${busY} V${k.y}`,
          kind: e.kind,
        }),
      );
      junctions.push({ x: x0, y: busY }, ...xs.map((x) => ({ x, y: busY })));
    });
    setSize({ w: b.width, h: b.height });
    setPaths(out);
    setDots(junctions);
  }, []);

  useLayoutEffect(() => {
    // ResizeObserver fires once on observe → initial measurement
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      removeEventListener("resize", measure);
    };
  }, [measure]);

  useEffect(() => {
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setDrawn(true),
      { threshold: 0.2 },
    );
    if (boxRef.current) io.observe(boxRef.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const open = (id: string) => setSel(ALL[id] ?? null);
  const nodeProps = (id: string) => ({
    "data-node": id,
    onClick: () => open(id),
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    type: "button" as const,
  });

  const Dept = ({ u, i, fs }: { u: Unit; i: number; fs?: boolean }) => (
    <button
      className={`org-node ${fs ? "is-fs" : ""} ${hover === u.id ? "is-hover" : ""}`}
      {...nodeProps(u.id)}
    >
      <span className="org-idx">{(fs ? "2." : "1.") + (i + 1)}</span>
      <span className="org-name">{u.short}</span>
      <span className="org-lead">{leadName(u) ?? "Collective team"}</span>
      <span className="org-meta">
        <span className="org-bar">
          <i style={{ width: `${Math.min(100, (count(u) / 14) * 100)}%` }} />
        </span>
        <span>
          {count(u) ? `${count(u)} member${count(u) > 1 ? "s" : ""}` : "|"}
        </span>
      </span>
      <span className="org-plus" aria-hidden>
        <Icon name="plus" size={14} />
      </span>
    </button>
  );

  return (
    <div className="org-wrap">
      <div ref={boxRef} className={`org ${drawn ? "is-drawn" : ""}`}>
        <svg className="org-lines" width={size.w} height={size.h} aria-hidden>
          {paths.map((p, i) => (
            <path
              key={p.key}
              d={p.d}
              className={`org-line ${p.kind === "fs" ? "fs" : ""}`}
              style={{ transitionDelay: `${i * 0.04}s` }}
              pathLength={1}
            />
          ))}
          {paths.map((p) => (
            <path
              key={"f" + p.key}
              d={p.d}
              className={`org-flow ${p.kind === "fs" ? "fs" : ""}`}
            />
          ))}
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={3} className="org-dot" />
          ))}
        </svg>

        <div className="org-row org-r0">
          <button
            className="org-root"
            {...nodeProps("bureau")}
            data-node="root"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/r-mark.png" alt="" />
            <span>
              <b>ENP Racing Team</b>
              <small>Student association · ENP Algiers</small>
            </span>
          </button>
        </div>

        <div className="org-row org-r1">
          <button className="org-gov" {...nodeProps("board")}>
            <small>Governance</small>
            <b>{GOVERNANCE.board.name}</b>
          </button>
          <span className="org-spacer" />
          <button className="org-gov" {...nodeProps("bureau")}>
            <small>Management</small>
            <b>{GOVERNANCE.bureau.name}</b>
          </button>
        </div>

        <div className="org-label">
          <span>Association departments</span>
        </div>
        <div className="org-row org-r2">
          {CLUB_DEPARTMENTS.map((u, i) => (
            <Dept key={u.id} u={u} i={i} />
          ))}
        </div>

        <div className="org-row org-r3">
          <button className="org-fs" {...nodeProps("fs")}>
            <span className="org-fs-head">
              <small>Project Department · Main project</small>
              <b>Formula Student Team</b>
            </span>
            <span className="org-fs-lead">
              {FS_LEADERSHIP.map((l) => (
                <span key={l.role}>
                  <small>{l.role}</small>
                  {l.name}
                </span>
              ))}
            </span>
          </button>
        </div>

        <div className="org-label fs">
          <span>Technical departments</span>
        </div>
        <div className="org-row org-r4">
          {FS_DEPARTMENTS.map((u, i) => (
            <Dept key={u.id} u={u} i={i} fs />
          ))}
        </div>
      </div>

      <div
        className={`drawer ${sel ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!sel}
        aria-label={sel?.name}
      >
        <div className="drawer-scrim" onClick={() => setSel(null)} />
        <aside className="drawer-panel" data-lenis-prevent>
          {sel && (
            <>
              <button
                className="drawer-close"
                onClick={() => setSel(null)}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
              <div className="drawer-kicker">
                <span className="sec-code">{sel.id.toUpperCase()}</span> ENP
                Racing Team · Structure
              </div>
              <h3 className="drawer-title">{sel.name}</h3>
              <p className="drawer-blurb">{sel.blurb}</p>
              {count(sel) > 0 && (
                <div className="drawer-count">
                  <b>{count(sel)}</b>
                  <span>members · season 2026|27</span>
                </div>
              )}
              {(() => {
                // heads only: member names stay internal
                const fromRoster = roster(sel.id).filter(isLead);
                const leads = fromRoster.length
                  ? fromRoster.map((m) => ({ name: m.name, role: m.role }))
                  : (sel.lead ?? []);
                const initials = (n: string) =>
                  n
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("");
                return (
                  leads.length > 0 && (
                    <div className="drawer-block">
                      <h4>{leads.length > 1 ? "Heads" : "Head"}</h4>
                      <ul className="drawer-leads">
                        {leads.map((l) => (
                          <li key={l.role + l.name}>
                            <span className="avatar">{initials(l.name)}</span>
                            <span>
                              <b>{l.name}</b>
                              <small>{l.role}</small>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                );
              })()}
              <div className="drawer-block">
                <h4>Missions</h4>
                <ul className="drawer-roles">
                  {sel.roles.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
