// tools/split-drone.mjs — VERIFIED 2026-09-24 against fpv-dron_nonstop.zip
// Splits the single-mesh Sketchfab "FPV-dron_NonStop" into animatable parts.
// Output: meters, Y-up, nose = -Z, rotor pivots exactly on motor axes.
import { Document, NodeIO } from '@gltf-transform/core';
import { mat4, vec3 } from 'gl-matrix';

const [, , IN = 'assets-src/drone/scene.gltf', OUT = 'public/models/drone.raw.glb'] = process.argv;
const METERS_PER_UNIT = 0.3845; // 7" (0.1778 m) prop ⇔ 0.4624 world units
const io = new NodeIO();
const src = await io.read(IN);
const root = src.getRoot();
const meshNode = root.listNodes().find((n) => n.getMesh());
const prim = meshNode.getMesh().listPrimitives()[0];
const world = meshNode.getWorldMatrix();

const P = prim.getAttribute('POSITION').getArray();
const N = prim.getAttribute('NORMAL').getArray();
const Tg = prim.getAttribute('TANGENT').getArray();
const UV = prim.getAttribute('TEXCOORD_0').getArray();
const IDX = prim.getIndices().getArray();
const vCount = P.length / 3, tCount = IDX.length / 3;

// --- 1. connected components on position-welded vertices (mesh-local space) ---
const key = (i) => `${P[i*3].toFixed(5)},${P[i*3+1].toFixed(5)},${P[i*3+2].toFixed(5)}`;
const weld = new Int32Array(vCount); const seen = new Map();
for (let i = 0; i < vCount; i++) { const k = key(i); if (!seen.has(k)) seen.set(k, i); weld[i] = seen.get(k); }
const parent = Int32Array.from({ length: vCount }, (_, i) => i);
const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
for (let t = 0; t < tCount; t++) { const a = weld[IDX[t*3]], b = weld[IDX[t*3+1]], c = weld[IDX[t*3+2]]; unite(a, b); unite(b, c); }
const comps = new Map();
for (let t = 0; t < tCount; t++) {
  const r = find(weld[IDX[t*3]]);
  if (!comps.has(r)) comps.set(r, { tris: [], min: [1e9,1e9,1e9], max: [-1e9,-1e9,-1e9] });
  const c = comps.get(r); c.tris.push(t);
  for (let k = 0; k < 3; k++) { const v = IDX[t*3+k]; for (let a = 0; a < 3; a++) { c.min[a] = Math.min(c.min[a], P[v*3+a]); c.max[a] = Math.max(c.max[a], P[v*3+a]); } }
}

// --- 2. classify (mesh-local: Z up, +Y = nose) ---
const HUBS = { // Betaflight numbering, props-in (verified from blade pitch)
  RR: { xy: [ 0.306, -0.31], motor: 1, spin: 'CW'  },
  FR: { xy: [ 0.306,  0.31], motor: 2, spin: 'CCW' },
  RL: { xy: [-0.306, -0.31], motor: 3, spin: 'CCW' },
  FL: { xy: [-0.306,  0.31], motor: 4, spin: 'CW'  },
};
const groups = { body: [], payload: [], antenna: [], RR: [], FR: [], RL: [], FL: [] };
for (const c of comps.values()) {
  const ctr = c.min.map((m, a) => (m + c.max[a]) / 2);
  let g = 'body';
  for (const [id, h] of Object.entries(HUBS)) {
    const d = Math.hypot(ctr[0] - h.xy[0], ctr[1] - h.xy[1]);
    const ext = Math.max(c.max[0] - c.min[0], c.max[1] - c.min[1]);
    const isProp = d < 0.08 && ext > 0.3 && c.max[2] - c.min[2] < 0.03;
    const isRotorHw = d < 0.04 && ctr[2] > 0.165 && ext < 0.07; // bell, prop adapter, nut, bell decals
    if (isProp || isRotorHw) g = id;
  }
  if (g === 'body' && c.max[2] < 0.14) g = 'payload'; // underslung canister + mount
  if (g === 'body' && ctr[1] < -0.3 && c.max[2] > 0.3) g = 'antenna'; // rear whip + tip cap
  groups[g].push(...c.tris);
}

// --- 3. rebuild as separate meshes baked to meters, pivots on motor axes ---
const S = mat4.create(); mat4.fromScaling(S, [METERS_PER_UNIT, METERS_PER_UNIT, METERS_PER_UNIT]);
const M = mat4.multiply(mat4.create(), S, world);
const R = mat4.clone(world); for (let i = 0; i < 12; i++) R[i] /= Math.hypot(world[0], world[1], world[2]); R[12] = R[13] = R[14] = 0;
const toWorld = (x, y, z) => vec3.transformMat4(vec3.create(), [x, y, z], M);

const doc = new Document(); const buf = doc.createBuffer();
const oldMat = prim.getMaterial();
const mat = doc.createMaterial('drone').setBaseColorFactor(oldMat.getBaseColorFactor())
  .setMetallicFactor(oldMat.getMetallicFactor()).setRoughnessFactor(oldMat.getRoughnessFactor());
