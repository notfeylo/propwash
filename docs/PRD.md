# PROPWASH — PRD v1.0

> Open-source, browser-based FPV drone simulator built for realism.
> **Today's scope (Phase 1, "Alive on the Bench"):** public repo, production scaffold, Vercel deploy, and a drone that powers on, beeps, arms, spools props smoothly, sounds real, and has working FPV/HD camera views. **It does not fly yet.**

Owner: Huzaif Ahmed (`notfeylo`) · Date: 2026-09-24

---

## 0. Implementation rules

1. Read this whole file before writing code. The numbers in §2 were **measured from the real assets**, not guessed. Use them as given.
2. Work phase by phase and task by task (§4). Commit after each task using Conventional Commits.
3. **Verify visually.** After every rendering or animation task, run the app, take Playwright screenshots, and look at them. The asset pipeline has already produced invisible-mesh and wobbling-pivot bugs once (§2.3), so never assume a change worked.
4. Put tunable values in `src/config/*.ts`, never inline them.
5. Don't add features beyond this phase. Log ideas in `docs/BACKLOG.md`.
6. If a requirement conflicts with reality (an API limit or an asset problem), stop and write the conflict in `docs/DECISIONS.md` along with your choice.

---

## 1. Decisions (final)

| Item | Decision | Why |
|---|---|---|
| **Name / repo** | `PROPWASH` · `github.com/notfeylo/propwash` (public) | FPV pilots already know the term, it's short, and it works as a domain. |
| **Platform** | **Web first** (Vite + TypeScript + Three.js r186 WebGPU), deployed on **Vercel**. Tauri v2 desktop wrapper later (Phase 6). | Anyone can use it from a link, with no install. The Gamepad API handles PS4/PS5 and USB RC radios. Web Audio is enough for the procedural motor audio. Contributors only need `npm i`. Tauri reuses 100% of the code later. |
| **Renderer** | `three/webgpu` `WebGPURenderer` (falls back to WebGL2 automatically) + TSL `RenderPipeline` post-processing | r186 ships GTAO, SSGI, SSR, TRAA, Bloom, MotionBlur, ChromaticAberration, Film, CRT, Godrays, Lensflare, DoF, and Lut3D nodes. That's everything the realism roadmap needs. |
| **Language / tooling** | TypeScript strict, Vite, ESLint + Prettier, Vitest (unit), Playwright (visual smoke), pnpm | Standard and contributor-friendly. |
| **Code license** | **MIT** | Maximizes forks and contributions. |
| **Asset licenses** | Drone model: **CC-BY-4.0** (attribution required, commercial OK). Audio: **UNVERIFIED** (see §7). HDRIs: CC0 (Poly Haven). | Listed per file in `CREDITS.md`. |
| **Physics (Phase 2+)** | Custom 6-DoF rigid-body flight model in TS, fixed 500 Hz sub-step. Rapier (WASM) only for collisions. | Game engines' generic physics can't reproduce real quad feel. |
| **Units / axes** | Meters, seconds, radians. **Y-up, nose = −Z** (matches the three.js camera convention). | The asset is already baked to this convention. |

**Honest ceiling:** the drone close-up can look photoreal on the web (PBR, 4K textures, HDRI, GTAO, TRAA). Photoreal **large jungle environments** that are indistinguishable from real footage are the hardest part. The plan for that is Phase 3 (§6): Gaussian-splat captured environments and a decision gate on whether to port to Unreal Engine 5.

---

## 2. Verified asset facts (measured, 2026-09-24)

