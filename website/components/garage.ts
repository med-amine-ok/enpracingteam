import * as THREE from "three";

/** texture-noise density (lowered on light devices) */
const QUALITY = { k: 1 };
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

let rectInit = false;

/*
 * The team workshop, built procedurally around the car (origin, car facing −X).
 * Epoxy floor with the #19 bay, block walls, ENP banner + Algerian flag, pegboard tool wall,
 * whiteboard sketches, workbenches, tool chest, shelving, tyre stacks, cones and LED strips.
 * The roller door is in the −X wall: open it and the car drives straight out onto the circuit.
 */

const L = 18; // along x
const W = 15; // along z
const H = 5.2;
const DOOR_W = 6.4;
const DOOR_H = 3.9;

function tex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

function speckle(x: CanvasRenderingContext2D, w: number, h: number, n: number, a: number) {
  for (let i = 0, N = Math.round(n * QUALITY.k); i < N; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    x.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`;
    x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

// ---------------------------------------------------------------- textures
const floorTex = () =>
  tex(2048, 1707, (x) => {
    const w = 2048;
    const h = 1707;
    x.fillStyle = "#2e3035";
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, 120000, 0.08);
    // soft oil stains / wear
    for (let i = 0; i < 26; i++) {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 40 + Math.random() * 120);
      g.addColorStop(0, "rgba(0,0,0,.22)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.save();
      x.translate(Math.random() * w, Math.random() * h);
      x.scale(1, 0.6);
      x.fillStyle = g;
      x.fillRect(-200, -200, 400, 400);
      x.restore();
    }
    // concrete slab joints
    x.strokeStyle = "rgba(0,0,0,.35)";
    x.lineWidth = 3;
    for (let i = 1; i < 6; i++) {
      x.beginPath();
      x.moveTo((i * w) / 6, 0);
      x.lineTo((i * w) / 6, h);
      x.stroke();
    }
    for (let j = 1; j < 5; j++) {
      x.beginPath();
      x.moveTo(0, (j * h) / 5);
      x.lineTo(w, (j * h) / 5);
      x.stroke();
    }
    // hazard border along the walls
    const band = 40;
    for (let i = 0; i < w; i += 60) {
      x.fillStyle = (i / 60) % 2 ? "#141414" : "#e6b81e";
      x.fillRect(i, 0, 60, band);
      x.fillRect(i, h - band, 60, band);
    }
    // car bay (centre): white box with #19 and stencil lettering
    const bx = w * 0.27;
    const by = h * 0.31;
    const bw = w * 0.46;
    const bh = h * 0.38;
    x.strokeStyle = "rgba(240,238,232,.85)";
    x.lineWidth = 14;
    x.strokeRect(bx, by, bw, bh);
  });

const wallTex = () =>
  tex(1024, 512, (x) => {
    // painted concrete block wall, darker dado band
    x.fillStyle = "#4a4d54";
    x.fillRect(0, 0, 1024, 512);
    x.fillStyle = "#26282d";
    x.fillRect(0, 330, 1024, 182);
    x.fillStyle = "#e1251b";
    x.fillRect(0, 322, 1024, 8);
    x.strokeStyle = "rgba(0,0,0,.18)";
    x.lineWidth = 2;
    for (let r = 0; r < 512; r += 42) {
      x.beginPath();
      x.moveTo(0, r);
      x.lineTo(1024, r);
      x.stroke();
      for (let c = (r / 42) % 2 ? 0 : 64; c < 1024; c += 128) {
        x.beginPath();
        x.moveTo(c, r);
        x.lineTo(c, r + 42);
        x.stroke();
      }
    }
    speckle(x, 1024, 512, 30000, 0.07);
  }, [3, 1]);

const whiteboardTex = () =>
  tex(1024, 640, (x) => {
    x.fillStyle = "#f4f4f1";
    x.fillRect(0, 0, 1024, 640);
    x.fillStyle = "#8f9196";
    x.fillRect(0, 0, 1024, 14);
    x.fillRect(0, 626, 1024, 14);
    x.strokeStyle = "#1b3d8f";
    x.fillStyle = "#1b3d8f";
    x.lineWidth = 4;
    x.font = 'italic 34px "Segoe Print", "Comic Sans MS", cursive';
    x.fillText("Grand 1 (Avant)", 60, 70);
    x.fillText("Fz = m·g + ½ρ·v²·Cl·A", 60, 130);
    x.fillText("K_roll = 0.5·k·t²", 60, 190);
    x.fillText("Δt brake = 0.8 s", 60, 250);
    x.fillText("Chassis Δ < 2 mm ✓", 60, 310);
    // suspension double wishbone sketch
    x.strokeStyle = "#111";
    x.beginPath();
    x.moveTo(600, 140);
    x.lineTo(820, 170);
    x.lineTo(600, 260);
    x.moveTo(820, 170);
    x.lineTo(880, 330);
    x.lineTo(600, 360);
    x.moveTo(880, 330);
    x.lineTo(830, 470);
    x.stroke();
    x.beginPath();
    x.arc(890, 300, 110, -1.2, 1.4);
    x.stroke();
    x.fillStyle = "#e1251b";
    x.font = 'italic 30px "Segoe Print", "Comic Sans MS", cursive';
    x.fillText("camber -1.5°", 620, 520);
    x.strokeStyle = "#e1251b";
    x.strokeRect(50, 380, 430, 190);
    x.fillText("TODO before FSUK:", 70, 420);
    x.fillStyle = "#111";
    x.fillText("- tilt test", 70, 465);
    x.fillText("- brake test  ✓", 70, 505);
    x.fillText("- rain light wiring", 70, 545);
  });

const doorTex = () =>
  tex(512, 512, (x) => {
    for (let i = 0; i < 512; i += 32) {
      const g = x.createLinearGradient(0, i, 0, i + 32);
      g.addColorStop(0, "#8d9198");
      g.addColorStop(0.5, "#b8bcc3");
      g.addColorStop(1, "#6d7178");
      x.fillStyle = g;
      x.fillRect(0, i, 512, 32);
    }
    speckle(x, 512, 512, 8000, 0.1);
  }, [3, 4]);

/** The team logo alone, painted on the wall (transparent background, no extra lettering). */
async function bannerTex() {
  const logo = await loadImage("/brand/logo-light-ink.png");
  return tex(1024, 870, (x) => {
    x.clearRect(0, 0, 1024, 870);
    if (logo) x.drawImage(logo, 0, 0, 1024, (1024 * logo.height) / logo.width);
  });
}

/** Algerian flag at official proportions (2:3): green / white halves, red crescent and star. */
const flagTex = () =>
  tex(1500, 1000, (x) => {
    const H = 1000;
    const Wd = 1500;
    x.fillStyle = "#006633";
    x.fillRect(0, 0, Wd / 2, H);
    x.fillStyle = "#ffffff";
    x.fillRect(Wd / 2, 0, Wd / 2, H);
    const cx = Wd / 2;
    const cy = H / 2;
    // crescent = outer disc minus an inner disc offset towards the fly
    const cres = document.createElement("canvas");
    cres.width = Wd;
    cres.height = H;
    const c = cres.getContext("2d")!;
    c.fillStyle = "#d21034";
    c.beginPath();
    c.arc(cx, cy, H * 0.25, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = "destination-out";
    c.beginPath();
    c.arc(cx + H * 0.0625, cy, H * 0.2, 0, Math.PI * 2);
    c.fill();
    x.drawImage(cres, 0, 0);
    // five-pointed star inside the crescent's opening, one point towards the hoist
    const sx = cx + H * 0.099;
    const R = H * 0.125;
    const r = R * 0.382;
    x.fillStyle = "#d21034";
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = Math.PI + (i * Math.PI) / 5;
      const rad = i % 2 ? r : R;
      x.lineTo(sx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
    }
    x.closePath();
    x.fill();
    // fabric weave
    x.globalAlpha = 0.09;
    x.fillStyle = "#000";
    for (let i = 0; i < Wd; i += 3) x.fillRect(i, 0, 1, H);
    for (let j = 0; j < H; j += 3) x.fillRect(0, j, Wd, 1);
    x.globalAlpha = 1;
  });

const weaveTex = () =>
  tex(256, 256, (x) => {
    x.fillStyle = "#808080";
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 256; i += 4) {
      for (let j = 0; j < 256; j += 4) {
        x.fillStyle = (i + j) % 8 ? "#9a9a9a" : "#666";
        x.fillRect(i, j, 2, 4);
        x.fillStyle = (i + j) % 8 ? "#666" : "#9a9a9a";
        x.fillRect(i + 2, j, 2, 4);
      }
    }
  }, [10, 7]);

const chestTex = () =>
  tex(256, 512, (x) => {
    x.fillStyle = "#c21e1a";
    x.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 8; i++) {
      x.fillStyle = "rgba(0,0,0,.35)";
      x.fillRect(0, 30 + i * 58, 256, 4);
      x.fillStyle = "#cfd2d6";
      x.fillRect(60, 46 + i * 58, 136, 8);
    }
  });

const aoTex = () =>
  tex(64, 256, (x) => {
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(0,0,0,.75)");
    g.addColorStop(0.35, "rgba(0,0,0,.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 256);
  });

const grimeTex = () =>
  tex(512, 256, (x) => {
    const g = x.createLinearGradient(0, 256, 0, 0);
    g.addColorStop(0, "rgba(20,16,12,.55)");
    g.addColorStop(0.4, "rgba(20,16,12,.12)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 60; i++) {
      x.fillStyle = `rgba(15,12,10,${Math.random() * 0.18})`;
      x.fillRect(Math.random() * 512, 150 + Math.random() * 106, 2 + Math.random() * 6, 20 + Math.random() * 90);
    }
  }, [6, 1]);

const signTex = (text: string, bg: string, fg: string) =>
  tex(256, 96, (x) => {
    x.fillStyle = bg;
    x.fillRect(0, 0, 256, 96);
    x.fillStyle = fg;
    x.font = "bold 44px Arial";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(text, 128, 50);
  });

const clockTex = () =>
  tex(256, 256, (x) => {
    x.fillStyle = "#f4f4f1";
    x.beginPath();
    x.arc(128, 128, 124, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = "#111";
    x.lineWidth = 8;
    x.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      x.lineWidth = 6;
      x.beginPath();
      x.moveTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
      x.lineTo(128 + Math.cos(a) * 114, 128 + Math.sin(a) * 114);
      x.stroke();
    }
    x.lineWidth = 8;
    x.beginPath();
    x.moveTo(128, 128);
    x.lineTo(128 + 50, 128 - 40);
    x.moveTo(128, 128);
    x.lineTo(128 - 10, 128 - 85);
    x.stroke();
    x.strokeStyle = "#e1251b";
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(128, 128);
    x.lineTo(128 + 70, 128 + 60);
    x.stroke();
  });

const roughTex = () =>
  tex(1024, 1024, (x) => {
    // roughness: mid-grey base, smoother worn tracks + a damp patch near the door
    x.fillStyle = "#8a8a8a";
    x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 60000; i++) {
      const v = 110 + Math.random() * 60;
      x.fillStyle = `rgba(${v},${v},${v},.35)`;
      x.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }
    x.fillStyle = "rgba(40,40,40,.5)";
    x.fillRect(0, 430, 1024, 160);
    const g = x.createRadialGradient(80, 512, 10, 80, 512, 260);
    g.addColorStop(0, "rgba(10,10,10,.95)");
    g.addColorStop(1, "rgba(10,10,10,0)");
    x.fillStyle = g;
    x.fillRect(0, 200, 400, 640);
  });

const woodTex = () =>
  tex(512, 128, (x) => {
    x.fillStyle = "#8a6440";
    x.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = `rgba(${60 + Math.random() * 40},${38 + Math.random() * 25},20,.35)`;
      x.lineWidth = 1 + Math.random() * 2;
      x.beginPath();
      const y = Math.random() * 128;
      x.moveTo(0, y);
      x.bezierCurveTo(170, y + (Math.random() - 0.5) * 10, 340, y + (Math.random() - 0.5) * 10, 512, y);
      x.stroke();
    }
    x.fillStyle = "rgba(0,0,0,.25)";
    for (let i = 0; i < 25; i++) x.fillRect(Math.random() * 512, Math.random() * 128, 6 + Math.random() * 20, 2);
  });

const cardboardTex = (label: string) =>
  tex(256, 256, (x) => {
    x.fillStyle = "#b08a5c";
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      x.fillStyle = `rgba(80,55,30,${Math.random() * 0.15})`;
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    x.fillStyle = "rgba(210,190,150,.8)";
    x.fillRect(0, 116, 256, 24); // packing tape
    x.fillStyle = "#f4f1ea";
    x.fillRect(30, 160, 150, 60);
    x.fillStyle = "#111";
    x.font = "bold 22px Arial";
    x.fillText(label, 40, 196);
  });

const windowTex = () =>
  tex(512, 256, (x) => {
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#dfe9f2");
    g.addColorStop(1, "#b9c8d6");
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 4000; i++) {
      x.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`;
      x.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
    }
    x.fillStyle = "#2a2c31";
    for (let i = 0; i <= 4; i++) x.fillRect(i * 126, 0, 8, 256);
    x.fillRect(0, 0, 512, 8);
    x.fillRect(0, 124, 512, 8);
    x.fillRect(0, 248, 512, 8);
  });

