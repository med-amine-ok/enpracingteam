import * as THREE from "three";

/** texture-noise density (lowered on light devices) */
const QUALITY = { k: 1 };
import { Sky } from "three/examples/jsm/objects/Sky.js";

/*
 * A daylight race circuit built procedurally around a closed centre-line:
 * asphalt with racing line, corner kerbs, gravel traps, striped grass, advertising
 * barriers + catch fence, grandstand, pit garages, start gantry, trees and a sky.
 * The centre-line passes through the origin heading −X (the car's forward), so the
 * studio turntable sits on the start straight.
 */

const TRACK_W = 12;
const BARRIER = 24;
const SAMPLES_PER_M = 0.5;

function tex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noise(x: CanvasRenderingContext2D, w: number, h: number, n: number, rgb: (r: number) => string, size = 2) {
  for (let i = 0, N = Math.round(n * QUALITY.k); i < N; i++) {
    x.fillStyle = rgb(Math.random());
    x.fillRect(Math.random() * w, Math.random() * h, size * Math.random() + 0.6, size * Math.random() + 0.6);
  }
}

// ---------------------------------------------------------------- textures
const asphaltTex = () =>
  tex(1024, 1024, (x) => {
    x.fillStyle = "#2b2c2f";
    x.fillRect(0, 0, 1024, 1024);
    noise(x, 1024, 1024, 90000, (r) => `rgba(${r < 0.5 ? 20 : 120},${r < 0.5 ? 20 : 121},${r < 0.5 ? 22 : 125},${0.18 + r * 0.25})`, 2.4);
    // rubbered racing line (v = across, here canvas y)
    const g = x.createLinearGradient(0, 300, 0, 760);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, "rgba(10,10,12,.42)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 300, 1024, 460);
    // tyre marks
    x.strokeStyle = "rgba(8,8,10,.25)";
    for (let i = 0; i < 14; i++) {
      x.lineWidth = 3 + Math.random() * 6;
      const y = 380 + Math.random() * 280;
      x.beginPath();
      x.moveTo(0, y);
      x.bezierCurveTo(300, y + (Math.random() - 0.5) * 60, 700, y + (Math.random() - 0.5) * 60, 1024, y);
      x.stroke();
    }
    // white edge lines
    x.fillStyle = "rgba(240,240,236,.95)";
    x.fillRect(0, 18, 1024, 18);
    x.fillRect(0, 988, 1024, 18);
  });

const kerbTex = () =>
  tex(512, 64, (x) => {
    for (let i = 0; i < 4; i++) {
      x.fillStyle = i % 2 ? "#f1f0ea" : "#d6261c";
      x.fillRect(i * 128, 0, 128, 64);
    }
    noise(x, 512, 64, 3000, (r) => `rgba(0,0,0,${r * 0.12})`);
  });

const grassTex = () =>
  tex(512, 512, (x) => {
    // two mowing stripes per tile
    x.fillStyle = "#3f6b2a";
    x.fillRect(0, 0, 512, 256);
    x.fillStyle = "#4a7a31";
    x.fillRect(0, 256, 512, 256);
    noise(x, 512, 512, 60000, (r) => `rgba(${30 + r * 60},${70 + r * 70},${20 + r * 30},.35)`, 2);
  });

const gravelTex = () =>
  tex(512, 512, (x) => {
    x.fillStyle = "#b9a684";
    x.fillRect(0, 0, 512, 512);
    noise(x, 512, 512, 70000, (r) => `rgba(${120 + r * 110},${100 + r * 100},${70 + r * 80},.6)`, 2.5);
  });