const tex = (t) => t && doc.createTexture(t.getName()).setImage(t.getImage()).setMimeType(t.getMimeType()).setURI(t.getURI());
mat.setBaseColorTexture(tex(oldMat.getBaseColorTexture()))
   .setMetallicRoughnessTexture(tex(oldMat.getMetallicRoughnessTexture()))
   .setNormalTexture(tex(oldMat.getNormalTexture()))
   .setDoubleSided(oldMat.getDoubleSided()).setAlphaMode(oldMat.getAlphaMode());
// occlusion is packed in the metallicRoughness texture's R channel (ORM) — reuse the same texture
if (oldMat.getOcclusionTexture()) mat.setOcclusionTexture(mat.getMetallicRoughnessTexture());
const scene = doc.createScene('Scene'); const rootNode = doc.createNode('drone'); scene.addChild(rootNode);

function build(name, tris, pivot) {
  const map = new Map(); const pos = [], nrm = [], tan = [], uv = [], idx = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = IDX[t*3+k];
    if (!map.has(v)) {
      map.set(v, map.size);
      const w = toWorld(P[v*3], P[v*3+1], P[v*3+2]);
      pos.push(w[0]-pivot[0], w[1]-pivot[1], w[2]-pivot[2]);
      const n = vec3.transformMat4(vec3.create(), [N[v*3], N[v*3+1], N[v*3+2]], R); vec3.normalize(n, n); nrm.push(...n);
      const tg = vec3.transformMat4(vec3.create(), [Tg[v*4], Tg[v*4+1], Tg[v*4+2]], R); vec3.normalize(tg, tg); tan.push(...tg, Tg[v*4+3]);
      uv.push(UV[v*2], UV[v*2+1]);
    }
    idx.push(map.get(v));
  }
  const acc = (arr, type, T) => doc.createAccessor().setType(type).setArray(new T(arr)).setBuffer(buf);
  const p = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', acc(pos, 'VEC3', Float32Array)).setAttribute('NORMAL', acc(nrm, 'VEC3', Float32Array))
    .setAttribute('TANGENT', acc(tan, 'VEC4', Float32Array)).setAttribute('TEXCOORD_0', acc(uv, 'VEC2', Float32Array))
    .setIndices(acc(idx, 'SCALAR', pos.length / 3 > 65535 ? Uint32Array : Uint16Array));
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(p)).setTranslation(pivot);
}

rootNode.addChild(build('body', groups.body, [0, 0, 0]));
rootNode.addChild(build('payload', groups.payload, [0, 0, 0]));
{ // antenna: pivot at the lowest whip vertex so it can sway from its base
  let base = null;
  for (const t of groups.antenna) for (let k = 0; k < 3; k++) { const v = IDX[t*3+k]; if (!base || P[v*3+2] < base[2]) base = [P[v*3], P[v*3+1], P[v*3+2]]; }
  const piv = Array.from(toWorld(...base));
  const a = doc.createNode('antenna').setTranslation(piv);
  a.addChild(build('antenna_mesh', groups.antenna, piv).setTranslation([0, 0, 0]));
  rootNode.addChild(a);
}
for (const [id, h] of Object.entries(HUBS)) {
  const pivot = toWorld(h.xy[0], h.xy[1], 0.176); // bell centre on motor axis
  // pivot node (spin this) -> mesh child. Optimizers may re-centre MESH nodes (quantization),
  // so the rotation axis must live on a mesh-less parent to stay exactly on the motor shaft.
  const pivotNode = doc.createNode(`rotor_${id}`).setTranslation(Array.from(pivot))
    .setExtras({ motor: h.motor, spin: h.spin }); // CCW (from above) = +Y rotation in three.js
  pivotNode.addChild(build(`rotor_${id}_mesh`, groups[id], Array.from(pivot)).setTranslation([0, 0, 0]));
  rootNode.addChild(pivotNode);
}
// camera mounts live in extras: optimizers prune empty leaf nodes
const r4 = (v) => Array.from(v).map((x) => +x.toFixed(4));
rootNode.setExtras({
  mounts: {
    fpvCam: r4(toWorld(0, 0.262, 0.163)), // just ahead of the FPV lens, faces -Z
    hdCam: r4(toWorld(0, 0.14, 0.40)),    // virtual GoPro on top-front of the battery
  },
  propDiameterM: 0.1778, bladeCount: 3, layout: 'quadX props-in (Betaflight default)',
  credit: 'Based on "FPV-dron_NonStop" by Viktor_ (https://sketchfab.com/Viktor.Zhuravlev), CC-BY-4.0. Modified: split into parts, rescaled to meters.',
  source: 'https://sketchfab.com/3d-models/fpv-dron-nonstop-c75dea6e3ae441ac87f292efb17f5bae',
});

for (const [g, t] of Object.entries(groups)) console.log(g.padEnd(8), String(t.length).padStart(6), 'tris');
const total = Object.values(groups).reduce((s, t) => s + t.length, 0);
if (total !== tCount) throw new Error(`triangle count mismatch ${total} != ${tCount}`);
for (const id of Object.keys(HUBS)) if (groups[id].length !== 1566) throw new Error(`rotor_${id}: expected 1566 tris, got ${groups[id].length}`);
if (!groups.antenna.length || !groups.payload.length) throw new Error('antenna/payload not found');
await io.write(OUT, doc);
console.log('wrote', OUT);
