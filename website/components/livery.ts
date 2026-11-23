import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import specsJson from "./livery-specs.json";

/*
 * Livery of the ENP Racing Team car #19 (FS UK 2026), applied to the generic FS mesh:
 * red body, white sidepods with "École Nationale Polytechnique", black nose / wings,
 * #19 roundels, ENP marks, branded tyres with blue hubs.
 * Coordinates are the mesh's local space (nose towards +X, y up).
 */

function canvas(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

// next/font hashes family names — read the real one from the CSS variable
const family = () =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim()) ||
  '"Arial Narrow", Impact, sans-serif';
const font = (s: number) => `900 ${s}px ${family()}, Impact, sans-serif`;

/** Decal textures, drawn once the logo image is available. */
async function textures() {
  const logo = await loadImage("/brand/logo-light-ink.png").catch(() => null);
  const mark = await loadImage("/brand/r-mark.png").catch(() => null);
  await document.fonts?.ready;

  const roundel = canvas(512, 512, (x) => {
    x.fillStyle = "#0b0b0c";
    x.beginPath();
    x.roundRect(24, 120, 464, 272, 120);
    x.fill();
    x.strokeStyle = "#f4f1ea";
    x.lineWidth = 12;
    x.beginPath();
    x.roundRect(44, 140, 424, 232, 100);
    x.stroke();
    x.fillStyle = "#f4f1ea";
    x.font = font(250);
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("19", 256, 268);
  });

  const noseText = canvas(2048, 160, (x) => {
    x.fillStyle = "#0b0b0c";
    x.font = font(118);
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("ÉCOLE NATIONALE POLYTECHNIQUE", 1024, 84);
  });

  const sideNumber = canvas(256, 256, (x) => {
    x.fillStyle = "#f4f1ea";
    x.fillRect(16, 16, 224, 224);
    x.fillStyle = "#0b0b0c";
    x.font = font(170);
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("19", 128, 136);
  });

  // partner wordmarks as stickers (white on red), as seen on the car's flanks
  const stickers = canvas(1024, 384, (x) => {
    x.fillStyle = "#f4f1ea";
    x.textBaseline = "middle";
    const row = (items: [string, string, number][], y: number) => {
      let cx = 20;
      for (const [t, f, size] of items) {
        x.font = f.replace("{s}", String(size));
        x.fillText(t, cx, y);
        cx += x.measureText(t).width + 36;
      }
    };
    row([["MathWorks", "italic 700 {s}px Arial, sans-serif", 70], ["Ansys", "700 {s}px Arial, sans-serif", 72], ["SKF", "900 {s}px Arial Black, sans-serif", 70]], 64);
    row([["DASSAULT SYSTÈMES", "700 {s}px Arial, sans-serif", 46], ["slb", "900 {s}px Arial, sans-serif", 66], ["IPG", "900 {s}px Arial, sans-serif", 62]], 180);
    row([["VMS", "italic 900 {s}px Arial Black, sans-serif", 64], ["cosider", "italic 700 {s}px Arial, sans-serif", 60], ["AIR ALGÉRIE", "700 {s}px Arial, sans-serif", 44], ["OXY", "900 {s}px Arial, sans-serif", 56]], 300);
  });

  // rear-wing endplate as on the real car: partner marks on top, big 19, ENP mark at the bottom
  const endplate = canvas(512, 512, (x) => {
    x.fillStyle = "#f4f1ea";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.font = "italic 700 34px Arial, sans-serif";
    x.fillText("AIR ALGÉRIE", 150, 46);
    x.font = "900 34px Arial, sans-serif";
    x.fillText("OXY", 380, 46);
    x.font = "700 26px Arial, sans-serif";
    x.fillText("SIMSCALE", 150, 92);
    x.fillStyle = "#f2a51f";
    x.fillText("RHODIUS", 380, 92);
    x.fillStyle = "#f4f1ea";
    x.font = "600 24px Arial, sans-serif";
    x.fillText("rapidHARNESS", 150, 134);
    x.fillText("IPG", 380, 134);
    x.font = font(270);
    x.fillText("19", 256, 300);
    if (mark) x.drawImage(mark, 150, 420, 212, (212 * mark.height) / mark.width);
  });

  const fsSticker = canvas(512, 256, (x) => {
    x.fillStyle = "#f4f1ea";
    x.fillRect(0, 0, 512, 256);
    x.fillStyle = "#e1251b";
    x.fillRect(18, 18, 120, 220);
    x.fillStyle = "#0b0b0c";
    x.font = font(92);
    x.textBaseline = "middle";
    x.fillText("FORMULA", 160, 82);
    x.fillText("STUDENT", 160, 172);
  });

  const sidepod = canvas(2048, 256, (x) => {
    x.fillStyle = "#0b0b0c";
    x.font = font(150);
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("ÉCOLE NATIONALE POLYTECHNIQUE", 1024, 128);
  });

  const body = canvas(1024, 256, (x) => {
    if (mark) x.drawImage(mark, 10, 40, 340, (340 * mark.height) / mark.width);
    x.fillStyle = "#f4f1ea";
    x.font = font(120);
    x.textBaseline = "middle";
    x.fillText("ENP RACING", 380, 100);
    x.font = font(62);
    x.fillStyle = "rgba(244,241,234,.85)";
    x.fillText("FORMULA STUDENT · ALGERIA", 384, 196);
  });

  const wingLogo = canvas(512, 512, (x) => {
    if (logo) {
      const w = 440;
      x.drawImage(logo, 36, 60, w, (w * logo.height) / logo.width);
    }
  });

  return { roundel, endplate, sidepod, body, wingLogo, noseText, sideNumber, stickers, fsSticker };
}

