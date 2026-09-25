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
