"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CHAPTERS } from "@/lib/content";
import { telemetry } from "@/lib/telemetry";
import { Btn } from "@/components/ui";
import { applyLivery, wheelMaterial, wheelUVs } from "@/components/livery";
import { buildCircuit } from "@/components/circuit";
import { buildGarage } from "@/components/garage";
import { buildRearEnd } from "@/components/rearEnd";
import { buildSuspension } from "@/components/suspension";

type MeshData = { p: string; i: string; w: number };
type CarModel = { red: MeshData; white: MeshData; carbon: MeshData; wheel: MeshData; places: number[][] };

// Camera keyframes along the scroll. Car faces −X (nose), rear is +X.
// shift: horizontal frame offset (fraction of width) → positive pushes the car to the right.
const KEYS = [
  { p: 0.0, pos: [-4.6, 1.45, 4.4], look: [0, 0.42, 0], fov: 34, shift: 0.21 },
  { p: 0.14, pos: [-2.2, 1.0, 5.6], look: [0, 0.45, 0], fov: 33, shift: 0.15 },
  { p: 0.3, pos: [0.15, 0.62, 6.1], look: [-0.1, 0.48, 0], fov: 32, shift: -0.17 },
  { p: 0.44, pos: [3.4, 2.9, 3.4], look: [0, 0.35, 0], fov: 34, shift: -0.12 },
  { p: 0.56, pos: [3.6, 3.7, -2.8], look: [-0.3, 0.3, 0], fov: 34, shift: 0.15 },
  { p: 0.62, pos: [-3.2, 2.0, -4.6], look: [0, 0.4, 0], fov: 36, shift: 0.08 },
  { p: 0.68, pos: [-4.4, 0.32, 1.7], look: [0, 0.45, 0], fov: 36, shift: 0.1 },
  { p: 0.74, pos: [0.6, 1.7, 4.6], look: [-0.6, 0.4, 0], fov: 40, shift: 0.0, lift: 0.06 },
  { p: 0.8, pos: [4.6, 1.35, 1.1], look: [-3, 0.35, 0], fov: 44, shift: 0.0, lift: 0.12 },
  { p: 1.0, pos: [5.4, 1.15, -0.3], look: [-4, 0.4, 0], fov: 50, shift: 0.0, lift: 0.16 },
] as { p: number; pos: number[]; look: number[]; fov: number; shift: number; lift?: number }[];

const TOP_SPEED = 200; // km/h — car #19 top speed

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const band = (p: number, a: number, b: number) => clamp((p - a) / (b - a));

function decode(b64: string) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
function geometry(d: MeshData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(decode(d.p)), 3));
  g.setIndex(new THREE.BufferAttribute(d.w === 2 ? new Uint16Array(decode(d.i)) : new Uint32Array(decode(d.i)), 1));
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  g.dispose();
  return m;
}

async function fetchModel(onProgress: (f: number) => void): Promise<CarModel> {
  const res = await fetch("/models/enp-car.json");
  const total = Number(res.headers.get("content-length")) || 2_100_000;
  if (!res.body) return res.json();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(0.98, got / total));
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return JSON.parse(new TextDecoder().decode(all));
}

