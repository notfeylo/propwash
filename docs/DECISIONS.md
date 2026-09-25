# Decisions

Places where the spec met reality, and what was chosen.

## 2026-09-24 · TypeScript pinned to 6.0.x

`pnpm add -D typescript` resolves to 7.0, but `typescript-eslint` 8.x declares `typescript >=4.8.4 <6.1.0`. Pinned `typescript@~6.0` so lint and typecheck share one compiler. Revisit when typescript-eslint supports 7.

## 2026-09-24 · `drone.glb` is generated at build time, not committed

§3.2 marks `public/models/drone.glb` as generated. It is git-ignored and rebuilt by `pnpm assets` in CI and in the Vercel build (`vercel.json` `buildCommand`), from the committed source in `assets-src/drone/`. One source of truth; no stale binary in git.

## 2026-09-24 · Immutable caching on unhashed public paths

§3.3 asks for `Cache-Control: public, max-age=31536000, immutable` on `/models/*`, `/audio/*`, `/hdri/*`. Unlike `/assets/*`, those URLs are not content-hashed, so a changed `drone.glb` would stay stale in returning browsers for a year. Implemented as specified for now. When an asset first changes after launch, load it with a content-hash query (`drone.glb?v=<hash>`, written by `build-assets`) or move it under a hashed path.

## 2026-09-24 · Placeholder viewer ahead of Task 2

Task 1 needs visual proof that the pipeline output loads. `src/app/App.ts` is a minimal viewer (WebGPURenderer, hemisphere + key light, OrbitControls) that Task 2 replaces with the bench scene and post pipeline.

## 2026-09-24 · Audio cuts deferred to Task 5

§4.5 puts the ffmpeg cuts in `build-assets.mjs`. They are added with the audio engine in Task 5, together with the skip-when-mp3-absent path CI needs.

## 2026-09-24 · KTX2 stretch not done

`toktx` is not installed on the dev machine, so textures ship as WebP (2.68 MB total). KTX2 stays a P1 stretch.

## 2026-09-24 · Deployed at propwash-sim.vercel.app

`propwash.vercel.app` belongs to another Vercel account, so the project uses the §3.3 fallback, `propwash-sim.vercel.app`. The Vercel project is connected to the GitHub repo, so PRs get preview deploys.

## 2026-09-24 · Soft shadows use PCF + radius, not PCFSoftShadowMap

three r186's WebGPURenderer removed `PCFSoftShadowMap` (it logs a warning and falls back). `PCFShadowMap` now samples a rotated Vogel disk scaled by `shadow.radius`, and TRAA resolves the rotation noise, so `LIGHTS.key.shadowRadius` sets the softness.

## 2026-09-24 · Floor fades into the backdrop by distance from the pad

A floor edge dithered with alpha hash showed as a noisy band at the horizon. Instead the scene fog blends the floor into the exact background color behind each pixel (the gradient, or the blurred HDRI sampled along the view ray), with a factor based on distance from the pad (`ENVIRONMENT.horizonFog`), not view depth. Nothing within 1.2 m of the pad is fogged, so the drone is never affected.

## 2026-09-24 · 1k HDRI

§4.2 allows 1k or 2k. The 2k file is 6.3 MB, which with the 2.7 MB drone would break the 8 MB initial-download budget. The 1k file (1.6 MB) is used for IBL and the blurred backdrop, where the extra resolution isn't visible.

## 2026-09-24 · Auto quality can't see headroom above the refresh rate

Frame time is measured from requestAnimationFrame, which is vsync-capped. On a 60 Hz display a fast GPU and a just-keeping-up GPU both measure ~16.7 ms and get High. Ultra is only auto-picked when frames come faster than 9 ms (high-refresh displays). Settings can override it (Task 8), and `?quality=` does today.

## 2026-09-24 · Canister straps hide with the payload

`tools/split-drone.mjs` (verified, not to be rewritten) leaves the canister's two mounting straps in `body`. Hiding the payload left them dangling to the pad, and they set the PRD's "frame bottom ≈ −0.004 m". `DroneModel` finds those loose parts at load (body parts inside the canister's footprint that reach below `DRONE.payloadStrapBelowY`, 528 tris) and toggles them with the canister. The `.glb` and the §4.1 tri counts are unchanged. With the payload hidden, the lowest point is now the bottom plate at +0.052 m, so the frame rests on the pad.

## 2026-09-24 · Hub and blades split at runtime by radius

§4.3 says to fade the real prop mesh, but the rotor mesh also holds the bell, adapter and nut, which must stay solid and visibly spin. At load, `Rotor` splits each rotor's triangles by distance from the motor axis (`DRONE.hubRadiusM`, 17 mm: every hub vertex is inside 15 mm, and blades reach 89 mm) into hub and blade meshes that share vertex buffers. Only the blades fade, ghost and turn into the disc.

## 2026-09-24 · Translucent prop layers don't write velocity

Velocity is an MRT attachment blended with each material's blending. Smear ghosts and the blur disc turn fast, so they stamped rotor motion onto whatever they covered, and TRAA then reprojected those surfaces from the wrong place (the canister behind a prop looked washed out). Those materials write velocity with alpha 0 (`src/drone/velocity.ts`), which keeps the velocity of the surface behind. Fading blades use the same override only while they're translucent.

## 2026-09-24 · Faded layers cast dithered shadows

Blade, ghost and disc shadows are masked in the shadow pass by a hash compared with each layer's opacity (`maskShadowNode`). A blade's shadow thins out as the blade fades instead of popping off, and the disc casts a faint shadow as §4.3 allows.

## 2026-09-24 · Blur disc gets a sheen lift

At the measured coverage (0.18), a dark carbon disc over the dark pad was nearly invisible, so the prop seemed to vanish when the smear handed off to the disc around 2,300–2,600 RPM. Blending scales the disc's lit specular by its alpha too, which removes the glints that make real blurred props visible. The disc color adds `PROP_DISC.sheenLift` (the time-averaged blade glints) to the sampled prop color. Coverage stays at the physical value.