const blueprintTex = () =>
  tex(1024, 640, (x) => {
    x.fillStyle = "#0f2f6b";
    x.fillRect(0, 0, 1024, 640);
    x.strokeStyle = "rgba(255,255,255,.1)";
    x.lineWidth = 1;
    for (let i = 0; i < 1024; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 640); x.stroke(); }
    for (let j = 0; j < 640; j += 32) { x.beginPath(); x.moveTo(0, j); x.lineTo(1024, j); x.stroke(); }
    x.strokeStyle = "#e8f0ff";
    x.lineWidth = 3;
    // side view of a single-seater
    x.beginPath();
    x.moveTo(120, 420); x.lineTo(300, 400); x.lineTo(470, 330); x.lineTo(560, 300); x.lineTo(640, 300);
    x.lineTo(700, 250); x.lineTo(720, 330); x.lineTo(860, 350); x.lineTo(900, 420); x.closePath();
    x.stroke();
    x.strokeRect(820, 170, 120, 120); // rear wing
    for (const cx of [270, 790]) { x.beginPath(); x.arc(cx, 430, 70, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.arc(cx, 430, 40, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = "#e8f0ff";
    x.font = "bold 30px Arial";
    x.fillText("ENP-RT  #19  —  GENERAL ARRANGEMENT", 60, 80);
    x.font = "22px Arial";
    x.fillText("WHEELBASE 1680   ·   TRACK 1200 / 1150   ·   SCALE 1:10", 60, 120);
    x.fillText("DRAWN: CHASSIS & ERGONOMICS   CHECKED: CHIEF ENGINEER", 60, 600);
    x.beginPath(); x.moveTo(270, 540); x.lineTo(790, 540); x.stroke();
    x.fillText("1680", 500, 570);
  });

const posterTex = () =>
  tex(512, 720, (x) => {
    x.fillStyle = "#0b0b0c";
    x.fillRect(0, 0, 512, 720);
    x.fillStyle = "#e1251b";
    x.fillRect(0, 0, 512, 260);
    x.fillStyle = "#fff";
    x.font = '900 86px "Arial Black", Impact, sans-serif';
    x.fillText("FS UK", 40, 120);
    x.font = '900 64px "Arial Black", Impact, sans-serif';
    x.fillText("2026", 40, 200);
    x.font = "bold 30px Arial";
    x.fillText("SILVERSTONE", 40, 330);
    x.fillText("15 — 19 JULY", 40, 380);
    x.fillStyle = "#e1251b";
    x.font = '900 180px "Arial Black", Impact, sans-serif';
    x.fillText("19", 40, 620);
  });

// ---------------------------------------------------------------- build
export type Garage = {
  group: THREE.Group;
  /** advance animated details (flag cloth) */
  tick: (t: number) => void;
  /** swap the placeholder tyres for the real wheel mesh */
  setTyreMesh: (geo: THREE.BufferGeometry, mat: THREE.Material) => void;
  /** resolves when banner + framed photos have loaded (time to capture reflections) */
  ready: Promise<void>;
  setDoor: (k: number) => void;
  setLights: (k: number) => void;
  dispose: () => void;
};

export function buildGarage(low = false): Garage {
  QUALITY.k = low ? 0.35 : 1;
  if (!rectInit) {
    RectAreaLightUniformsLib.init();
    rectInit = true;
  }
  const group = new THREE.Group();
  const pending: Promise<unknown>[] = [];
  const disposables: { dispose: () => void }[] = [];
  const d = <T extends { dispose: () => void }>(o: T) => (disposables.push(o), o);
  const std = (p: THREE.MeshStandardMaterialParameters) => d(new THREE.MeshStandardMaterial(p));
  const box = (w: number, h: number, dd: number, m: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(d(new THREE.BoxGeometry(w, h, dd)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // floor (glossy epoxy)
  const fTex = d(floorTex());
  const floor = new THREE.Mesh(d(new THREE.PlaneGeometry(L, W)), std({ map: fTex, bumpMap: fTex, bumpScale: 0.35, roughnessMap: d(roughTex()), roughness: 0.75, metalness: 0.1, envMapIntensity: 1.0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.008;
  floor.receiveShadow = true;
  group.add(floor);

  // walls (inward-facing), back = +x, door wall = −x
  const wTex = d(wallTex());
  const wallMat = std({ map: wTex, bumpMap: wTex, bumpScale: 1.2, roughness: 0.92 });
  const wall = (w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Mesh(d(new THREE.PlaneGeometry(w, h)), wallMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  wall(W, H, L / 2, H / 2, 0, -Math.PI / 2); // back
  wall(L, H, 0, H / 2, -W / 2, 0); // right
  wall(L, H, 0, H / 2, W / 2, Math.PI); // left
  // door wall pieces around the opening
  const side = (W - DOOR_W) / 2;
  wall(side, H, -L / 2, H / 2, -(DOOR_W / 2 + side / 2), Math.PI / 2);
  wall(side, H, -L / 2, H / 2, DOOR_W / 2 + side / 2, Math.PI / 2);
  wall(DOOR_W, H - DOOR_H, -L / 2, DOOR_H + (H - DOOR_H) / 2, 0, Math.PI / 2);
  // outside skin so the building reads from the track too
  const skin = std({ color: 0xd9d7d1, roughness: 0.8 });
  const shell = new THREE.Mesh<THREE.BoxGeometry, THREE.Material | THREE.Material[]>(d(new THREE.BoxGeometry(L + 0.4, H + 0.3, W + 0.4)), skin);
  shell.position.set(0, H / 2, 0);
  shell.castShadow = true;
  // cut-out for the door: hide the shell's −x face by using a material array
  shell.material = [skin, std({ transparent: true, opacity: 0, depthWrite: false }), skin, skin, skin, skin];
  group.add(shell);

  // ceiling + beams + LED strips
  const ceil = new THREE.Mesh(d(new THREE.PlaneGeometry(L, W)), std({ color: 0x1d1f23, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  group.add(ceil);
  const beamMat = std({ color: 0x2c2f35, metalness: 0.6, roughness: 0.5 });
  for (let i = -3; i <= 3; i++) box(0.25, 0.4, W, beamMat, i * 2.6, H - 0.2, 0);
  const ledMat = d(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const leds: THREE.Mesh[] = [];
  for (const z of [-3.2, 0, 3.2]) {
    const led = new THREE.Mesh(d(new THREE.BoxGeometry(10, 0.06, 0.18)), ledMat);
    led.position.set(0, H - 0.45, z);
    group.add(led);
    leds.push(led);
  }
  const lights: THREE.Light[] = [];
  for (const [x, z, i, shadow] of [
    [0, 0, 60, true],
  ] as [number, number, number, boolean][]) {
    const s = new THREE.SpotLight(0xf3f6ff, low ? i * 1.8 : i, 14, Math.PI / 3.2, 0.55, 1.4);
    s.position.set(x, H - 0.5, z);
    s.target.position.set(x, 0, z);
    s.castShadow = shadow;
    if (shadow) {
      s.shadow.mapSize.set(low ? 512 : 1024, low ? 512 : 1024);
      s.shadow.bias = -0.0004;
    }
    s.userData.base = i;
    group.add(s, s.target);
    lights.push(s);
  }
  // one wide soft panel covering the three LED strips (area lights are expensive per pixel)
  for (const z of low ? [] : [0]) {
    const ra = new THREE.RectAreaLight(0xf4f7ff, 30, 10, 6.8);
    ra.position.set(0, H - 0.5, z);
    ra.rotation.x = -Math.PI / 2;
    ra.userData.base = ra.intensity;
    group.add(ra);
    lights.push(ra);
  }
  const warm = new THREE.PointLight(0xffc48a, 6, 9, 2);
  warm.position.set(7.5, 2.2, -6);
  warm.userData.base = 6;
  group.add(warm);
  lights.push(warm);
  const redGlow = new THREE.PointLight(0xff2a1a, 4, 7, 2);
  redGlow.position.set(8.4, 3.2, 0);
  redGlow.userData.base = 4;
  group.add(redGlow);
  lights.push(redGlow);

  // back wall: ENP banner + flag
  // logo painted on the wall (matte paint, alpha from the logo itself)
  const bannerMat = std({ color: 0xffffff, roughness: 0.8, transparent: true, alphaTest: 0.05, depthWrite: false });
  const banner = new THREE.Mesh(d(new THREE.PlaneGeometry(2.18, 1.85)), bannerMat);
  banner.position.set(1.97, 2.25, -W / 2 + 0.03);
  group.add(banner);
  pending.push(bannerTex().then((t) => {
    d(t);
    bannerMat.map = t;
    bannerMat.needsUpdate = true;
  }));
  // fabric flag hanging from a rod: soft vertical folds that deepen towards the bottom,
  // animated on the GPU (vertex shader) with analytic normals so the folds catch the light
  const FW = 1.8;
  const FH = 1.2;
  const flagUniforms = { uTime: { value: 0 } };
  const flagMat = std({ map: d(flagTex()), bumpMap: d(weaveTex()), bumpScale: 0.6, roughness: 0.92, side: THREE.DoubleSide });
  flagMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = flagUniforms.uTime;
    const fold = `
      float fv = clamp((${(FH / 2).toFixed(3)} - position.y) / ${FH.toFixed(3)}, 0.0, 1.0); // 0 at rod, 1 at hem
      float famp = 0.026 + 0.07 * fv;
      float fph = position.x * 7.5 + sin(uTime * 0.35 + position.x * 1.3) * 0.6;
      float fz = famp * sin(fph) + 0.012 * sin(position.x * 17.0 + uTime * 0.5) * fv;
      float dzdx = famp * 7.5 * cos(fph) + 0.2 * cos(position.x * 17.0 + uTime * 0.5) * fv;
      float dzdy = -0.05 / ${FH.toFixed(3)} * sin(fph);
    `;
    sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n" + fold + "\nobjectNormal = normalize(vec3(-dzdx, -dzdy, 1.0));")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.z += fz;\ntransformed.y -= 0.02 * fv * fv;");
  };
  const flag = new THREE.Mesh(d(new THREE.PlaneGeometry(FW, FH, 72, 28)), flagMat);
  flag.position.set(-0.37, 2.25, -W / 2 + 0.11);
  flag.castShadow = true;
  flag.userData.dynamic = true;
  group.add(flag);
  // rod + clips + soft shadow on the wall
  const rodMetal = std({ color: 0x9da1a8, metalness: 0.9, roughness: 0.25 });
  const rod = new THREE.Mesh(d(new THREE.CylinderGeometry(0.015, 0.015, FW + 0.2, 10)), rodMetal);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(-0.37, 2.25 + FH / 2 + 0.02, -W / 2 + 0.11);
  group.add(rod);
  for (const dx of [-(FW / 2 + 0.06), FW / 2 + 0.06]) {
    const bracket = new THREE.Mesh(d(new THREE.BoxGeometry(0.03, 0.03, 0.1)), rodMetal);
    bracket.position.set(-0.37 + dx, 2.25 + FH / 2 + 0.02, -W / 2 + 0.06);
    group.add(bracket);
  }
  for (let i = 0; i < 7; i++) {
    const clip = new THREE.Mesh(d(new THREE.BoxGeometry(0.02, 0.05, 0.02)), rodMetal);
    clip.position.set(-0.37 - FW / 2 + 0.05 + (i * (FW - 0.1)) / 6, 2.25 + FH / 2 - 0.005, -W / 2 + 0.115);
    group.add(clip);
  }

  // right wall (−z): pegboard + workbench + laptop
  const wood = std({ map: d(woodTex()), roughness: 0.65 });
  const steel = std({ color: 0x3a3d43, metalness: 0.7, roughness: 0.4 });
  box(5.4, 0.08, 1.0, wood, 2.5, 0.95, -W / 2 + 0.6);
  for (const x of [0.0, 5.0]) for (const z of [-W / 2 + 0.2, -W / 2 + 1.0]) box(0.07, 0.95, 0.07, steel, x, 0.475, z);
  box(5.4, 0.05, 0.9, steel, 2.5, 0.25, -W / 2 + 0.6);
  // laptop + vice + parts on the bench
  const laptopBase = box(0.42, 0.025, 0.3, std({ color: 0x1b1c20, metalness: 0.6, roughness: 0.4 }), 1.4, 1.0, -W / 2 + 0.55);
  laptopBase.rotation.y = 0.2;
  const screenMat = std({ color: 0x111, emissive: 0x4a7dff, emissiveIntensity: 0.9 });
  const screen = box(0.42, 0.28, 0.015, screenMat, 1.36, 1.15, -W / 2 + 0.38);
  screen.rotation.set(-0.25, 0.2, 0);
  box(0.25, 0.18, 0.2, steel, 3.8, 1.08, -W / 2 + 0.45);
  box(0.5, 0.1, 0.3, std({ color: 0xb8bcc3, metalness: 0.9, roughness: 0.25 }), 2.6, 1.04, -W / 2 + 0.7);

  // left wall (+z): whiteboard, red tool chest, shelving with boxes
  const wb = new THREE.Mesh(d(new THREE.PlaneGeometry(4, 2.5)), std({ map: d(whiteboardTex()), roughness: 0.25 }));
  wb.position.set(-2.5, 2.4, W / 2 - 0.03);
  wb.rotation.y = Math.PI;
  group.add(wb);
  const chestMats = [
    std({ color: 0xa8150e, roughness: 0.4, metalness: 0.3 }),
    std({ color: 0xa8150e, roughness: 0.4, metalness: 0.3 }),
    std({ color: 0x777, metalness: 0.8, roughness: 0.3 }),
    std({ color: 0x222 }),
    std({ color: 0xa8150e, roughness: 0.4, metalness: 0.3 }),
    std({ map: d(chestTex()), roughness: 0.35, metalness: 0.3 }),
  ];
  box(1.6, 1.2, 0.6, chestMats, 2.4, 0.6, W / 2 - 0.4).rotation.y = Math.PI;
  const shelfX = 6.4;
  for (let s = 0; s < 4; s++) box(2.4, 0.04, 0.6, steel, shelfX, 0.3 + s * 0.65, W / 2 - 0.35);
  for (const x of [shelfX - 1.18, shelfX + 1.18]) box(0.05, 2.4, 0.6, steel, x, 1.2, W / 2 - 0.35);
  const boxCols = [0x2a5bd7, 0xe1251b, 0x2b2c31, 0xf2c230, 0x1fb25a];
  for (let s = 0; s < 4; s++)
    for (let b = 0; b < 3; b++)
      if (Math.random() > 0.2)
        box(0.55, 0.38, 0.45, (s + b) % 3 === 0 ? std({ color: boxCols[(s + b) % boxCols.length], roughness: 0.7 }) : std({ map: d(cardboardTex(["BOLTS M8", "BEARINGS", "BRAKE PADS", "CABLES", "SPARES"][(s * 3 + b) % 5])), roughness: 0.9 }), shelfX - 0.75 + b * 0.75, 0.52 + s * 0.65, W / 2 - 0.4);

  // tyre stacks + cones
  const tyreGeo = d(new THREE.TorusGeometry(0.22, 0.11, 12, 28));
  const tyres: THREE.Mesh[] = [];
  const tyreMat = std({ color: 0x141416, roughness: 0.75 });
  for (const [x, z, n] of [[-6.6, -5.6, 4], [-5.9, -6.4, 3], [6.8, -5.0, 4]] as [number, number, number][]) {
    for (let i = 0; i < n; i++) {
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      t.rotation.x = Math.PI / 2;
      t.position.set(x + (Math.random() - 0.5) * 0.05, 0.11 + i * 0.22, z);
      t.userData.stack = i;
      tyres.push(t);
      t.userData.dynamic = true;
      t.castShadow = t.receiveShadow = true;
      group.add(t);
    }
  }
  const coneGeo = d(new THREE.ConeGeometry(0.16, 0.5, 18));
  const coneMat = std({ color: 0xff6a12, roughness: 0.6 });
  for (const [x, z] of [[-7.4, 2.4], [-7.0, 3.1], [-7.6, 3.6]]) {
    const c = new THREE.Mesh(coneGeo, coneMat);
    c.position.set(x, 0.25, z);
    c.castShadow = true;
    group.add(c);
  }
  // fire extinguisher by the door
  box(0.18, 0.5, 0.18, std({ color: 0xd21a12, roughness: 0.35, metalness: 0.2 }), -L / 2 + 0.3, 0.45, -DOOR_W / 2 - 0.6);

  // ---- realism pass
  // ambient occlusion where the walls meet the floor + grime on the lower walls
  const ao = d(aoTex());
  const aoMat = d(new THREE.MeshBasicMaterial({ map: ao, transparent: true, depthWrite: false, toneMapped: false }));
  const aoStrip = (len: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(d(new THREE.PlaneGeometry(len, 1.1)), aoMat);
    m.rotation.set(-Math.PI / 2, 0, ry);
    m.position.set(x, 0.012, z);
    group.add(m);
  };
  aoStrip(L, 0, -W / 2 + 0.55, 0);
  aoStrip(L, 0, W / 2 - 0.55, Math.PI);
  aoStrip(W, L / 2 - 0.55, 0, Math.PI / 2);
  const grime = d(grimeTex());
  const grimeMat = d(new THREE.MeshBasicMaterial({ map: grime, transparent: true, depthWrite: false }));
  const grimeWall = (len: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(d(new THREE.PlaneGeometry(len, 1.4)), grimeMat);
    m.position.set(x, 0.7, z);
    m.rotation.y = ry;
    group.add(m);
  };
  grimeWall(L, 0, -W / 2 + 0.03, 0);
  grimeWall(L, 0, W / 2 - 0.03, Math.PI);
  grimeWall(W, L / 2 - 0.03, 0, -Math.PI / 2);

  // electrical conduits + sockets along the walls
  const conduit = std({ color: 0x9a9da3, metalness: 0.6, roughness: 0.4 });
  box(L - 0.4, 0.05, 0.05, conduit, 0, 1.18, -W / 2 + 0.05);
  box(L - 0.4, 0.05, 0.05, conduit, 0, 1.45, W / 2 - 0.05);
  for (const x of [-6, -2.4, 6]) box(0.14, 0.14, 0.05, std({ color: 0xe8e6e0 }), x, 1.18, -W / 2 + 0.06);

  // spare chassis frame on a welding jig (tube frame)
  const tubeMat = std({ color: 0x2a2c31, metalness: 0.8, roughness: 0.35 });
  const tubeGeo = d(new THREE.CylinderGeometry(0.018, 0.018, 1, 8));
  const tube = (a: number[], b: number[]) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const m = new THREE.Mesh(tubeGeo, tubeMat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.scale.y = va.distanceTo(vb);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    m.castShadow = true;
    frame.add(m);
  };
  const frame = new THREE.Group();
  const pts: Record<string, number[]> = {
    fl: [-1.2, 0.15, 0.25], fr: [-1.2, 0.15, -0.25], flt: [-1.2, 0.55, 0.22], frt: [-1.2, 0.55, -0.22],
    ml: [-0.2, 0.12, 0.33], mr: [-0.2, 0.12, -0.33], mlt: [-0.2, 0.5, 0.36], mrt: [-0.2, 0.5, -0.36],
    hl: [0.1, 0.12, 0.33], hr: [0.1, 0.12, -0.33], hoopTop: [0.12, 1.05, 0], hoopL: [0.12, 0.95, 0.25], hoopR: [0.12, 0.95, -0.25],
    rl: [0.9, 0.18, 0.25], rr: [0.9, 0.18, -0.25], rlt: [0.9, 0.5, 0.22], rrt: [0.9, 0.5, -0.22],
    fhT: [-0.6, 0.85, 0], fhL: [-0.6, 0.6, 0.3], fhR: [-0.6, 0.6, -0.3],
  };
  const P = (k: string) => pts[k];
  [["fl", "fr"], ["flt", "frt"], ["fl", "flt"], ["fr", "frt"], ["fl", "ml"], ["fr", "mr"], ["flt", "fhL"], ["frt", "fhR"],
   ["fhL", "fhT"], ["fhR", "fhT"], ["fhL", "mlt"], ["fhR", "mrt"], ["ml", "mlt"], ["mr", "mrt"], ["ml", "hl"], ["mr", "hr"],
   ["hl", "hoopL"], ["hr", "hoopR"], ["hoopL", "hoopTop"], ["hoopR", "hoopTop"], ["mlt", "hoopL"], ["mrt", "hoopR"],
   ["hl", "rl"], ["hr", "rr"], ["rl", "rr"], ["rlt", "rrt"], ["rl", "rlt"], ["rr", "rrt"], ["hoopTop", "rlt"], ["hoopTop", "rrt"],
   ["ml", "mr"], ["fl", "mr"], ["hl", "rr"], ["mlt", "fhT"], ["mrt", "fhT"]].forEach(([a, b]) => tube(P(a), P(b)));
  // jig table under it
  const jig = new THREE.Mesh(d(new THREE.BoxGeometry(2.6, 0.06, 1.0)), std({ color: 0x5b6068, metalness: 0.8, roughness: 0.35 }));
  jig.position.set(0, -0.03, 0);
  jig.receiveShadow = jig.castShadow = true;
  frame.add(jig);
  for (const x of [-1.1, 1.1]) for (const z of [-0.4, 0.4]) {
    const leg = new THREE.Mesh(d(new THREE.BoxGeometry(0.06, 0.55, 0.06)), steel);
    leg.position.set(x, -0.3, z);
    frame.add(leg);
  }
  frame.position.set(5.4, 0.6, 4.3);
  frame.rotation.y = 0.35;
  group.add(frame);

  // welding cart + gas bottle, compressor, tool trolley
  box(0.6, 0.7, 0.45, std({ color: 0x1f5fd1, roughness: 0.5, metalness: 0.3 }), 7.6, 0.35, 2.2);
  const bottle = new THREE.Mesh(d(new THREE.CylinderGeometry(0.11, 0.11, 1.2, 18)), std({ color: 0x1b6b3a, roughness: 0.4, metalness: 0.4 }));
  bottle.position.set(7.95, 0.6, 2.55);
  bottle.castShadow = true;
  group.add(bottle);
  const comp = new THREE.Mesh(d(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 20)), std({ color: 0xd8261c, roughness: 0.35, metalness: 0.4 }));
  comp.rotation.z = Math.PI / 2;
  comp.position.set(-7.6, 0.4, -3.2);
  comp.castShadow = true;
  group.add(comp);
  box(0.7, 0.85, 0.45, chestMats, -1.6, 0.43, W / 2 - 1.1).rotation.y = Math.PI + 0.25;

  // wheel rack + spare rear wing on the back wall
  for (let i = 0; i < 4; i++) {
    const wheel = new THREE.Mesh(tyreGeo, tyreMat);
    wheel.scale.setScalar(1.05);
    wheel.position.set(L / 2 - 0.35, 0.5 + i * 0.55, 5.4);
    tyres.push(wheel);
    wheel.userData.dynamic = true;
    wheel.rotation.y = Math.PI / 2;
    wheel.castShadow = true;
    group.add(wheel);
  }
  box(0.08, 2.5, 0.6, steel, L / 2 - 0.5, 1.25, 5.4);
  const wing = box(0.05, 0.5, 2.4, std({ color: 0x15161a, metalness: 0.5, roughness: 0.35 }), L / 2 - 0.15, 4.0, 3.8);
  wing.rotation.x = 0.12;
  box(0.4, 0.6, 0.03, std({ color: 0x15161a, metalness: 0.5, roughness: 0.35 }), L / 2 - 0.25, 4.0, 2.58);
  box(0.4, 0.6, 0.03, std({ color: 0x15161a, metalness: 0.5, roughness: 0.35 }), L / 2 - 0.25, 4.0, 5.02);

  // framed team photos on the left wall
  const loader = new THREE.TextureLoader();
  const photo = (src: string, w: number, h: number, x: number, y: number) => {
    const m = std({ color: 0xffffff, roughness: 0.4 });
    const pic = new THREE.Mesh(d(new THREE.PlaneGeometry(w, h)), m);
    pic.position.set(x, y, W / 2 - 0.06);
    pic.rotation.y = Math.PI;
    group.add(pic);
    box(w + 0.12, h + 0.12, 0.04, std({ color: 0x111214, roughness: 0.5 }), x, y, W / 2 - 0.04);
    pending.push(
      new Promise<void>((res) =>
        loader.load(
          src,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            d(t);
            m.map = t;
            m.needsUpdate = true;
            res();
          },
          undefined,
          () => res(),
        ),
      ),
    );
  };
  photo("/gallery/pitlane-car.jpg", 1.7, 0.75, 1.6, 3.5);
  photo("/gallery/grid-team.jpg", 1.25, 0.77, 3.6, 3.5);
  photo("/about/peace.jpg", 0.9, 0.69, 5.2, 3.5);

  // exit sign + clock
  const exit = new THREE.Mesh(d(new THREE.PlaneGeometry(0.7, 0.26)), d(new THREE.MeshBasicMaterial({ map: d(signTex("EXIT", "#0f8a3a", "#ffffff")), toneMapped: false })));
  exit.position.set(-L / 2 + 0.06, DOOR_H + 0.75, -DOOR_W / 2 - 0.9);
  exit.rotation.y = Math.PI / 2;
  group.add(exit);
  const clock = new THREE.Mesh(d(new THREE.CircleGeometry(0.32, 32)), std({ map: d(clockTex()), roughness: 0.3 }));
  clock.position.set(L / 2 - 0.04, 3.95, 0.7);
  clock.rotation.y = -Math.PI / 2;
  group.add(clock);

  // ---- realism pass 2
  // contact shadows under props
  const blob = d(
    tex(128, 128, (x) => {
      const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, "rgba(0,0,0,.7)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, 128, 128);
    }),
  );
  const blobMat = d(new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
  const shadow = (x: number, z: number, sx: number, sz: number) => {
    const m = new THREE.Mesh(d(new THREE.PlaneGeometry(sx, sz)), blobMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.013, z);
    group.add(m);
  };
  shadow(2.5, -W / 2 + 0.6, 6.2, 1.6); // bench
  shadow(2.4, W / 2 - 0.4, 2.2, 1.1); // chest
  shadow(shelfX, W / 2 - 0.35, 3.0, 1.1); // shelving
  shadow(5.4, 4.3, 3.2, 1.8); // chassis jig
  shadow(-6.3, -6.0, 1.6, 1.6); // tyre stacks
  shadow(6.8, -5.0, 1.0, 1.0);
  shadow(-7.6, -3.2, 1.4, 0.9); // compressor
  shadow(7.7, 2.4, 1.2, 1.0); // welder

  // frosted windows high on the back and right walls (daylight)
  const winMat = d(new THREE.MeshBasicMaterial({ map: d(windowTex()), toneMapped: false }));
  winMat.color.setScalar(0.85);
  for (const z of [-4.2, 4.2]) {
    const w = new THREE.Mesh(d(new THREE.PlaneGeometry(2.6, 0.9)), winMat);
    w.position.set(L / 2 - 0.02, H - 0.75, z);
    w.rotation.y = -Math.PI / 2;
    group.add(w);
  }
  const sky = new THREE.PointLight(0xcfe0ff, 5, 12, 2);
  sky.position.set(L / 2 - 1, H - 0.9, 0);
  sky.userData.base = 5;
  group.add(sky);
  lights.push(sky);

  // cable trays + hanging power drops from the ceiling
  for (const z of [-5.6, 5.6]) box(L - 1, 0.06, 0.3, steel, 0, H - 0.6, z);
  const cordMat = std({ color: 0x111111, roughness: 0.6 });
  for (const [x, z] of [[-2, -5.6], [3, 5.6], [6, -5.6]] as [number, number][]) {
    const cord = new THREE.Mesh(d(new THREE.CylinderGeometry(0.012, 0.012, 2.2, 6)), cordMat);
    cord.position.set(x, H - 1.7, z);
    group.add(cord);
    box(0.16, 0.12, 0.1, std({ color: 0xf2c230, roughness: 0.5 }), x, H - 2.85, z);
  }

  // blueprint + FS UK poster on the walls
  const bp = new THREE.Mesh(d(new THREE.PlaneGeometry(2.2, 1.375)), std({ map: d(blueprintTex()), roughness: 0.6 }));
  bp.position.set(L / 2 - 0.03, 2.6, -1.6);
  bp.rotation.y = -Math.PI / 2;
  group.add(bp);
  const poster = new THREE.Mesh(d(new THREE.PlaneGeometry(0.9, 1.27)), std({ map: d(posterTex()), roughness: 0.55 }));
  poster.position.set(L / 2 - 0.03, 2.3, 2.9);
  poster.rotation.y = -Math.PI / 2;
  group.add(poster);

  // roller door
  const door = new THREE.Mesh(d(new THREE.PlaneGeometry(DOOR_W, DOOR_H)), std({ map: d(doorTex()), roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }));
  door.rotation.y = Math.PI / 2;
  door.position.set(-L / 2 + 0.05, DOOR_H / 2, 0);
  door.castShadow = true;
  door.userData.dynamic = true;
  group.add(door);
  const drum = box(0.5, 0.5, DOOR_W + 0.4, steel, -L / 2 + 0.35, DOOR_H + 0.3, 0);
  drum.castShadow = false;

  // merge every static mesh that shares a material into one draw call
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.dynamic || Array.isArray(m.material) || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const list = buckets.get(m.material as THREE.Material) ?? [];
    list.push(m);
    buckets.set(m.material as THREE.Material, list);
  });
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      const g = (m.geometry.index ? m.geometry : m.geometry).clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      for (const key of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(key)) g.deleteAttribute(key);
      return g.index ? g : g;
    });
    const allIndexed = geos.every((g) => g.index);
    const merged = mergeGeometries(allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mm = new THREE.Mesh(d(merged), mat);
    mm.castShadow = !low && meshes.some((m) => m.castShadow);
    mm.receiveShadow = meshes.some((m) => m.receiveShadow);
    meshes.forEach((m) => m.parent?.remove(m));
    group.add(mm);
  }
  if (low) group.traverse((o) => ((o as THREE.Mesh).isMesh && o !== door ? (o.castShadow = false) : null));

  const setDoor = (k: number) => {
    // roll up into the drum: shrink + lift
    const vis = Math.max(0.001, 1 - k);
    door.scale.y = vis;
    door.position.y = DOOR_H - (DOOR_H * vis) / 2;
    door.visible = k < 0.995;
  };
  const setLights = (k: number) => {
    lights.forEach((l) => (l.intensity = (l.userData.base as number) * k));
    ledMat.color.setScalar(0.3 + 0.7 * k);
  };

  const setTyreMesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    tyres.forEach((t) => {
      t.geometry = geo;
      t.material = mat;
      t.scale.setScalar(1);
      if (typeof t.userData.stack === "number") t.position.y = 0.118 + t.userData.stack * 0.236;
    });
  };
  return { group, tick: (t: number) => (flagUniforms.uTime.value = t), setTyreMesh, ready: Promise.all(pending).then(() => undefined), setDoor, setLights, dispose: () => disposables.forEach((x) => x.dispose()) };
}