export default function ScrollScene() {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chapterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const railRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current!;
    const canvas = canvasRef.current!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;
    let raf = 0;

    // ---------- renderer / scene
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      telemetry.ready = true;
      section.classList.add("no-webgl");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 900 ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.localClippingEnabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x07070a, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x07070a, 14, 60);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.08, 2600);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    // tint the studio softboxes with team colours
    const env = new THREE.Scene();
    env.add(room);
    const panel = (w: number, h: number, p: [number, number, number], color: number, i: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(i), side: THREE.DoubleSide }),
      );
      m.position.set(...p);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(5, 2.5, [-6, 3, -4], 0xdfe6ff, 2.2);
    panel(5, 2.5, [6, 3, -6], 0xc21e2a, 2.2);
    const envStudio = pmrem.fromScene(env, 0.035).texture;
    scene.environment = envStudio;

    // ---------- circuit + sky (daylight), built once
    const circuit = buildCircuit();
    circuit.sky.scale.setScalar(2000);
    const skyScene = new THREE.Scene();
    skyScene.add(circuit.sky);
    const envDay = pmrem.fromScene(skyScene).texture;
    pmrem.dispose();
    scene.add(circuit.sky, circuit.group);
    circuit.setOpacity(0);
    // black dome that hides the sky while we are in the studio
    const domeMat = new THREE.MeshBasicMaterial({ color: 0x07070a, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), domeMat);
    dome.renderOrder = -1;
    scene.add(dome);
    const fogStudio = new THREE.Color(0x07070a);
    const fogDay = new THREE.Color(0x6a7d90);

    // ---------- lights
    const studioHemi = new THREE.HemisphereLight(0xb8c4ff, 0x0b0b0e, 0.35);
    scene.add(studioHemi);
    const dayHemi = new THREE.HemisphereLight(0xcfe0ff, 0x52633a, 0);
    scene.add(dayHemi);
    const sunLight = new THREE.DirectionalLight(0xfff1dc, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.03;
    Object.assign(sunLight.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 200 });
    scene.add(sunLight, sunLight.target);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
    scene.add(key);

    // ---------- the workshop (hero) — the car starts parked in the team garage
    const garage = buildGarage();
    scene.add(garage.group);

    // ---------- car
    const car = new THREE.Group(); // yaw / roll / bob
    car.rotation.order = "YXZ";
    const model = new THREE.Group();
    car.add(model);
    scene.add(car);
    const frontWheels: THREE.Group[] = [];
    const spinners: THREE.Group[] = [];

    const paint = new THREE.MeshPhysicalMaterial({
      color: 0xe2321f, metalness: 0.25, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.DoubleSide,
    });
    const white = new THREE.MeshPhysicalMaterial({
      color: 0xf1f1ec, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide,
    });
    const carbon = new THREE.MeshPhysicalMaterial({
      color: 0x111216, metalness: 0.55, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide,
    });
    const tyre = wheelMaterial();
    // the real car's bodywork stops behind the main hoop: clip the mesh there (plane kept in world space)
    const rearLocal = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1.15);
    const rearClip = new THREE.Plane();
    paint.clippingPlanes = [rearClip];
    white.clippingPlanes = [rearClip];
    const rearEnd = buildRearEnd();
    let suspDispose = () => {};

    const onResize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);
    onResize();

    fetchModel((f) => (telemetry.load = f))
      .then(async (m) => {
        if (disposed) return;
        const parts = {
          red: new THREE.Mesh(geometry(m.red), paint),
          white: new THREE.Mesh(geometry(m.white), white),
          carbon: new THREE.Mesh(geometry(m.carbon), carbon),
        };
        model.add(parts.red, parts.white, parts.carbon);
        // #19 livery — projected while the model still has an identity transform
        const decals = await applyLivery(parts, model).catch(() => [] as THREE.Mesh[]);
        // only bodywork decals get the rear cut (wing endplates sit further back and must stay)
        decals.forEach((dm) => {
          dm.geometry.computeBoundingBox();
          const cx = (dm.geometry.boundingBox!.min.x + dm.geometry.boundingBox!.max.x) / 2;
          if (cx > -1.4) (dm.material as THREE.Material).clippingPlanes = [rearClip];
        });
        model.add(rearEnd.group);
        if (disposed) return;
        const wg = wheelUVs(geometry(m.wheel));
        garage.setTyreMesh(wg, tyre);
        // axle positions matched to the real #19 (photos): front wing clearly ahead of the front
        // wheels, rear wheels behind the hoop/engine under the rear wing. Wheelbase ≈ 1.68 m.
        const places = m.places.map((p) => [p[0] > 0 ? 0.3 : -1.38, p[1], p[2]]);
        const susp = buildSuspension(places);
        model.add(susp.group);
        suspDispose = susp.dispose;
        places.forEach((p) => {
          const steer = new THREE.Group();
          steer.position.set(p[0], p[1], p[2]);
          const spin = new THREE.Group();
          spin.add(new THREE.Mesh(wg, tyre));
          steer.add(spin);
          model.add(steer);
          spinners.push(spin);
          if (p[0] > 0) frontWheels.push(steer);
        });
        // the mesh's nose points +X: turn it to face −X (direction of travel) and centre it
        model.rotation.y = Math.PI;
        model.position.x = -0.54;
        car.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        telemetry.load = 1;
      })
      .catch(() => {
        telemetry.load = 1;
        section.classList.add("no-model");
      });

    // ---------- real reflections: capture the finished garage into the environment map
    let envGarage: THREE.Texture | null = null;
    garage.ready.then(() =>
      requestAnimationFrame(() => {
        if (disposed) return;
        const carVis = car.visible;
        const domeVis = dome.visible;
        car.visible = false;
        dome.visible = false;
        const cgVis = circuit.group.visible;
        circuit.group.visible = false;
        const pm = new THREE.PMREMGenerator(renderer);
        envGarage = pm.fromScene(scene, 0.012, 0.1, 40, { size: 256, position: new THREE.Vector3(0, 1.1, 0) }).texture;
        pm.dispose();
        car.visible = carVis;
        dome.visible = domeVis;
        circuit.group.visible = cgVis;
      }),
    );

    // ---------- interaction
    let mx = 0;
    let my = 0;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / innerWidth - 0.5;
      my = e.clientY / innerHeight - 0.5;
    };
    addEventListener("pointermove", onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "100px" });
    io.observe(section);

    // ---------- loop
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    let progress = 0;
    let smoothP = 0;
    let distance = 0;
    let speedMs = 0;
    let wheelAngle = 0;
    let camYaw = 0;
    const carPos = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const frame = new THREE.Matrix4();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const sunDir = circuit.sun.clone().normalize();
    let last = performance.now();
    let first = true;

    const sample = (p: number) => {
      let i = 0;
      while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
      const a = KEYS[i];
      const b = KEYS[i + 1];
      const t = ease(clamp((p - a.p) / (b.p - a.p)));
      tmpA.fromArray(a.pos).lerp(tmpB.fromArray(b.pos), t);
      pos.copy(tmpA);
      tmpA.fromArray(a.look).lerp(tmpB.fromArray(b.look), t);
      look.copy(tmpA);
      const la = a.lift ?? 0;
      const lb = b.lift ?? 0;
      return { fov: a.fov + (b.fov - a.fov) * t, shift: a.shift + (b.shift - a.shift) * t, lift: la + (lb - la) * t };
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible && !first) {
        telemetry.speed = 0;
        return;
      }

      // scroll progress through the pinned section
      const r = section.getBoundingClientRect();
      const span = r.height - innerHeight;
      progress = clamp(-r.top / (span || 1));
      smoothP += (progress - smoothP) * (reduce ? 1 : 1 - Math.pow(0.0012, dt));
      const p = smoothP;

      // camera
      const { fov, shift, lift } = sample(p);
      const narrow = camera.aspect < 0.9;
      const time = now / 1000;
      const race = smooth(band(p, 0.62, 0.8));
      const idle = reduce ? 0 : 1 - race;
      pos.x += Math.sin(time * 0.25) * 0.25 * idle + mx * 0.5 * idle;
      pos.y += my * -0.25 * idle;
      pos.z += Math.cos(time * 0.2) * 0.2 * idle;
      if (narrow) pos.multiplyScalar(1.22);
      // race: chase cam shake
      const speedK = smooth(band(p, 0.64, 0.95));
      if (!reduce && speedK > 0) {
        pos.y += Math.sin(time * 38) * 0.008 * speedK;
        pos.z += Math.sin(time * 23) * 0.012 * speedK;
      }
      // (camera pose is expressed in the car's frame; applied after the car moves)
      camera.fov = narrow ? fov + 22 : fov;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const s = narrow ? 0 : shift;
      // phones: hero text sits on top → car low; later chapters text at bottom → car high
      const l = narrow ? -0.2 + 0.36 * smooth(band(p, 0.06, 0.22)) : lift;
      camera.setViewOffset(w, h, -s * w, l * h, w, h);
      camera.updateProjectionMatrix();

      // driving along the circuit
      const target = (TOP_SPEED * (0.12 * smooth(band(p, 0.56, 0.66)) + 0.88 * speedK)) / 3.6;
      const uNow = (((distance / circuit.length) % 1) + 1) % 1;
      // look ahead for corners and brake like a driver would (≈1.7 g lateral)
      let kMax = 0;
      for (let a = 0; a <= 60; a += 12) kMax = Math.max(kMax, Math.abs(circuit.curvatureAt(uNow + a / circuit.length)));
      const vCorner = kMax > 1e-4 ? Math.sqrt(17 / kMax) : 1e9;
      const vTarget = Math.min(target, race > 0.5 ? vCorner : 1e9);
      speedMs += (vTarget - speedMs) * (1 - Math.exp(-dt * (vTarget < speedMs ? 2.6 : 1.2)));
      if (race < 0.01 && target < 0.5) {
        // back in the studio: park the car on the turntable
        distance = 0;
        speedMs = 0;
      }
      distance += speedMs * dt;
      telemetry.speed = speedMs * 3.6;
      wheelAngle += (speedMs / 0.232) * dt;
      spinners.forEach((s2) => (s2.rotation.z = -wheelAngle));

      const u = (((distance / circuit.length) % 1) + 1) % 1;
      circuit.curve.getPointAt(u, carPos);
      circuit.curve.getTangentAt(u, tangent);
      const yaw = Math.atan2(tangent.z, -tangent.x);
      const k = circuit.curvatureAt(u);
      const steer = clamp(Math.atan(1.6 * k) * 1.4, -0.38, 0.38);
      frontWheels.forEach((f) => (f.rotation.y = steer));
      car.position.set(carPos.x, Math.sin(time * 31) * 0.004 * speedK, carPos.z);
      car.rotation.y = yaw;
      car.rotation.x = clamp(-k * speedMs * speedMs * 0.0011, -0.035, 0.035); // body roll
      car.rotation.z = clamp(-(vTarget - speedMs) * 0.0015, -0.02, 0.02); // pitch under braking

      model.updateWorldMatrix(true, false);
      rearClip.copy(rearLocal).applyMatrix4(model.matrixWorld);

      // chase camera lags a touch behind the car's heading
      let dy = yaw - camYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      camYaw += dy * (1 - Math.exp(-dt * 3.2));
      if (race < 0.01) camYaw = yaw;
      frame.makeRotationAxis(yAxis, camYaw).setPosition(carPos.x, 0, carPos.z);
      pos.applyMatrix4(frame);
      look.applyMatrix4(frame);
      camera.position.copy(pos);
      camera.lookAt(look);

      // sun follows the car so shadows stay crisp
      sunLight.position.copy(carPos).addScaledVector(sunDir, 80);
      sunLight.target.position.copy(carPos);
      sunLight.target.updateMatrixWorld();

      // workshop → circuit: the roller door rolls up, daylight floods in, the car drives out
      const doorOpen = smooth(band(p, 0.48, 0.62));
      // daylight ramps in slowly over a long stretch of scroll (≈ eyes adjusting as the car rolls out)
      const day = smooth(band(p, 0.54, 0.9));
      const sunK = smooth(band(day, 0.12, 1));
      garage.setDoor(doorOpen);
      garage.setLights(1 - 0.4 * day);
      garage.group.visible = distance < 140;
      circuit.setOpacity(p > 0.44 ? 1 : 0);
      domeMat.opacity = 1 - smooth(band(day, 0, 0.8));
      dome.position.copy(camera.position);
      dome.visible = domeMat.opacity > 0.001;
      circuit.sky.visible = day > 0.001;
      studioHemi.intensity = 0.32 * (1 - day);
      key.intensity = 0.7 * (1 - day);
      dayHemi.intensity = 0.38 * day;
      sunLight.intensity = 1.9 * sunK;
      // reflections cross-fade: garage env dims to a low point, swaps, then the sky env brightens
      const swap = 0.45;
      scene.environment = day > swap ? envDay : (envGarage ?? envStudio);
      scene.environmentIntensity = day > swap ? THREE.MathUtils.lerp(0.22, 0.38, (day - swap) / (1 - swap)) : THREE.MathUtils.lerp(1, 0.3, day / swap);
      renderer.toneMappingExposure = THREE.MathUtils.lerp(1.22, 0.32, day);
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(fogStudio).lerp(fogDay, day);
      fog.near = THREE.MathUtils.lerp(30, 140, day);
      fog.far = THREE.MathUtils.lerp(90, 1900, day);

      renderer.render(scene, camera);
      if (first) {
        first = false;
        telemetry.ready = true;
      }

      // ---------- DOM overlay (chapters, rail, hint)
      CHAPTERS.forEach((c, i) => {
        const el = chapterRefs.current[i];
        if (!el) return;
        const next = CHAPTERS[i + 1]?.at ?? 1.2;
        const prev = CHAPTERS[i - 1]?.at ?? -1;
        const inEnd = c.at - (c.at - prev) * 0.35;
        const outStart = c.at + (next - c.at) * 0.45;
        const outEnd = c.at + (next - c.at) * 0.75;
        let o: number;
        if (i === 0) o = 1 - band(p, outStart, outEnd);
        else if (i === CHAPTERS.length - 1) o = band(p, inEnd, c.at);
        else o = Math.min(band(p, inEnd, c.at), 1 - band(p, outStart, outEnd));
        o = smooth(clamp(o));
        el.style.opacity = String(o);
        el.style.transform = `translate3d(0, ${(1 - o) * (p < c.at ? 40 : -40)}px, 0)`;
        el.style.visibility = o < 0.01 ? "hidden" : "visible";
        el.style.pointerEvents = o > 0.5 ? "auto" : "none";
      });
      if (railRef.current) railRef.current.style.setProperty("--p", String(p));
      if (hintRef.current) hintRef.current.style.opacity = String(1 - band(p, 0, 0.05));
      if (vignetteRef.current) vignetteRef.current.style.opacity = String(race);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      removeEventListener("pointermove", onMove);
      renderer.dispose();
      circuit.dispose();
      garage.dispose();
      rearEnd.dispose();
      suspDispose();
      envGarage?.dispose();
      envDay.dispose();
      envStudio.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
        }
      });
    };
  }, []);

  return (
    <section ref={sectionRef} id="top" className="scene" aria-label="ENP Racing Team car #19 in 3D">
      <div className="scene-sticky">
        <canvas ref={canvasRef} className="scene-canvas" />
        <div ref={vignetteRef} className="scene-race-fx" aria-hidden />
        <div className="scene-grain" aria-hidden />

        {CHAPTERS.map((c, i) => (
          <div
            key={i}
            ref={(el) => {
              chapterRefs.current[i] = el;
            }}
            className={`chapter chapter-${i}`}
            style={i === 0 ? undefined : { opacity: 0, visibility: "hidden" }}
          >
            <div className="chapter-kicker">
              <span className="sec-code">{i === 0 ? "GRID" : `S${i}`}</span>
              {c.kicker}
            </div>
            {i === 0 ? (
              <h1 className="chapter-title hero-title">
                {c.title.map((l, k) => (
                  <span className="line" key={k}>
                    <span>{k === 1 ? <>to <em>Silverstone</em></> : l}</span>
                  </span>
                ))}
              </h1>
            ) : (
              <h2 className="chapter-title">
                {c.title.map((l, k) => (
                  <span className="line" key={k}>
                    <span>{l}</span>
                  </span>
                ))}
              </h2>
            )}
            <p className="chapter-body">{c.body}</p>
            {i === 0 && (
              <div className="chapter-ctas">
                <Btn href="#partners">Become a partner</Btn>
                <Btn href="#about" variant="ghost">
                  Meet the team
                </Btn>
              </div>
            )}
            {i === CHAPTERS.length - 1 && (
              <div className="chapter-badge">
                <span className="sec-code">P1</span>
                <b>Allan Staniforth Best Newcomer Award</b>
                <span>FS UK 2026</span>
              </div>
            )}
          </div>
        ))}

        <div ref={railRef} className="scene-rail" aria-hidden>
          <span className="rail-title">Lap</span>
          {["S1", "S2", "S3"].map((s, i) => (
            <span className="rail-sector" key={s} style={{ ["--i" as string]: i }}>
              <i />
              <small>{s}</small>
            </span>
          ))}
        </div>

        <div ref={hintRef} className="scene-hint" aria-hidden>
          <span>Scroll</span>
          <i />
        </div>
      </div>
    </section>
  );
}
