import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * What sits inside each tyre: spoked rim + hub nut and the brake disc (spin with the wheel),
 * and the brake caliper (fixed to the upright, does not spin).
 * Tyre: radius ≈ 0.233, width ≈ 0.233 (z ±0.117), axle along Z.
 */
export function buildWheelHub() {
  const disposables: { dispose(): void }[] = [];
  const d = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const toZ = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const part = (g: THREE.BufferGeometry, m?: THREE.Matrix4) => {
    const out = g.index ? g : g;
    if (m) out.applyMatrix4(m);
    for (const k of Object.keys(out.attributes)) if (!["position", "normal", "uv"].includes(k)) out.deleteAttribute(k);
    return out;
  };

  // rim: barrel + outer lip + 6 spokes + hub (outer face at +z, mirrored per side)
  const rimParts: THREE.BufferGeometry[] = [
    part(new THREE.CylinderGeometry(0.168, 0.168, 0.2, 40, 1, true), toZ),
    part(new THREE.TorusGeometry(0.168, 0.009, 8, 40), new THREE.Matrix4().makeTranslation(0, 0, 0.098)),
    part(new THREE.TorusGeometry(0.168, 0.007, 8, 40), new THREE.Matrix4().makeTranslation(0, 0, -0.098)),
    part(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 20), new THREE.Matrix4().makeTranslation(0, 0, 0.06).multiply(toZ)),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(0.125, 0.028, 0.018);
    spoke.translate(0.105, 0, 0);
    spoke.rotateY(-0.12); // slight dish towards the outside
    spoke.rotateZ(a);
    spoke.translate(0, 0, 0.07);
    rimParts.push(part(spoke));
  }
  const rimGeo = d(mergeGeometries(rimParts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!);
  rimParts.forEach((g) => g.dispose());
  const nutGeo = d(part(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), new THREE.Matrix4().makeTranslation(0, 0, 0.09).multiply(toZ)));

  // brake disc (inboard), with a darker hat in the middle
  const discGeo = d(part(new THREE.CylinderGeometry(0.118, 0.118, 0.009, 40), new THREE.Matrix4().makeTranslation(0, 0, -0.035).multiply(toZ)));
  const hatGeo = d(part(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24), new THREE.Matrix4().makeTranslation(0, 0, -0.02).multiply(toZ)));

  // caliper hugging the top-rear of the disc
  const caliperGeo = d(new THREE.BoxGeometry(0.075, 0.05, 0.05));
  caliperGeo.rotateZ(0.5);
  caliperGeo.translate(0.075, 0.075, -0.035);

  const rimMat = d(new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.85, roughness: 0.32 }));
  const nutMat = d(new THREE.MeshStandardMaterial({ color: 0xd2a63a, metalness: 0.9, roughness: 0.25 }));
  const discMat = d(new THREE.MeshStandardMaterial({ color: 0x9a9da3, metalness: 0.9, roughness: 0.42 }));
  const hatMat = d(new THREE.MeshStandardMaterial({ color: 0x3a3c41, metalness: 0.7, roughness: 0.4 }));
  const caliperMat = d(new THREE.MeshStandardMaterial({ color: 0xd8231a, metalness: 0.3, roughness: 0.38 }));

  /** side: +1 when the outer face of the wheel points to +z, −1 otherwise */
  const attach = (spin: THREE.Object3D, steer: THREE.Object3D, side: number) => {
    const s = new THREE.Group();
    s.scale.z = side;
    s.add(new THREE.Mesh(rimGeo, rimMat), new THREE.Mesh(nutGeo, nutMat), new THREE.Mesh(discGeo, discMat), new THREE.Mesh(hatGeo, hatMat));
    spin.add(s);
    const c = new THREE.Mesh(caliperGeo, caliperMat);
    c.scale.z = side;
    steer.add(c);
  };

  return { attach, dispose: () => disposables.forEach((x) => x.dispose()) };
}
