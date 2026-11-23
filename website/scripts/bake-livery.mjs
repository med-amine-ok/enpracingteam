// Pre-computes the car #19 livery decal geometry so the browser doesn't have to.
// Run after changing components/livery-specs.json or public/models/enp-car.json:
//   node scripts/bake-livery.mjs
// Output: public/models/enp-livery.json (positions / normals / uvs per decal, in the car mesh's local space)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = JSON.parse(fs.readFileSync(path.join(root, "public/models/enp-car.json"), "utf8"));
const specs = JSON.parse(fs.readFileSync(path.join(root, "components/livery-specs.json"), "utf8"));

const dec = (b64) => {
  const b = Buffer.from(b64, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};
// must match geometry() in components/ScrollScene.tsx
const geometry = (d) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dec(d.p)), 3));
  g.setIndex(new THREE.BufferAttribute(d.w === 2 ? new Uint16Array(dec(d.i)) : new Uint32Array(dec(d.i)), 1));
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
};

const meshes = {};
for (const k of ["red", "white", "carbon"]) meshes[k] = new THREE.Mesh(geometry(model[k]), new THREE.MeshBasicMaterial());
const all = Object.values(meshes);
all.forEach((m) => m.updateMatrixWorld(true));

const rc = new THREE.Raycaster();
const helper = new THREE.Object3D();
const b64 = (arr) => Buffer.from(new Float32Array(arr).buffer).toString("base64");
const out = [];
for (const s of specs) {
  const targets = s.targets.map((k) => meshes[k]);
  rc.set(new THREE.Vector3(...s.from), new THREE.Vector3(...s.dir).normalize());
  const hit = rc.intersectObjects(all, false)[0];
  if (!hit || !targets.includes(hit.object)) continue;
  helper.position.copy(hit.point);
  helper.lookAt(hit.point.clone().sub(new THREE.Vector3(...s.dir)));
  helper.rotateZ(s.spin ?? 0);
  for (const t of targets) {
    const g = new DecalGeometry(t, helper.position, helper.rotation, new THREE.Vector3(...s.size));
    if (g.attributes.position.count === 0) continue;
    const m = mergeVertices(g, 1e-5); // share vertices → much smaller file
    const idx = m.index.array;
    const big = m.attributes.position.count > 65535;
    out.push({
      tex: s.tex,
      p: b64(m.attributes.position.array),
      n: b64(m.attributes.normal.array),
      uv: b64(m.attributes.uv.array),
      i: Buffer.from((big ? new Uint32Array(idx) : new Uint16Array(idx)).buffer).toString("base64"),
      w: big ? 4 : 2,
    });
  }
}
const file = path.join(root, "public/models/enp-livery.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log(`baked ${out.length} decals → ${path.relative(root, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