const boardTex = () =>
  tex(4096, 128, (x) => {
    const boards = [
      { bg: "#e1251b", fg: "#ffffff", t: "ENP RACING TEAM" },
      { bg: "#0b0b0c", fg: "#ffffff", t: "FORMULA STUDENT" },
      { bg: "#f2efe6", fg: "#0b0b0c", t: "#19 · ALGERIA" },
      { bg: "#1b3d8f", fg: "#ffffff", t: "ENGINEERING · TEAMWORK" },
      { bg: "#0b0b0c", fg: "#e1251b", t: "ENP RACING TEAM" },
      { bg: "#1fb25a", fg: "#ffffff", t: "MADE IN ALGERIA" },
      { bg: "#f2efe6", fg: "#e1251b", t: "FS UK 2026" },
      { bg: "#e1251b", fg: "#0b0b0c", t: "BEST NEWCOMER" },
    ];
    const w = 4096 / boards.length;
    boards.forEach((b, i) => {
      x.fillStyle = b.bg;
      x.fillRect(i * w, 0, w, 128);
      x.fillStyle = b.fg;
      x.font = '900 78px "Arial Black", Impact, sans-serif';
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText(b.t, i * w + w / 2, 68, w - 30);
      x.fillStyle = "rgba(0,0,0,.25)";
      x.fillRect(i * w + w - 4, 0, 4, 128);
    });
  });

const fenceTex = () => {
  const t = tex(64, 64, (x) => {
    x.clearRect(0, 0, 64, 64);
    x.strokeStyle = "rgba(200,205,210,.9)";
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(64, 64);
    x.moveTo(64, 0);
    x.lineTo(0, 64);
    x.stroke();
  });
  return t;
};

const crowdTex = () =>
  tex(1024, 256, (x) => {
    x.fillStyle = "#2a2c33";
    x.fillRect(0, 0, 1024, 256);
    const cols = ["#e1251b", "#f2efe6", "#1fb25a", "#2b5fd9", "#f2c230", "#111", "#c9c4b8", "#7a2a8a"];
    for (let row = 0; row < 16; row++) {
      for (let i = 0; i < 128; i++) {
        if (Math.random() < 0.18) continue;
        x.fillStyle = cols[(Math.random() * cols.length) | 0];
        x.fillRect(i * 8 + Math.random() * 2, row * 16 + 4, 5, 8);
        x.fillStyle = "#d8b49a";
        x.fillRect(i * 8 + 1 + Math.random() * 2, row * 16, 3, 4);
      }
    }
  });

const garageTex = () =>
  tex(2048, 256, (x) => {
    x.fillStyle = "#e9e7e2";
    x.fillRect(0, 0, 2048, 256);
    for (let i = 0; i < 16; i++) {
      const gx = i * 128 + 14;
      x.fillStyle = i % 5 === 2 ? "#e1251b" : "#2a2c31";
      x.fillRect(gx, 70, 100, 186);
      x.fillStyle = "rgba(255,255,255,.12)";
      for (let s = 0; s < 9; s++) x.fillRect(gx, 76 + s * 20, 100, 2);
      x.fillStyle = "#0b0b0c";
      x.font = "bold 34px Arial";
      x.textAlign = "center";
      x.fillText(String(i + 1), gx + 50, 52);
    }
    x.fillStyle = "#1b3d8f";
    x.fillRect(0, 0, 2048, 14);
  });

// ---------------------------------------------------------------- geometry helpers
type Frame = { p: THREE.Vector3; t: THREE.Vector3; n: THREE.Vector3; k: number; s: number };

/** Ribbon between lateral offsets a..b (metres, + = left of travel) along the frames. */
function ribbon(frames: Frame[], a: number, b: number, y: number, uScale: number, vScale = 1, mask?: (f: Frame, i: number) => boolean) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let vi = 0;
  let prevOk = false;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const ok = mask ? mask(f, i) : true;
    const pa = f.p.clone().addScaledVector(f.n, a);
    const pb = f.p.clone().addScaledVector(f.n, b);
    pos.push(pa.x, y, pa.z, pb.x, y, pb.z);
    uv.push(f.s / uScale, 0, f.s / uScale, vScale);
    if (i > 0 && ok && prevOk) idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
    prevOk = ok;
    vi += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical wall following the frames at lateral offset `o`. */
