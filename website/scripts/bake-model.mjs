// Pre-computes the car #19 mesh data the browser would otherwise build on the main thread
// (vertex welding + smooth normals took ~1–2 s on low-end laptops).
// Run after changing public/models/enp-car.json (the source model):
//   node scripts/bake-model.mjs
// Output: public/models/enp-car-baked.json, same shape plus `n` (Int16-normalised normals).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = JSON.parse(fs.readFileSync(path.join(root, "public/models/enp-car.json"), "utf8"));

const dec = (b64) => {
  const b = Buffer.from(b64, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");

const out = { places: src.places };
for (const k of ["red", "white", "carbon", "wheel"]) {
  const d = src[k];
  // must match the runtime fallback in components/ScrollScene.tsx (geometry())
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dec(d.p)), 3));
  g.setIndex(new THREE.BufferAttribute(d.w === 2 ? new Uint16Array(dec(d.i)) : new Uint32Array(dec(d.i)), 1));
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  const nf = m.attributes.normal.array;
  const n16 = new Int16Array(nf.length);
  for (let i = 0; i < nf.length; i++) n16[i] = Math.round(Math.max(-1, Math.min(1, nf[i])) * 32767);
  const idx = m.index.array;
  const big = m.attributes.position.count > 65535;
  out[k] = {
    p: b64(new Float32Array(m.attributes.position.array)),
    n: b64(n16),
    i: b64(big ? new Uint32Array(idx) : new Uint16Array(idx)),
    w: big ? 4 : 2,
  };
  console.log(k, m.attributes.position.count, "verts", idx.length / 3, "tris");
}
const file = path.join(root, "public/models/enp-car-baked.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log(`→ ${path.relative(root, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
