import * as THREE from "three";

/*
 * Double-wishbone suspension + pushrods connecting the chassis to the wheels at their
 * (photo-matched) positions. Car-mesh local space: nose towards +X, ground at y = 0.
 */
export function buildSuspension(wheels: number[][]) {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const d = <T extends { dispose: () => void }>(o: T) => (disposables.push(o), o);
  const armMat = d(new THREE.MeshStandardMaterial({ color: 0x131417, metalness: 0.55, roughness: 0.35 }));
  const rodMat = d(new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 0.95, roughness: 0.2 }));
  const uprightMat = d(new THREE.MeshStandardMaterial({ color: 0x8d9097, metalness: 0.9, roughness: 0.3 }));
  const geo = d(new THREE.CylinderGeometry(0.011, 0.011, 1, 8));
  const up = new THREE.Vector3(0, 1, 0);
  const tube = (a: THREE.Vector3, b: THREE.Vector3, mat: THREE.Material, r = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.set(r, a.distanceTo(b), r);
    m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    m.castShadow = true;
    group.add(m);
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  for (const [wx, wy, wz] of wheels) {
    const s = Math.sign(wz);
    const front = wx > 0;
    const inner = front ? 0.17 : 0.24; // chassis half-width at the pick-ups
    const hubZ = wz - s * 0.12;
    // lower + upper wishbones (A-arms)
    const lo = V(wx, wy - 0.07, hubZ);
    const hi = V(wx, wy + 0.09, hubZ - s * 0.01);
    for (const dx of [-0.14, 0.14]) {
      tube(lo, V(wx + dx, wy - 0.08, s * inner), armMat);
      tube(hi, V(wx + dx * 0.8, wy + 0.06, s * (inner - 0.01)), armMat);
    }
    // pushrod to the rocker on the chassis
    tube(lo, V(wx + (front ? -0.03 : 0.03), wy + 0.2, s * (inner + 0.02)), rodMat, 0.8);
    // steering / toe link
    tube(V(wx + (front ? -0.07 : 0.07), wy - 0.02, hubZ), V(wx + (front ? -0.07 : 0.07), wy - 0.03, s * inner), armMat, 0.8);
    // upright
    const upright = new THREE.Mesh(d(new THREE.BoxGeometry(0.06, 0.2, 0.04)), uprightMat);
    upright.position.set(wx, wy + 0.01, hubZ + s * 0.01);
    upright.castShadow = true;
    group.add(upright);
  }
  return { group, dispose: () => disposables.forEach((x) => x.dispose()) };
}
