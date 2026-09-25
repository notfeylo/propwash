// tools/build-assets.mjs — `pnpm assets`
// assets-src/ → public/: split the drone into animatable parts, then optimize it.
// Audio cuts (§4.5) are added in Task 5.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src/drone/scene.gltf');
const RAW = path.join(ROOT, 'public/models/drone.raw.glb');
const OUT = path.join(ROOT, 'public/models/drone.glb');
const GLTF_TRANSFORM = path.join(ROOT, 'node_modules/@gltf-transform/cli/bin/cli.js');

const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

if (!existsSync(SRC)) {
  console.error(`missing ${path.relative(ROOT, SRC)}: unzip fpv-dron_nonstop.zip into assets-src/drone/`);
  process.exit(1);
}

console.log('» split');
run([path.join(ROOT, 'tools/split-drone.mjs'), SRC, RAW]);

console.log('» optimize');
// Flags per PRD §2.3: never simplify, keep 4K textures, keep node hierarchy intact.
// prettier-ignore
run([
  GLTF_TRANSFORM, 'optimize', RAW, OUT,
  '--compress', 'meshopt',
  '--texture-compress', 'webp',
  '--texture-size', '4096',
  '--simplify', 'false',
  '--join', 'false',
  '--instance', 'false',
  '--flatten', 'false',
]);
rmSync(RAW);

console.log(`wrote ${path.relative(ROOT, OUT)} (${(statSync(OUT).size / 1e6).toFixed(2)} MB)`);