### 2.1 Drone model — `fpv-dron_nonstop.zip`
- **Source:** "FPV-dron_NonStop" by Viktor_ — https://sketchfab.com/3d-models/fpv-dron-nonstop-c75dea6e3ae441ac87f292efb17f5bae — **CC-BY-4.0**
- **Files:** `scene.gltf`, `scene.bin` (1.36 MB), `textures/Scene_-_Root_{baseColor,metallicRoughness,normal}.png`, each 4096², ~20 MB total, plus `license.txt`
- **Structure problem:** the whole drone is **one mesh, one primitive, one material, and has no animations**. The props **cannot spin** until the mesh is split.
- **Geometry:** 22,056 verts · 24,713 tris · **230 loose parts**. The props, bells, and antenna are separate loose parts, so they can be split out cleanly.
- **Material:** `doubleSided: true`. Occlusion is packed into the R channel of the metallicRoughness texture (ORM). **Both must be preserved**; losing `doubleSided` makes the thin props disappear.
- **Configuration (derived from geometry):**
  - 7″ long-range quad-X, **tri-blade props**. Frame and props are dark carbon, the battery is a blue cylinder-cell pack (6S-style, strapped on top), there's a rear-mounted whip antenna, a front FPV camera, and an **underslung cylindrical payload canister** under the frame.
  - **Props-in, Betaflight default order** (verified from blade pitch):

    | Motor (BF #) | Position | Spin (viewed from above) | three.js `rotation.y` sign |
    |---|---|---|---|
    | M1 | Rear-Right | CW | − |
    | M2 | Front-Right | CCW | + |
    | M3 | Rear-Left | CCW | + |
    | M4 | Front-Left | CW | − |
- **Scale:** the raw file is in arbitrary units. Prop diameter is 0.4624 u, so a 7″ (0.1778 m) prop gives **0.3845 m/u**. After the split, the drone is **0.398 W × 0.424 L × 0.217 H m**, with a motor-to-motor diagonal of 0.347 m.
- **Rotor pivots (meters, after split):** (±0.1217, 0.0700, ±0.1233). **Prop radius 0.0889 m.**
- **Lowest point:** the payload canister bottom sits at y = −0.012 m. With the payload hidden, the frame bottom is at y ≈ −0.004 m. Compute the ground offset at runtime from the bounding box of the visible parts.

### 2.2 Audio — `Drone_Flying_Sound_Effect.mp3`
- 15.1 s, 44.1 kHz stereo, 192 kbps. **Unknown provenance, so verify the license before any public commit (§7).**
- Timeline (from RMS + spectrogram):

  | Segment | Time | Content |
  |---|---|---|
  | Spool-up | 0.0 – 2.5 s | Pitch rises from ~180 → ~295 Hz |
  | **Steady (loop source)** | **2.5 – 10.5 s** | Fundamental **f₀ ≈ 294.7 Hz**; RMS −22.5 dB at both ends, so it loops cleanly |
  | Spool-down | 11.2 – 13.9 s | Pitch falls from ~290 → ~180 Hz |
  | Silence | 13.9 – 15.1 s | Discard |
- **Harmonic profile of the steady tone** (amplitudes relative to f₀, harmonics 1–10):
  `[1.0, 0.768, 0.408, 0.255, 0.237, 0.248, 0.163, 0.115, 0.092, 0.128]`
  Sub-f₀ energy is 0.048 and the 2–8 kHz noise floor is 0.034. Use these to build the procedural `PeriodicWave` (§4.5).

### 2.3 Pipeline gotchas (already hit, already solved)
1. **Meshopt quantization re-centers mesh nodes.** If the prop mesh node *is* the rotation node, the prop orbits its bounding-box center and wobbles. **Fix:** a mesh-less pivot node (`rotor_XX`) sits on the motor axis, with the mesh child (`rotor_XX_mesh`) under it. Spin only the pivot node.
2. **`gltf-transform optimize` prunes empty leaf nodes**, so camera-mount empties get deleted. **Fix:** store mounts in `drone.userData.mounts` (glTF extras on the root node).
3. **`optimize` simplifies geometry by default.** Always pass `--simplify false`.
4. **Texture size:** `optimize` downsizes to 2K by default. Pass `--texture-size 4096` for the hero asset.
5. **Name collision:** the scene and root node were both named `drone`, so GLTFLoader renamed one. The scene is now named `Scene`.

---

## 3. Repository setup (Task 0)

### 3.1 Create and publish
```bash
gh repo create notfeylo/propwash --public --description "Open-source, browser-based FPV drone simulator built for realism. Three.js WebGPU + Web Audio." --clone
cd propwash
pnpm create vite@latest . --template vanilla-ts
pnpm add three@0.186.1
pnpm add -D @types/three @gltf-transform/core@^4.5 @gltf-transform/cli@^4.5 gl-matrix@^3.4 \
  vitest @playwright/test eslint prettier typescript-eslint
```
Add the topics `fpv`, `drone`, `simulator`, `threejs`, `webgpu`, `web-audio`, `betaflight`, `gamepad`.

### 3.2 Structure
```
propwash/
├─ assets-src/                  # raw source assets (committed; each <100 MB, so no LFS yet)
│  ├─ drone/                    # unzipped Sketchfab files + license.txt
│  └─ audio/                    # original mp3 + LICENSE-NOTE.md
├─ public/
│  ├─ models/drone.glb          # generated (tools/split-drone.mjs + optimize)
│  ├─ audio/                    # generated clips (see §4.5)
│  └─ hdri/                     # CC0 HDRIs (1k/2k .hdr)
├─ tools/
│  ├─ split-drone.mjs           # §4.1 (provided, verified)
│  ├─ build-assets.mjs          # runs split → optimize → audio cuts; `pnpm assets`
│  └─ verify-assets.mjs         # asserts node names, tri counts, extras, sizes
├─ src/
│  ├─ main.ts
│  ├─ app/                      # App bootstrap, loop, resize, visibility pause
│  ├─ render/                   # renderer, RenderPipeline, lighting, env, bench scene
│  ├─ drone/                    # DroneModel, Rotor, PropBlur, Antenna, LEDs
│  ├─ sim/                      # MotorModel, PowerStateMachine, Battery (Phase 1: no flight)
│  ├─ audio/                    # AudioEngine, MotorVoice, Beeper, loop builder
│  ├─ input/                    # InputManager, KeyboardMouse, Gamepad, RCRadio, bindings
│  ├─ cameras/                  # OrbitCam, FpvCam, HdCam, CameraDirector
│  ├─ ui/                       # OSD (canvas), HUD, MotorTestPanel, Settings, Credits
│  └─ config/                   # drone.ts, motor.ts, audio.ts, input.ts, render.ts
├─ tests/                       # vitest unit + playwright visual smoke
├─ docs/  PRD.md · DECISIONS.md · BACKLOG.md · ARCHITECTURE.md
├─ .github/  workflows/ci.yml · ISSUE_TEMPLATE/ · PULL_REQUEST_TEMPLATE.md · dependabot.yml
├─ README.md · LICENSE (MIT) · CREDITS.md · CONTRIBUTING.md · CODE_OF_CONDUCT.md (Contributor Covenant 2.1)
└─ vercel.json
```

### 3.3 Required files
- **README.md:** a hero GIF, the live link, controls table, `pnpm i && pnpm assets && pnpm dev`, roadmap, credits.
- **CREDITS.md:** paste the model credit **verbatim**, plus "Changes were made: split into parts, re-scaled to meters, textures re-encoded." Repeat the credit in-app under Settings → Credits.
- **CI (`ci.yml`):** on PR and push → `pnpm i --frozen-lockfile`, `lint`, `typecheck`, `vitest`, `pnpm assets && node tools/verify-assets.mjs`, `build`, and a Playwright smoke test (page loads, canvas renders non-blank, no console errors).
- **vercel.json:** SPA rewrite to `/index.html`. `Cache-Control: public, max-age=31536000, immutable` for `/assets/*`, `/models/*`, `/audio/*`, `/hdri/*`.
- **Deploy:** connect the repo in the Vercel dashboard (preferred; gives preview deploys per PR) or run `vercel --prod`. Target `propwash.vercel.app`, falling back to `propwash-sim.vercel.app`.

---

## 4. Phase 1 — "Alive on the Bench" (today)

The drone sits on a landing pad in a clean studio/bench scene. The user can plug in the battery, hear the ESC tones, arm it, move the throttle, and watch and hear the props spool up and down. They can inspect it in orbit view, look through the FPV camera with an OSD, and switch to the HD "GoPro" view. **No lift and no flight.**

### 4.1 Asset pipeline (Task 1)
- Copy the verified script below to `tools/split-drone.mjs`.
- `tools/build-assets.mjs` runs:
  ```bash
  node tools/split-drone.mjs assets-src/drone/scene.gltf public/models/drone.raw.glb
  npx gltf-transform optimize public/models/drone.raw.glb public/models/drone.glb \
    --compress meshopt --texture-compress webp --texture-size 4096 \
    --simplify false --join false --instance false --flatten false
  rm public/models/drone.raw.glb
  ```
  Verified output: **2.68 MB** (down from 21.3 MB). Load it with `GLTFLoader` + `MeshoptDecoder`.
- **Stretch (P1):** KTX2 textures (UASTC for the normal map, ETC1S for baseColor/ORM) via `--texture-compress ktx2` if `toktx` is installed. They take ~4× less VRAM than WebP. Add a `?tex=webp|ktx2` switch.
- **Expected split output** (verify-assets must assert these):

  | Node | Tris | Notes |
  |---|---|---|
  | `body` | 14,616 | frame, stack, battery, cam, wires |
  | `payload` | 3,393 | underslung canister + mount rails; togglable |
  | `antenna` → `antenna_mesh` | 440 | pivot at the whip base; sways |
  | `rotor_RR/FR/RL/FL` → `*_mesh` | 1,566 each | prop + bell + prop adapter + nut + bell decals |
  | extras on `drone` | — | `mounts.fpvCam`, `mounts.hdCam`, `propDiameterM`, `bladeCount`, `layout`, `credit`, `source` |

```js
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
```

### 4.2 Scene and rendering (Task 2)
- `WebGPURenderer({ antialias: false })` with post-AA. Use `renderer.setPixelRatio(min(devicePixelRatio, 2))` and a dynamic resolution scale in `config/render.ts`.
- **Tone mapping:** AgX, exposure 1.0. **Color:** sRGB output.
- **Environment:** a CC0 HDRI from Poly Haven (studio or soft-overcast outdoor, 2k `.hdr`) for IBL and reflections. Background is either blurred HDRI or a neutral gradient (toggle).
- **Lights:** one key `DirectionalLight` with soft shadows (shadow map 2048, fitted tightly to the drone ±0.6 m), plus the HDRI fill. Every drone mesh has `castShadow` and `receiveShadow` enabled.
- **Bench set:** a ground plane with a round landing-pad texture generated procedurally in canvas (original design, no logos). Use slightly worn, rough PBR for the pad and concrete for the floor.
- **Post pipeline (`RenderPipeline`):** scene pass (MRT: color, normal, depth, velocity) → **GTAO** → **TRAA** → **Bloom** (threshold high; only LEDs and hot specular should glow) → tone map. Camera-specific effects are in §4.6.
- **Quality presets:** `Low / Medium / High / Ultra`, auto-picked from the first 120 frames of frame time and overridable in Settings.
- **Budgets:** 60 fps at 1440p on an RTX 3060 / M1-class GPU on High; ≥ 30 fps on integrated graphics on Low. Initial download ≤ 8 MB. First frame in ≤ 3 s on a 50 Mbps connection.

### 4.3 Drone rig (Task 3)
`DroneModel` loads `drone.glb` and exposes:
- `rotors[4]`: `{ pivot: Object3D, mesh, motorIndex, spinSign (+1 CCW / −1 CW), angle, rpm }`, where `spinSign` comes from `userData.spin`.
- `antenna`, `payload`, `mounts.fpvCam`, `mounts.hdCam` (from `drone.userData.mounts`).
- `setPayloadVisible(bool)` (default **on**, matching the source model; the Freestyle/Race presets hide it). Recompute the ground offset when it changes.

**Rotor animation**
- Integrate the angle every frame: `angle += spinSign * (rpm / 60) * 2π * dt`, then wrap mod 2π. Do **not** set rotation from wall-clock time.
- **Prop visual blending** (the fix for temporal aliasing): a 3-blade prop repeats every 120°, so at 60 fps anything above roughly 600 RPM strobes. Handle it in three stages:
  1. **< 400 RPM:** the real mesh only.
  2. **400 – 2,500 RPM:** real mesh + **sub-frame smear**. Draw N = 6–8 ghost copies of the prop mesh (InstancedMesh, same geometry) spread over the angle travelled this frame, with alpha 1/N. Fade the real mesh down across this range.
  3. **> 2,500 RPM:** **PropBlur disc**. A `RingGeometry(0.012, 0.0889)` on the rotor plane with a TSL material:
     - alpha = blade angular coverage (~0.18 for this prop) × a radial profile (dense at the hub, thinning at the tips)
     - color = sampled from the prop baseColor
     - a faint slow-rotating "ghost blade" streak at the aliased rate, plus a subtle specular sheen band
     - does not write depth and casts no shadow (or a dithered shadow)
  Crossfades between stages must be smooth, with no popping. All thresholds live in `config/drone.ts`.
- **Motor bells** spin with the prop because they're in the same group, so the bell decals should visibly rotate at low RPM.

**Secondary life**
- **Body vibration:** micro jitter of ±0.15 mm and ±0.05°, scaled by `(rpm/rpmMax)²`, with per-motor phase noise. It should be visible in the FPV view as slight shake, never cartoonish.
- **Antenna sway:** a damped spring on `antenna.rotation.x/z` (k ≈ 60, ζ ≈ 0.15). It's driven by vibration plus body acceleration, and later by airflow.
- **LEDs:** add small emissive meshes (original parts, not in the source model): an FC status LED (blue: solid when powered, blinking when armed), a VTX LED (red/green), and an optional rear LED strip (off by default). They should bloom slightly.

### 4.4 Motor and power model (Task 4)
No flight yet. This is RPM and state only.

**Config defaults (`config/motor.ts`), for a typical 7″ long-range build:** motor 2807, 1300 KV, 12N14P (7 pole pairs), 6S battery (25.2 V full, 3.5 V/cell min), 3-blade 7″ props.

- `rpmMaxNoLoad = KV × Vbat`, which is about 32,760 at full charge.
- `rpmTarget = rpmIdle + (rpmMaxLoaded − rpmIdle) × curve(throttle)`, where `rpmMaxLoaded ≈ 0.75 × rpmMaxNoLoad`, `curve(x) = x^0.8` (tunable), and `rpmIdle ≈ 2,400` (DShot idle 5.5%).
- **Motor response:** first-order lag with separate time constants, `τup = 0.06 s` and `τdown = 0.12 s`. Add a small overshoot (a spring term) on throttle snaps.
- **Per-motor variance:** ±0.7% RPM noise at 3–8 Hz plus a fixed ±0.3% offset per motor. Real motors never match, and this is what produces the natural audio beating.
- **Hover reference:** `rpmHover ≈ 11,000` (≈ 38% throttle). The audio sample is mapped to this value (§4.5).
- **Battery (cosmetic):** voltage sags with `I ≈ k·Σrpm³` and the mAh counter climbs. Both feed the OSD.

**Power / arming state machine (`PowerStateMachine`)** — Betaflight-faithful:
```
OFF ──plug──▶ BOOTING ──(ESC init tones done ≈1.2 s)──▶ DISARMED
DISARMED ──arm (throttle ≤ 5%, no failsafe)──▶ ARMED (rotors → idle in ~150 ms, slight stagger 0–40 ms)
ARMED ──throttle──▶ SPINNING (rpm follows throttle)
ARMED/SPINNING ──disarm | kill──▶ DISARMED (rotors coast down freely: τcoast ≈ 0.9 s for 7″)
DISARMED ──unplug──▶ OFF (LEDs off, OSD "NO SIGNAL" static)
Any ──arm attempted with throttle > 5%──▶ stays DISARMED + OSD "THROTTLE" warning + FC buzzer chirp
```
Optional "soft-arm" toggle: idle ramps over 600 ms instead of 150 ms.

### 4.5 Audio engine (Task 5): the part that sells it
Use the Web Audio API. Create the `AudioContext` lazily and resume it on the first user gesture (autoplay policy), with a "Click to power up audio" affordance. The listener follows the active camera.

**Asset prep (in `build-assets.mjs`, using ffmpeg):**
```bash
# Loop source: exact samples, lossless (MP3 encoder padding breaks gapless loops)
ffmpeg -i assets-src/audio/drone.mp3 -ss 2.5 -to 10.5 -ac 1 -ar 44100 public/audio/motor_loop.wav
ffmpeg -i assets-src/audio/drone.mp3 -ss 0.0 -to 2.5  -ac 1 -af "afade=t=in:d=0.05"  public/audio/spoolup.m4a
ffmpeg -i assets-src/audio/drone.mp3 -ss 11.2 -to 13.9 -ac 1 -af "afade=t=out:st=2.4:d=0.3" public/audio/spooldown.m4a
```
At load time, build a **crossfaded loop buffer** in code (equal-power 300 ms overlap of the tail into the head) so the loop is seamless.
If `assets-src/audio/drone.mp3` is absent (git-ignored until the license is cleared, §7), `build-assets` skips these cuts and the engine runs **procedural-only** (layers B–E + synthesized spool envelopes). Both paths must work, and CI tests the procedural-only path.

**Per-motor voice (×4, each positioned with an HRTF `PannerNode` at its rotor):**

| Layer | Source | Pitch / freq | Gain curve |
|---|---|---|---|
| A. Recorded body | `motor_loop` BufferSource, random start offset per voice | `playbackRate = clamp(rpm / rpmHover, 0.35, 2.2)` | `(rpm/rpmHover)^1.2` |
| B. Blade-pass tone | `OscillatorNode` with a `PeriodicWave` built from the **measured harmonics** `[1, .768, .408, .255, .237, .248, .163, .115, .092, .128]` | `BPF = rpm/60 × 3` | Rises steeply above idle; blends with A so pitch stays clean at extremes where A artifacts |
| C. Motor whine | sine + 2nd harmonic | `f_elec = rpm/60 × 7` | Low (−30 dB rel.), most audible at low RPM and on the bench |
| D. Air / prop wash | white noise → band-pass, center 600 Hz → 4 kHz tracking rpm, Q ≈ 0.7 | — | `(rpm/rpmMax)^2` |
| E. Transients ("fast reflexes") | filtered-noise burst + short pitch overshoot on layer B | triggered when `|d rpm/dt| > 25,000 rpm/s` | Scales with the rate of change; 60–180 ms |

- **Spool-up / spool-down one-shots:** crossfade them in when arming from zero or coasting down after disarm, with rate-matched pitch, then hand off to the loop.
- **Master bus:** per-voice gain → sum → `DynamicsCompressor` (gentle) → master gain → destination. Optional small-room `ConvolverNode` in the bench scene only (a procedurally generated IR, so no licensing issue).
- **Camera-dependent mix:** FPV view gives close, bright mic coloration with slight wind-noise low end. Orbit view uses distance-based air absorption (a low-pass that tracks distance).

**Beeps (synthesized):** real ESC tones come *out of the motors*, so play them through the four motor voices (spatialized), not a global speaker. Use a square wave → band-pass (1.5–4 kHz) + slight distortion to get the metallic motor-coil timbre.

| Event | Sound (defaults; tune by ear against real recordings) |
|---|---|
| Battery plug-in | XT60 "tick" + a tiny capacitor pop |
| ESC power-on | 3 ascending tones (~C6 → E6 → G6, 150 ms each) |
| Signal detected (~1 s later) | 2 tones, low → high, 120 ms each |
| Arm | none from the ESC (props just start); optional FC buzzer chirp (≈ 4 kHz piezo, 40 ms) |
| Disarm | FC buzzer: 2 short beeps |
| Arm refused | FC buzzer: 1 long low beep + OSD warning |
| Beacon (lost-model) | DShot beacon through motors: 1 beep/s until toggled off |
| Low battery | FC buzzer: repeating double beep |

All tone frequencies and durations go in `config/audio.ts` so they can be matched to real recordings later.

### 4.6 Cameras (Task 6)
`CameraDirector` cycles **Orbit → FPV → HD**, with Chase added in Phase 2.
1. **Orbit/Inspect (default):** `OrbitControls` with damping, distance 0.25–3 m, target at the drone's center. Optional slow idle auto-rotate. Mouse drag orbits, the wheel zooms, and right-drag pans.
2. **FPV (the "camera in front"):**
   - Positioned at `mounts.fpvCam`, parented to the body so it inherits vibration.
   - **Uptilt** 0–50° (default 25°). Near plane at 0.001 so the props in view render.
   - Render at ~125° horizontal rectilinear, then apply a **barrel-distortion pass** to emulate a ~155° fisheye.
   - **Feed styles:**
     - **Analog:** 4:3 crop, noise, scanlines, chroma bleed (RGB shift), slight vignette, occasional breakup driven by the future RSSI model; built from FilmNode, RGBShift, and a custom distortion node.
     - **Digital HD:** DJI O3/O4-like; clean 16:9 with mild sharpening.
   - **OSD overlay (canvas 2D, Betaflight layout, original monospace styling):** battery V (and per-cell average), mAh used, armed timer, throttle %, RSSI/LQ, flight mode, center "DISARMED" text, warnings, and a crosshair.
3. **HD / "GoPro" view:** at `mounts.hdCam`, 16:9, ~118° wide with a distortion profile. Optional rolling-shutter "jello" tied to vibration (off by default), plus a **REC indicator + timer**. A simple original action-cam mesh (no branding) on the top mount is P2.

Camera switches use a 150 ms cut with an optional quick whip-pan. Each camera has its own post-effect chain.

### 4.7 Input (Task 7)
`InputManager` produces one normalized `ControlState { throttle 0..1, yaw/pitch/roll −1..1, arm, kill, ...actions }` per frame, independent of the device. Phase 1 uses only throttle, arm, kill, and actions; the axes are recorded but not yet used.

**Gamepad (PS4 DualShock 4 / PS5 DualSense, Chrome `standard` mapping):**

| Control | Binding |
|---|---|
| Throttle (bench default) | **R2 analog** (0–1) |
| Throttle (Mode 2 stick, for flight) | Left stick Y, remapped bottom→top to 0–1; option to stay in place instead of self-centering (throttle-hold accumulator) |
| Yaw / Pitch / Roll | LX / RY / RX (Mode 2); expo and deadzone configurable |
| Arm / disarm (toggle) | R1 (only arms if throttle ≤ 5%) |
| Kill (instant disarm) | L1 + R1 |
| Battery plug / unplug | Options (hold 0.6 s) |
| Camera cycle / feed style | Triangle / Square |
| Beacon | Circle |
| Motor test panel | Touchpad |
| Payload toggle | Share/Create |

- **Haptics:** where supported (Chrome desktop), `vibrationActuator.playEffect('dual-rumble')` with the weak motor tracking average RPM and short strong pulses on ESC beeps. Degrade silently when unsupported.
- **RC radio (USB joystick; EdgeTX/OpenTX HID, e.g., Radiomaster):** detect it as a non-standard gamepad and run a **calibration wizard** (move each stick → auto-detect axes, inversion, and endpoints; store in `localStorage` wrapped in try/catch). This is how real pilots will fly, so it's a P1 in this phase.
- **Keyboard + mouse:**

  | Key | Action |
  |---|---|
  | P | Plug/unplug battery |
  | Space | Arm/disarm toggle |
  | X | Kill |
  | W / S (hold) | Throttle up/down at 60%/s; Shift for 150%/s |
  | 0 | Throttle to 0 |
  | C / V | Cycle camera / cycle feed style |
  | B | Beacon |
  | M | Motor test panel |
  | L | Payload toggle |
  | H | Hide UI |
  | F | Fullscreen |
  | Mouse | Orbit, zoom, pan |
- Show a device indicator and a live input-visualizer widget (two stick gimbals + switches) in the HUD.

### 4.8 UI (Task 8)
- **Minimal HUD:** state badge (OFF / BOOTING / DISARMED / ARMED), battery, per-motor RPM, current camera, device indicator, and an FPS counter (dev toggle).
- **Motor Test Panel** (modeled on the Betaflight Configurator Motors tab, original UI): a master slider plus 4 per-motor sliders and a safety "I understand the props are on" toggle. Live RPM readout and a spin-direction diagram showing M1–M4 CW/CCW. This is the main experiment tool in Phase 1.
- **Settings:** quality preset, uptilt, FOV, feed style, volume per layer (A–E + beeps), payload on/off, soft-arm, bindings, calibration, and **Credits**.
- **Style:** dark, tactile, instrument-like; no generic dashboard look. Keep the UI out of the FPV view except the OSD.

### 4.9 Acceptance criteria (Phase 1 is done when all pass)
- [ ] `github.com/notfeylo/propwash` is public with MIT LICENSE, CREDITS (model credit verbatim), README, CONTRIBUTING, CoC, templates, and green CI.
- [ ] Live on Vercel. The Playwright smoke test passes against the production URL.
- [ ] `verify-assets` passes: node names, tri counts (§4.1 table), mounts in extras, and `drone.glb` ≤ 3 MB.
- [ ] Top-down screenshots at rotor angles 0° and 60° show props rotating **about fixed bell centers** (no orbiting or wobble). Save them to `docs/verification/`.
- [ ] Spin directions match the §2.1 table (debug arrows toggle).
- [ ] Plug-in gives XT60 tick → 3 rising ESC tones → 2 ready tones, heard from the motor positions.
- [ ] Arming with throttle > 5% is refused with a warning. Arming at 0 brings the props to idle smoothly.
- [ ] Sweeping throttle 0 → 100% → 0 over 4 s gives continuous pitch and loudness, **no clicks, gaps, or phasing artifacts**, and smooth mesh → smear → disc transitions with no strobing or popping.
- [ ] A throttle snap (0 → 100% in < 100 ms) triggers audible transient "rip" layer E.
- [ ] Disarm at high RPM makes the props coast down over ~1 s with matching audio.
- [ ] FPV view shows the props in frame, vibration shake, OSD, and both feed styles. HD view works.
- [ ] PS4, PS5, keyboard, and at least one USB RC radio (or the simulated calibration test) all work. Rumble works in Chrome.
- [ ] Budgets from §4.2 are met on the High preset. No console errors.
- [ ] A 20 s screen-capture GIF (plug → arm → throttle sweep → FPV → disarm) is in the README.

---

## 5. Suggested task order for today
0 Repo + scaffold + CI + Vercel → 1 Asset pipeline + verify → 2 Scene/render → 3 Drone rig + prop blending → 4 Motor/power model → 5 Audio → 6 Cameras + OSD → 7 Input → 8 UI → final verification pass (§4.9) + README GIF.

---

## 6. Roadmap (after Phase 1)
| Phase | Goal | Key work |
|---|---|---|
| **2. Flight** | Real quad physics | 6-DoF rigid body, 500 Hz sub-steps. Thrust `T = kT·rpm²`, yaw torque `Q = kQ·rpm²`. Mixer (Betaflight quad-X). Rate controller with a PID sim (P/I/D/FF), **Betaflight "Actual" rates** + RaceFlight/KISS rate models, airmode, angle/horizon modes. Drag (body + induced), ground effect, prop wash oscillation on descents, battery sag limiting thrust, turtle mode. Chase cam. Doppler + wind/whoosh audio from airspeed. Flips, rolls, power loops, dives, landings. |
| **3. World** | The environment from the user's reference videos | **Clone the provided videos** frame by frame: jungle, grass, mountains, clouds, sky. Candidate stacks: (a) Three.js WebGPU terrain (heightmap + GPU-instanced grass/foliage + volumetric clouds + Godrays/atmosphere); (b) **Gaussian-splat captured real environments** (e.g., Spark renderer for three.js) with a proxy collision mesh, the most direct path to "can't tell it's real" on the web. **Decision gate:** A/B against the reference videos; if neither reaches the bar, prototype an **Unreal Engine 5** port for the environment. |
| **4. Modes** | Freestyle, Race, Long-range | Gates + timing + ghost replays; long-range with RSSI/LQ falloff, analog breakup, and GPS rescue sim; freestyle trick detection. |
| **5. Fidelity** | Pilots can't tell the difference | Record our own motor audio at fixed RPMs for a multi-sample RPM crossfade bank; real FPV camera LUTs; rolling-shutter prop artifacts; prop damage; crash physics. |
| **6. Desktop** | Native app | Tauri v2 wrapper (WebView2 on Windows supports WebGPU), native HID for radios, offline assets. |

---

## 7. Risks and open items
1. **Audio license (blocker for committing the mp3).** Source unknown. Until it's verified, keep it in `assets-src/audio/` **git-ignored**, ship only the procedural layers (B–E) in the public build, and add a `public/audio/README.md` explaining why. Replacement options: a CC0 recording, or our own recording (Phase 5).
2. **Payload canister.** It's part of the source model. It stays as a toggle (default on), and presets can hide it. There's no mechanic tied to it.
3. **Reference videos not yet provided.** Phase 3 depends on them.
4. **WebGPU availability.** WebGL2 fallback is automatic, but check TSL post effects on both backends. Don't use WebGPU-only features without a fallback path.
5. **VRAM from 4K WebP textures** (~64 MB each once decoded). KTX2 is the fix (§4.1 stretch).
6. **Gamepad mapping differences** between Firefox and Chrome and for non-standard devices. The calibration wizard is the universal fallback.
