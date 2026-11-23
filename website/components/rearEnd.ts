import * as THREE from "three";

/*
 * Exposed rear end of car #19, as seen in the team's photos: the bodywork stops behind the
 * main hoop, leaving the black tube frame, the engine, the red cone air filter and the
 * exhaust visible. Built in the car mesh's local space (nose towards +X, ground at y = 0).
 */

export function buildRearEnd() {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const d = <T extends { dispose: () => void }>(o: T) => (disposables.push(o), o);

  const frameMat = d(new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.6, roughness: 0.35 }));
  const engineMat = d(new THREE.MeshStandardMaterial({ color: 0x5d6168, metalness: 0.85, roughness: 0.38 }));
  const darkMat = d(new THREE.MeshStandardMaterial({ color: 0x1c1d21, metalness: 0.5, roughness: 0.5 }));
  const chrome = d(new THREE.MeshStandardMaterial({ color: 0xd9dbe0, metalness: 1, roughness: 0.16 }));
  const heatMat = d(new THREE.MeshStandardMaterial({ color: 0xb08a5a, metalness: 0.9, roughness: 0.3 }));
  const filterMat = d(new THREE.MeshStandardMaterial({ color: 0xd8231a, roughness: 0.85 }));

  const tubeGeo = d(new THREE.CylinderGeometry(0.0125, 0.0125, 1, 8));
  const up = new THREE.Vector3(0, 1, 0);
  const tube = (a: number[], b: number[], mat: THREE.Material = frameMat, r = 1) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const m = new THREE.Mesh(tubeGeo, mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.scale.set(r, va.distanceTo(vb), r);
    m.quaternion.setFromUnitVectors(up, vb.clone().sub(va).normalize());
    m.castShadow = true;
    group.add(m);
  };

  // rear frame: box from the main-hoop base back towards the wing, triangulated
  const P: Record<string, number[]> = {
    hlb: [-1.16, 0.12, 0.27], hrb: [-1.16, 0.12, -0.27], hlt: [-1.16, 0.52, 0.27], hrt: [-1.16, 0.52, -0.27],
    rlb: [-1.86, 0.14, 0.21], rrb: [-1.86, 0.14, -0.21], rlt: [-1.82, 0.47, 0.2], rrt: [-1.82, 0.47, -0.2],
    mlb: [-1.5, 0.12, 0.25], mrb: [-1.5, 0.12, -0.25], mlt: [-1.5, 0.5, 0.24], mrt: [-1.5, 0.5, -0.24],
  };
  ([
    ["hlb", "mlb"], ["mlb", "rlb"], ["hrb", "mrb"], ["mrb", "rrb"], ["hlt", "mlt"], ["mlt", "rlt"], ["hrt", "mrt"], ["mrt", "rrt"],
    ["rlb", "rrb"], ["rlt", "rrt"], ["rlb", "rlt"], ["rrb", "rrt"], ["mlb", "mlt"], ["mrb", "mrt"], ["mlt", "mrt"],
    ["hlb", "mlt"], ["hrb", "mrt"], ["mlb", "rlt"], ["mrb", "rrt"], ["rlb", "rrt"], ["mlb", "mrb"],
  ] as [string, string][]).forEach(([a, b]) => tube(P[a], P[b]));

  // engine: crankcase, cylinder block, cam cover, sump
  const box = (w: number, h: number, dd: number, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    const m = new THREE.Mesh(d(new THREE.BoxGeometry(w, h, dd)), mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  box(0.42, 0.2, 0.34, engineMat, -1.43, 0.24, 0);
  box(0.3, 0.2, 0.3, engineMat, -1.38, 0.42, 0, 0.18);
  box(0.32, 0.07, 0.28, darkMat, -1.36, 0.55, 0, 0.18);
  box(0.36, 0.06, 0.26, darkMat, -1.45, 0.11, 0);
  // cooling fins
  for (let i = 0; i < 6; i++) box(0.3, 0.006, 0.32, engineMat, -1.38 + Math.sin(0.18) * (i * 0.028), 0.34 + i * 0.028, 0, 0.18);
  // clutch cover + sprocket side
  const cover = new THREE.Mesh(d(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 24)), engineMat);
  cover.rotation.x = Math.PI / 2;
  cover.position.set(-1.5, 0.26, 0.19);
  group.add(cover);

  // intake: restrictor tube up to the red cone filter behind the hoop
  const intake = new THREE.Mesh(d(new THREE.CylinderGeometry(0.035, 0.03, 0.22, 16)), darkMat);
  intake.position.set(-1.3, 0.66, 0.05);
  intake.rotation.z = 0.5;
  group.add(intake);
  const filter = new THREE.Mesh(d(new THREE.CylinderGeometry(0.045, 0.075, 0.17, 24, 1, true)), filterMat);
  filter.position.set(-1.21, 0.8, 0.05);
  filter.rotation.z = 0.5;
  filter.castShadow = true;
  group.add(filter);
  const cap = new THREE.Mesh(d(new THREE.CircleGeometry(0.045, 24)), chrome);
  cap.position.set(-1.17, 0.875, 0.05);
  cap.rotation.set(0, 0, 0.5 - Math.PI / 2);
  cap.rotateX(-Math.PI / 2);
  group.add(cap);
  // pleats
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const rib = new THREE.Mesh(tubeGeo, filterMat);
    rib.scale.set(0.5, 0.17, 0.5);
    const o = new THREE.Vector3(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06);
    rib.position.copy(o);
    const pivot = new THREE.Group();
    pivot.add(rib);
    pivot.position.set(-1.21, 0.8, 0.05);
    pivot.rotation.z = 0.5;
    group.add(pivot);
  }

  // exhaust: four headers sweeping back into one silencer on the right side
  for (let i = 0; i < 4; i++) {
    const z0 = -0.12 + i * 0.08;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.32, 0.44, z0),
      new THREE.Vector3(-1.4, 0.36, -0.2 - i * 0.01),
      new THREE.Vector3(-1.6, 0.3, -0.24),
      new THREE.Vector3(-1.72, 0.36, -0.24),
    ]);
    const pipe = new THREE.Mesh(d(new THREE.TubeGeometry(curve, 24, 0.016, 8)), heatMat);
    pipe.castShadow = true;
    group.add(pipe);
  }
  const can = new THREE.Mesh(d(new THREE.CylinderGeometry(0.065, 0.065, 0.36, 24)), chrome);
  can.rotation.z = Math.PI / 2 - 0.25;
  can.position.set(-1.88, 0.42, -0.24);
  can.castShadow = true;
  group.add(can);
  const tip = new THREE.Mesh(d(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 16, 1, true)), darkMat);
  tip.rotation.z = Math.PI / 2 - 0.25;
  tip.position.set(-2.08, 0.47, -0.24);
  group.add(tip);

  // fuel tank / catch can + red rain light on the hoop (FS rule)
  box(0.12, 0.18, 0.12, d(new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.7, roughness: 0.3 })), -1.24, 0.3, 0.2);
  const rain = box(0.03, 0.06, 0.12, d(new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a10, emissiveIntensity: 1.2 })), -1.2, 0.98, 0);
  rain.castShadow = false;

  return { group, dispose: () => disposables.forEach((x) => x.dispose()) };
}