function wall(frames: Frame[], o: number, y0: number, y1: number, uScale: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  frames.forEach((f, i) => {
    const p = f.p.clone().addScaledVector(f.n, o);
    pos.push(p.x, y0, p.z, p.x, y1, p.z);
    uv.push(f.s / uScale, 0, f.s / uScale, 1);
    if (i > 0) {
      const v = i * 2;
      idx.push(v - 2, v, v - 1, v - 1, v, v + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the circuit
export type Circuit = {
  group: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  length: number;
  sky: Sky;
  sun: THREE.Vector3;
  /** curvature (1/m, signed: + = left turn) at arc-length fraction u */
  curvatureAt: (u: number) => number;
  setOpacity: (k: number) => void;
  dispose: () => void;
};

export function buildCircuit(low = false): Circuit {
  QUALITY.k = low ? 0.35 : 1;
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => (disposables.push(o), o);

  // Silverstone-flavoured layout (metres, x/z). Starts at origin heading −X.
  const P: [number, number][] = [
    [0, 0], [-110, 0], [-230, 2], [-320, -12], [-372, -60], [-384, -138], [-350, -200],
    [-280, -226], [-222, -206], [-176, -224], [-110, -262], [-20, -276], [80, -262],
    [160, -224], [214, -166], [228, -96], [200, -42], [140, -10], [70, 0],
  ];
  const curve = new THREE.CatmullRomCurve3(P.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "centripetal");
  const length = curve.getLength();
  const N = Math.round(length * SAMPLES_PER_M);
  const frames: Frame[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= N; i++) {
    const u = (i % N) / N;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    const n = new THREE.Vector3().crossVectors(up, t).normalize(); // left of travel
    frames.push({ p, t, n, k: 0, s: (i / N) * length });
  }
  // signed curvature
  for (let i = 0; i <= N; i++) {
    const a = frames[(i - 3 + N) % N];
    const b = frames[(i + 3) % N];
    const ang = Math.atan2(a.t.x * b.t.z - a.t.z * b.t.x, a.t.dot(b.t));
    frames[i].k = -ang / ((6 / N) * length);
  }
  const curvatureAt = (u: number) => frames[Math.round((((u % 1) + 1) % 1) * N)].k;
  // smooth corner masks
  const corner = frames.map((f) => Math.abs(f.k) > 1 / 140);
  const near = (i: number, r: number) => {
    for (let d = -r; d <= r; d++) if (corner[(i + d + N) % N]) return true;
    return false;
  };

  const materials: THREE.Material[] = [];
  const mat = <M extends THREE.Material>(m: M) => (materials.push(m), track(m));

  // ground
  const grass = track(grassTex());
  grass.repeat.set(160, 160);
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(3200, 3200)),
    mat(new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, transparent: true })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-80, -0.02, -130);
  ground.receiveShadow = true;
  group.add(ground);

  // asphalt
  const asphalt = track(asphaltTex());
  const asphaltMat = mat(new THREE.MeshStandardMaterial({ map: asphalt, color: 0xb3ada4, roughness: 0.92, metalness: 0.0, bumpMap: asphalt, bumpScale: 0.8, envMapIntensity: 0.35, transparent: true }));
  const road = new THREE.Mesh(track(ribbon(frames, TRACK_W / 2, -TRACK_W / 2, 0.0, 14)), asphaltMat);
  road.receiveShadow = true;
  group.add(road);

  // run-off tarmac shoulders (thin, lighter)
  const shoulderMat = mat(new THREE.MeshStandardMaterial({ color: 0x4c4d50, roughness: 0.95, transparent: true }));
  group.add(new THREE.Mesh(track(ribbon(frames, TRACK_W / 2 + 3, TRACK_W / 2, -0.005, 10)), shoulderMat));
  group.add(new THREE.Mesh(track(ribbon(frames, -TRACK_W / 2, -TRACK_W / 2 - 3, -0.005, 10)), shoulderMat));

  // kerbs on corners (both edges)
  const kerb = track(kerbTex());
  const kerbMat = mat(new THREE.MeshStandardMaterial({ map: kerb, roughness: 0.6, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
  const km = (_f: Frame, i: number) => near(i, 6);
  group.add(new THREE.Mesh(track(ribbon(frames, TRACK_W / 2 + 1.4, TRACK_W / 2 - 0.2, 0.02, 4, 1, km)), kerbMat));
  group.add(new THREE.Mesh(track(ribbon(frames, -TRACK_W / 2 + 0.2, -TRACK_W / 2 - 1.4, 0.02, 4, 1, km)), kerbMat));

  // gravel traps on the outside of corners
  const gravel = track(gravelTex());
  const gravelMat = mat(new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, transparent: true, polygonOffset: true, polygonOffsetFactor: -1 }));
  group.add(new THREE.Mesh(track(ribbon(frames, TRACK_W / 2 + 3, BARRIER - 1, -0.01, 8, 2, (f, i) => near(i, 10) && frames[i].k < 0)), gravelMat));
  group.add(new THREE.Mesh(track(ribbon(frames, -TRACK_W / 2 - 3, -BARRIER + 1, -0.01, 8, 2, (f, i) => near(i, 10) && frames[i].k > 0)), gravelMat));

  // advertising barriers + catch fence
  const boards = track(boardTex());
  const boardMat = mat(new THREE.MeshStandardMaterial({ map: boards, roughness: 0.55, side: THREE.DoubleSide, transparent: true }));
  const fence = track(fenceTex());
  fence.repeat.set(1, 18);
  const fenceMat = mat(new THREE.MeshStandardMaterial({ map: fence, alphaTest: 0.4, transparent: true, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6 }));
  for (const side of [1, -1]) {
    group.add(new THREE.Mesh(track(wall(frames, side * BARRIER, 0, 1.1, side > 0 ? 64 : -64)), boardMat));
    group.add(new THREE.Mesh(track(wall(frames, side * (BARRIER + 0.3), 1.1, 4.2, 2.2)), fenceMat));
  }
  // fence posts
  const postGeo = track(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6));
  const postMat = mat(new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.4, transparent: true }));
  const step = 8;
  const postCount = Math.floor(length / step) * 2;
  const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
  const m4 = new THREE.Matrix4();
  let pi = 0;
  for (let s = 0; s < length - step && pi < postCount; s += step) {
    const f = frames[Math.round((s / length) * N)];
    for (const side of [1, -1]) {
      const p = f.p.clone().addScaledVector(f.n, side * (BARRIER + 0.3));
      m4.makeTranslation(p.x, 2.1, p.z);
      posts.setMatrixAt(pi++, m4);
    }
  }
  posts.count = pi;
  group.add(posts);

  // start / finish line (checkered) just ahead of the grid
  const checker = track(
    tex(256, 64, (x) => {
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 4; j++) {
          x.fillStyle = (i + j) % 2 ? "#111" : "#f4f4f0";
          x.fillRect(i * 16, j * 16, 16, 16);
        }
    }, false),
  );
  const startLine = new THREE.Mesh(track(new THREE.PlaneGeometry(TRACK_W, 1.6)), mat(new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, transparent: true, polygonOffset: true, polygonOffsetFactor: -3 })));
  startLine.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  startLine.position.set(-14, 0.01, 0);
  group.add(startLine);
  // grid slot markings
  const slotMat = mat(new THREE.MeshBasicMaterial({ color: 0xf2f0ea, transparent: true, polygonOffset: true, polygonOffsetFactor: -3 }));
  for (let g = 0; g < 6; g++) {
    const gx = 10 + g * 9;
    const gz = g % 2 ? -2.6 : 2.6;
    const bar = new THREE.Mesh(track(new THREE.PlaneGeometry(0.25, 3)), slotMat);
    bar.rotation.x = -Math.PI / 2;
    bar.position.set(gx, 0.012, gz);
    group.add(bar);
  }

  // start gantry with lights
  const gantryMat = mat(new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.6, roughness: 0.35, transparent: true }));
  const gantry = new THREE.Group();
  for (const z of [-(TRACK_W / 2 + 2), TRACK_W / 2 + 2]) {
    const leg = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 7, 0.5)), gantryMat);
    leg.position.set(0, 3.5, z);
    gantry.add(leg);
  }
  const beam = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 1.4, TRACK_W + 4.5)), gantryMat);
  beam.position.set(0, 6.6, 0);
  gantry.add(beam);
  const lightMat = mat(new THREE.MeshBasicMaterial({ color: 0x2a0b0a, transparent: true }));
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(track(new THREE.CircleGeometry(0.22, 16)), lightMat);
    l.position.set(0.56, 6.6, -2 + i);
    l.rotation.y = Math.PI / 2;
    gantry.add(l);
  }
  const gBoard = new THREE.Mesh(track(new THREE.PlaneGeometry(TRACK_W + 4, 1.1)), mat(new THREE.MeshStandardMaterial({ map: boards, transparent: true, side: THREE.DoubleSide })));
  gBoard.position.set(0.57, 7.8, 0);
  gBoard.rotation.y = Math.PI / 2;
  gantry.add(gBoard);
  gantry.position.set(-14, 0, 0);
  gantry.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  group.add(gantry);

  // pit building with garages (right side of the straight, −z)
  const garage = track(garageTex());
  const pitMat = mat(new THREE.MeshStandardMaterial({ map: garage, roughness: 0.7, transparent: true }));
  const pitBox = new THREE.Mesh(track(new THREE.BoxGeometry(260, 9, 16)), [
    mat(new THREE.MeshStandardMaterial({ color: 0xdedcd6, transparent: true })),
    mat(new THREE.MeshStandardMaterial({ color: 0xdedcd6, transparent: true })),
    mat(new THREE.MeshStandardMaterial({ color: 0x9a9da3, transparent: true })),
    mat(new THREE.MeshStandardMaterial({ color: 0x2a2c31, transparent: true })),
    pitMat,
    mat(new THREE.MeshStandardMaterial({ color: 0xdedcd6, transparent: true })),
  ]);
  pitBox.position.set(-120, 4.5, BARRIER + 16);
  pitBox.castShadow = pitBox.receiveShadow = true;
  // the +z face (index 4) faces the track when rotated 180°
  pitBox.rotation.y = Math.PI;
  group.add(pitBox);
  const pitRoof = new THREE.Mesh(track(new THREE.BoxGeometry(270, 0.5, 24)), mat(new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.5, transparent: true })));
  pitRoof.position.set(-120, 9.4, BARRIER + 13);
  pitRoof.castShadow = true;
  group.add(pitRoof);
  // pit lane tarmac
  const pitLane = new THREE.Mesh(track(new THREE.PlaneGeometry(300, 14)), shoulderMat);
  pitLane.rotation.x = -Math.PI / 2;
  pitLane.position.set(-120, -0.008, BARRIER + 3);
  group.add(pitLane);

  // grandstand (left side of the straight, −z ... here z < 0 is right; stands on the −z side)
  const crowd = track(crowdTex());
  crowd.repeat.set(6, 1);
  const standGroup = new THREE.Group();
  const seatMat = mat(new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9, transparent: true }));
  const concrete = mat(new THREE.MeshStandardMaterial({ color: 0xb8b6b0, roughness: 0.9, transparent: true }));
  for (let r = 0; r < 12; r++) {
    const step = new THREE.Mesh(track(new THREE.BoxGeometry(200, 0.6, 1.2)), [concrete, concrete, seatMat, concrete, concrete, seatMat]);
    step.position.set(0, 0.6 + r * 0.6, r * 1.2);
    standGroup.add(step);
  }
  const back = new THREE.Mesh(track(new THREE.BoxGeometry(200, 9, 0.5)), concrete);
  back.position.set(0, 4.5, 14.6);
  standGroup.add(back);
  const roof = new THREE.Mesh(track(new THREE.BoxGeometry(204, 0.4, 17)), mat(new THREE.MeshStandardMaterial({ color: 0xe8e6e1, metalness: 0.3, roughness: 0.5, transparent: true })));
  roof.position.set(0, 11.5, 7);
  roof.rotation.x = -0.06;
  standGroup.add(roof);
  for (let i = 0; i < 9; i++) {
    const col = new THREE.Mesh(track(new THREE.BoxGeometry(0.4, 11.5, 0.4)), concrete);
    col.position.set(-96 + i * 24, 5.75, 14.4);
    standGroup.add(col);
  }
  standGroup.position.set(-130, 0, -(BARRIER + 6));
  standGroup.rotation.y = Math.PI; // seats face the track
  standGroup.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
  group.add(standGroup);

  // trees around the venue: each tree = trunk + 3 clustered, colour-varied crowns
  const treeCount = low ? 180 : 300;
  const trunks = new THREE.InstancedMesh(track(new THREE.CylinderGeometry(0.22, 0.34, 3.4, 7)), mat(new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1, transparent: true })), treeCount);
  const crownGeo = track(new THREE.IcosahedronGeometry(2.6, 1));
  // lumpy foliage: displace vertices a little
  const cp = crownGeo.attributes.position;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < cp.count; i++) {
    tmp.fromBufferAttribute(cp, i);
    const n = 1 + 0.16 * Math.sin(tmp.x * 3.1 + tmp.y * 1.7) * Math.cos(tmp.z * 2.3 - tmp.y * 2.9);
    tmp.multiplyScalar(n);
    cp.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  crownGeo.computeVertexNormals();
  const crownMat = mat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, transparent: true }));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount * 3);
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const tp = new THREE.Vector3();
  const col = new THREE.Color();
  const greens = [0x2f5a25, 0x3b6b2c, 0x284d20, 0x45742f, 0x335f2a];
  let ti = 0;
  let ci = 0;
  let guard = 0;
  while (ti < treeCount && guard++ < 20000) {
    const f = frames[(Math.random() * N) | 0];
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = BARRIER + 14 + Math.random() * 130;
    tp.copy(f.p).addScaledVector(f.n, side * off);
    let clear = true;
    for (let j = 0; j < N; j += 6) if (frames[j].p.distanceToSquared(tp) < (BARRIER + 10) ** 2) { clear = false; break; }
    if (!clear) continue;
    if (Math.abs(tp.z) < 70 && tp.x > -270 && tp.x < 20) continue; // keep stands / pits clear
    const s = 0.75 + Math.random() * 0.9;
    sc.set(s, s, s);
    m4.compose(new THREE.Vector3(tp.x, 1.7 * s, tp.z), q, sc);
    trunks.setMatrixAt(ti, m4);
    const base = greens[(Math.random() * greens.length) | 0];
    for (let c = 0; c < 3; c++) {
      const a = Math.random() * Math.PI * 2;
      const r = c === 0 ? 0 : 1.6 * s;
      const cs = s * (c === 0 ? 1.15 : 0.8 + Math.random() * 0.25);
      sc.set(cs, cs * (0.95 + Math.random() * 0.3), cs);
      q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random()));
      m4.compose(new THREE.Vector3(tp.x + Math.cos(a) * r, (c === 0 ? 5.6 : 4.4 + Math.random() * 1.6) * s, tp.z + Math.sin(a) * r), q, sc);
      crowns.setMatrixAt(ci, m4);
      col.setHex(base).offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.08);
      crowns.setColorAt(ci, col);
      ci++;
    }
    q.identity();
    ti++;
  }
  trunks.count = ti;
  crowns.count = ci;
  crowns.castShadow = true;
  group.add(trunks, crowns);

  // sky
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(205));
  const u = sky.material.uniforms;
  u.turbidity.value = 2.2;
  u.rayleigh.value = 2.4;
  u.mieCoefficient.value = 0.003;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sun);
  disposables.push(sky.geometry, sky.material);

  const setOpacity = (k: number) => {
    group.visible = k > 0.002;
    for (const m of materials) {
      if ("opacity" in m) (m as THREE.MeshStandardMaterial).opacity = k;
      (m as THREE.MeshStandardMaterial).depthWrite = true;
      (m as THREE.MeshStandardMaterial).transparent = (m as THREE.MeshStandardMaterial).alphaTest > 0;
    }
  };

  return {
    group,
    curve,
    length,
    sky,
    sun,
    curvatureAt,
    setOpacity,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
