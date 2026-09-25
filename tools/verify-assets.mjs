// tools/verify-assets.mjs — asserts the generated drone.glb matches PRD §4.1.
// Exits non-zero on any failure so CI catches pipeline regressions.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, process.argv[2] ?? 'public/models/drone.glb');
const MAX_BYTES = 3 * 1024 * 1024;

const EXPECTED_TRIS = {
  body: 14616,
  payload: 3393,
  antenna_mesh: 440,
  rotor_RR_mesh: 1566,
  rotor_FR_mesh: 1566,
  rotor_RL_mesh: 1566,
  rotor_FL_mesh: 1566,
};
const PIVOTS = {
  antenna: 'antenna_mesh',
  rotor_RR: 'rotor_RR_mesh',
  rotor_FR: 'rotor_FR_mesh',
  rotor_RL: 'rotor_RL_mesh',
  rotor_FL: 'rotor_FL_mesh',
};
const ROTOR_EXTRAS = {
  rotor_RR: { motor: 1, spin: 'CW' },
  rotor_FR: { motor: 2, spin: 'CCW' },
  rotor_RL: { motor: 3, spin: 'CCW' },
  rotor_FL: { motor: 4, spin: 'CW' },
};
// PRD §2.1: rotor pivots at (±0.1217, 0.0700, ±0.1233) m; nose = -Z, so front rotors have z < 0.
const ROTOR_PIVOTS = {
  rotor_RR: [0.1217, 0.07, 0.1233],
  rotor_FR: [0.1217, 0.07, -0.1233],
  rotor_RL: [-0.1217, 0.07, 0.1233],
  rotor_FL: [-0.1217, 0.07, -0.1233],
};
const PIVOT_TOLERANCE_M = 0.0005;
const ROOT_EXTRAS = ['mounts', 'propDiameterM', 'bladeCount', 'layout', 'credit', 'source'];

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

if (!existsSync(FILE)) {
  console.error(`missing ${path.relative(ROOT, FILE)}: run \`pnpm assets\` first`);
  process.exit(1);
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(FILE);
const docRoot = doc.getRoot();
const byName = new Map(docRoot.listNodes().map((n) => [n.getName(), n]));

const size = statSync(FILE).size;
check(size <= MAX_BYTES, `size ${(size / 1e6).toFixed(2)} MB <= 3 MB`);

const scene = docRoot.listScenes()[0];
check(scene?.getName() === 'Scene', `scene named "Scene" (got "${scene?.getName()}")`);
const drone = byName.get('drone');
check(!!drone && scene.listChildren().includes(drone), 'root node "drone" is a scene child');

const tris = (node) =>
  node
    .getMesh()
    .listPrimitives()
    .reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);

for (const [name, expected] of Object.entries(EXPECTED_TRIS)) {
  const node = byName.get(name);
  const got = node?.getMesh() ? tris(node) : null;
  check(got === expected, `${name.padEnd(14)} ${String(got).padStart(6)} tris (expected ${expected})`);
}

for (const [pivot, child] of Object.entries(PIVOTS)) {
  const p = byName.get(pivot);
  check(
    !!p && !p.getMesh() && p.getParentNode() === drone && p.listChildren().some((c) => c.getName() === child),
    `${pivot} is a mesh-less pivot under drone with child ${child}`,
  );
}
for (const name of ['body', 'payload'])
  check(byName.get(name)?.getParentNode() === drone, `${name} is a child of drone`);

for (const [name, want] of Object.entries(ROTOR_EXTRAS)) {
  const got = byName.get(name)?.getExtras() ?? {};
  check(got.motor === want.motor && got.spin === want.spin, `${name} extras motor=${got.motor} spin=${got.spin}`);
}

for (const [name, want] of Object.entries(ROTOR_PIVOTS)) {
  const got = byName.get(name)?.getTranslation() ?? [NaN, NaN, NaN];
  const ok = got.every((v, i) => Math.abs(v - want[i]) <= PIVOT_TOLERANCE_M);
  check(ok, `${name} pivot [${got.map((v) => v.toFixed(4)).join(', ')}] m`);
}

const extras = drone?.getExtras() ?? {};
for (const k of ROOT_EXTRAS) check(k in extras, `drone.extras.${k} present`);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
check(isVec3(extras.mounts?.fpvCam), `mounts.fpvCam = ${JSON.stringify(extras.mounts?.fpvCam)}`);
check(isVec3(extras.mounts?.hdCam), `mounts.hdCam = ${JSON.stringify(extras.mounts?.hdCam)}`);
check(extras.propDiameterM === 0.1778 && extras.bladeCount === 3, 'propDiameterM 0.1778, bladeCount 3');

const mats = docRoot.listMaterials();
check(mats.length === 1 && mats[0].getDoubleSided(), 'single material, doubleSided preserved');
check(
  !!mats[0]?.getOcclusionTexture() && mats[0].getOcclusionTexture() === mats[0].getMetallicRoughnessTexture(),
  'occlusion shares the metallicRoughness (ORM) texture',
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall asset checks passed');