/** Tyre + rim texture keyed by (angle, radius) — the wheel mesh gets matching UVs below. */
function wheelTexture() {
  return canvas(2048, 512, (x) => {
    // v (y axis of the canvas) = radius: 0 at hub (bottom), 1 at tread (top)
    const H = 512;
    const g = x.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, "#c21e1a"); // centre-lock nut
    g.addColorStop(0.08, "#1b1c20");
    g.addColorStop(0.17, "#2b2c31");
    g.addColorStop(0.5, "#3a3b40"); // rim
    g.addColorStop(0.58, "#2a2b30");
    g.addColorStop(0.6, "#141416"); // rubber
    g.addColorStop(1, "#18181b");
    x.fillStyle = g;
    x.fillRect(0, 0, 2048, H);
    // rim spokes
    x.fillStyle = "rgba(0,0,0,.45)";
    for (let i = 0; i < 10; i++) x.fillRect((i * 2048) / 10, H * 0.42, 60, H * 0.4);
    // sidewall lettering band
    x.fillStyle = "rgba(244,241,234,.42)";
    x.font = font(70);
    x.textBaseline = "middle";
    x.textAlign = "center";
    for (let k = 0; k < 2; k++) x.fillText("RACING SLICK", 512 + k * 1024, H * 0.21);
    x.font = font(40);
    x.fillStyle = "rgba(244,241,234,.3)";
    for (let k = 0; k < 2; k++) x.fillText("20.5 x 7.0 - 13", 1024 + k * 1024, H * 0.21);
  });
}

/** Cylindrical UVs for the wheel (axis = Z): u = angle, v = radius / R. */
export function wheelUVs(g: THREE.BufferGeometry) {
  const p = g.attributes.position;
  let R = 0;
  for (let i = 0; i < p.count; i++) R = Math.max(R, Math.hypot(p.getX(i), p.getY(i)));
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    uv[i * 2] = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
    uv[i * 2 + 1] = Math.min(1, Math.hypot(x, y) / R);
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

export function wheelMaterial() {
  const map = wheelTexture();
  return new THREE.MeshStandardMaterial({ map, metalness: 0.35, roughness: 0.62 });
}

type Spec = {
  tex: keyof Awaited<ReturnType<typeof textures>>;
  /** ray origin and direction used to find the surface */
  from: [number, number, number];
  dir: [number, number, number];
  size: [number, number, number];
  spin?: number;
  targets: ("red" | "white" | "carbon")[];
};

// Decal placements live in livery-specs.json so the offline baker (scripts/bake-livery.mjs) uses the same data.
const SPECS = specsJson as Spec[];

type Baked = { tex: Spec["tex"]; p: string; n: string; uv: string; i?: string; w?: 2 | 4 }[];

function b64Buf(b64: string) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
const b64ToF32 = (b64: string) => new Float32Array(b64Buf(b64));

function decalMaterial(map: THREE.Texture) {
  return new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    roughness: 0.3,
  });
}

/** Project the livery decals onto the car meshes (call while the model has an identity transform). */
export async function applyLivery(meshes: Record<"red" | "white" | "carbon", THREE.Mesh>, parent: THREE.Object3D) {
  const [tex, baked] = await Promise.all([
    textures(),
    fetch("/models/enp-livery.json")
      .then((r) => (r.ok ? (r.json() as Promise<Baked>) : null))
      .catch(() => null),
  ]);
  const out: THREE.Mesh[] = [];
  const mats = new Map<string, THREE.Material>();
  const matFor = (k: Spec["tex"]) => mats.get(k) ?? (mats.set(k, decalMaterial(tex[k])), mats.get(k)!);

  // fast path: geometry pre-baked offline (no per-triangle decal clipping in the browser)
  if (baked?.length) {
    for (const b of baked) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(b64ToF32(b.p), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(b64ToF32(b.n), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(b64ToF32(b.uv), 2));
      if (b.i) g.setIndex(new THREE.BufferAttribute(b.w === 4 ? new Uint32Array(b64Buf(b.i)) : new Uint16Array(b64Buf(b.i)), 1));
      const d = new THREE.Mesh(g, matFor(b.tex));
      d.renderOrder = 2;
      parent.add(d);
      out.push(d);
    }
    return out;
  }

  // fallback: project at runtime
  const rc = new THREE.Raycaster();
  const helper = new THREE.Object3D();
  parent.updateMatrixWorld(true);
  for (const s of SPECS) {
    const targets = s.targets.map((k) => meshes[k]);
    rc.set(new THREE.Vector3(...s.from), new THREE.Vector3(...s.dir).normalize());
    const hit = rc.intersectObjects(Object.values(meshes), false)[0];
    if (!hit || !targets.includes(hit.object as THREE.Mesh)) continue;
    helper.position.copy(hit.point);
    // project straight along the ray (keeps text level), not along the facet normal
    helper.lookAt(hit.point.clone().sub(new THREE.Vector3(...s.dir)));
    helper.rotateZ(s.spin ?? 0);
    for (const t of targets) {
      const g = new DecalGeometry(t, helper.position, helper.rotation, new THREE.Vector3(...s.size));
      if (g.attributes.position.count === 0) continue;
      const d = new THREE.Mesh(g, matFor(s.tex));
      d.renderOrder = 2;
      parent.add(d);
      out.push(d);
    }
  }
  return out;
}
