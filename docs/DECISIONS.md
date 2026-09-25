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

Seen from the side at hover, the flat disc then mirrored the studio softboxes as a crisp white hoop (Fresnel → 1 at grazing angles). The sheen band is wider and rougher and the disc's environment reflection is scaled by `PROP_DISC.envIntensity` (0.45), which leaves a soft sheen.

## 2026-09-24 · Motor overshoot: an underdamped tracker, not lag + spring

§4.4 asks for a first-order lag (τup 60 ms, τdown 120 ms) plus a small overshoot on throttle snaps. A spring following the first-order lag never overshot: the lag's approach is already smooth, so snaps measured −0.3%. While driven, RPM now follows the command as an underdamped second-order tracker with ζ = 0.78 and ωn = 1.84/τ. That reaches 63% at τ, like the PRD's lag, and a snap overshoots by ≈2% while slow sweeps don't ring (unit-tested). Coasting when unpowered is a plain exponential with τcoast.

## 2026-09-24 · One pitch reference for all tonal audio layers

§4.5 maps the recording (f₀ 294.7 Hz) to `rpmHover` = 11,000 but defines layer B as `BPF = rpm/60 × 3`, which is 550 Hz at 11,000 RPM. Layers A and B would be ≈11 semitones apart on every note. Layer B is pitched from the same reference as the recording: f = 294.7 Hz × rpm/rpmHover. So the synth and the recording agree, the measured harmonic profile applies as measured, and the procedural-only build (what ships) sounds like the recording path. Motor whine (C) stays physical at `rpm/60 × 7`. Also note: the §4.4 curve gives ≈12,600 RPM at 38% throttle, not the "≈11,000 ≈ 38%" in the text; hover is ≈32% on this curve.

## 2026-09-24 · The PRD's spool-down ffmpeg command produced silence

With `-ss` after `-i` (output seeking), ffmpeg filters the whole file before trimming, so `afade=t=out:st=2.4` faded at 2.4 s of the _source_ and the 11.2–13.9 s clip came out at −91 dB. The one-shots now seek on the input (`-ss/-to` before `-i`), which makes fade times relative to the cut. The loop keeps output seeking for sample-exact cuts. Verified levels: loop −23.3, spool-up −20.2, spool-down −20.7 dB mean.

## 2026-09-24 · Audio gain staging, beating, and the recording's level

- Four near-unison voices summed almost coherently and drove the master compressor hard, so loudness plateaued above ≈5k RPM. Each motor voice now has a trim (`AUDIO.master.motorTrim`) and the compressor is gentle (−12 dB, 2.5:1).
- Identical waveforms at ±1% RPM beat as one comb, with deep simultaneous nulls (phasing). Each voice's PeriodicWave has the measured harmonic magnitudes with its own random phases, so each harmonic beats independently. Some beating remains by design (§4.4: "what produces the natural audio beating").
- The recording sits at ≈ −23 dBFS while the synth is near full scale, so handing off from B to A lost ≈9 dB. The loop is normalized to the synth's RMS at load.
- Layer E is set so a full-strength rip sits at the motor body's level; the verifier measures +30 dB in 1–6 kHz over the 80 ms after a snap vs. E muted.

## 2026-09-24 · How the audio criteria are measured

`pnpm verify:audio` renders sessions offline and measures them (`docs/verification/audio/README.md`). Level is the mean power over both ears, not a mono downmix, because summing L+R creates cancellations no listener hears. Loudness uses EBU-style 400 ms short-term windows. Pitch tracking passes at a median under 25 cents with ≥85% of frames within 50 cents; the recording path carries the recording's own slight pitch wander. The coast check requires ≥6 dB down after 1 s and silence once stopped, because one window can sit ±3 dB off the RPM curve while the motors beat.

## 2026-09-24 · Minimal keyboard input ahead of Task 7

Tasks 4–5 can't be tried without plugging in, arming and throttling, so the §4.7 keys they need (P, Space, X, W/S with Shift, 0, B, L) are live now, producing the §4.7 `ControlState`. Task 7 adds gamepad, RC radio, bindings and the input visualizer on top. A one-line key hint replaces the audio prompt until Task 8's HUD.

## 2026-09-24 · First spin-up hitch: warm the prop pipelines at load

The first arm froze for ≈290 ms at ≈400 RPM, when the blades switched to their translucent variant and the ghosts and disc first drew, compiling new GPU pipelines mid-frame (the sim then lost time to the 100 ms dt clamp). At load the rig now renders those variants once at zero opacity. The velocity MRT override is also a single shared node, because pipelines are keyed by node identity and a fresh node recompiled on every fade. The worst frame from arm to full throttle is now 18–30 ms.

## 2026-09-25 · Camera feeds render at the screen's aspect and crop the video box

§4.6 asks for a 4:3 analog and 16:9 digital/HD feed. Rendering the scene at the feed's aspect doesn't survive TRAA: its sub-pixel jitter calls `camera.setViewOffset`, which resets `camera.aspect` to the drawing buffer's every frame. So one render camera always matches the screen, and its FOV is set so the feed's video box (pillar- or letterboxed) spans the lens's horizontal FOV (125° FPV, 118° HD). The final camera-look pass crops that box, applies the barrel, and paints the bars black. On a 16:9 screen the 4:3 analog feed renders ≈25% of pixels that end up in the bars; in exchange pixels map 1:1 and every view shares one TRAA/GTAO/Bloom chain.

## 2026-09-25 · Barrel normalized on the diagonal

The ≈155° fisheye look is a barrel pass over the 125° rectilinear render. Normalizing it so the horizontal edge stays put pushed the corners outside the render and left black corners on a 4:3 frame. It is normalized on the diagonal instead: corners map to corners, the centre is magnified and straight lines bow. The horizontal field shrinks a little (≈121° at the analog frame's edge), which reads closer to real FPV cameras that crop inside the image circle.

## 2026-09-25 · Unpowered FPV shows goggle "NO SIGNAL" over snow

§4.4 says unplugging leaves the OSD at "NO SIGNAL" static. With the VTX off there's no OSD from the flight controller, so the view shows what goggles do: analog snow (digital: black) with a centred "NO SIGNAL". The OSD returns once the battery is plugged in. The HD camera is self-powered, like a GoPro, so it keeps recording while the drone is off.

## 2026-09-25 · Camera cuts don't reset TRAA history

A 150 ms cut dips through black and switches views at its midpoint. TRAA's history isn't cleared at the switch (three r186 has no public reset; forcing one reallocates render targets, a hitch). Reprojection with the new camera's velocity rejects nearly all old samples, and what's left is under the fade.

## 2026-09-25 · Throttle follows the device used last

§4.7 asks for one ControlState per frame, whatever the device. Actions from every device apply (a keyboard P and a pad R1 both work), but throttle and sticks come from the device touched most recently: a key press, a pad button or stick past 20%, or a calibrated radio stick. Switching back to the keyboard starts W/S from the throttle the pad left, so it never jumps. Unplugging the active pad hands control back to the keyboard.

## 2026-09-25 · R2 stays the default pad throttle

A PS4 stick self-centers, so the Mode 2 left-stick throttle rests at 50%, above the 5% arming limit. R2 stays the bench default. `GAMEPAD.throttleSource = 'stick'` switches to the stick, and `throttleHold` makes it accumulate (push up to raise, let go to hold) as §4.7 allows. The settings UI (Task 8) exposes both.

## 2026-09-25 · Stick shaping: radial deadzone, then per-axis expo

A radial deadzone keeps diagonals pointing the right way. Rescaling the radius and clamping each axis lets a full diagonal reach both corners; capping the radius at 1 would have limited full roll plus full pitch to 71% each.

## 2026-09-25 · Radio arm switch is level-triggered

A radio's arm switch is a position, not a button. Flipping it on sends an arm request, which is refused with the same THROTTLE / BOOTING / NO POWER reasons, and flipping it off disarms. As in Betaflight, a refused arm needs the switch cycled. The first reading after a radio connects only records the switch, so plugging in a radio with the switch already on never arms. Calibration is per device id in `localStorage` and falls back to session-only when storage is blocked.

## 2026-09-25 · The HUD stays out of the FPV and HD views

§4.8 keeps the UI out of the FPV view except the OSD. The key hint and input widget show only in the orbit view, and H hides them there too. Toasts still appear in every view, because they explain refused commands.

## 2026-09-25 · Weak rumble follows the square root of motor load

Mapping the weak motor linearly to average RPM / rpmMax made idle (2,400 RPM, ≈7%) imperceptible. The square root gives idle a faint hum and full throttle `HAPTICS.weakMax`. Strong pulses mark the ESC tones (a longer buzz), arming, disarming and a refused arm. Rumble goes only to the active pad, so a controller lying on the desk stays quiet while someone uses the keyboard.

## 2026-09-25 · Motor test runs disarmed, like Betaflight's Motors tab

§4.8 models the panel on the Betaflight Configurator Motors tab, where motors spin while the craft is disarmed and arming is blocked. The powertrain drives each motor from its slider only while the battery is plugged in, the drone is disarmed, the panel is open and the safety box is ticked. A 0% slider is stopped, not idle. Closing the panel, unticking the box or unplugging lets the motors coast. Arming while the test is on is refused with a toast. Audio and battery load treat test spinning as driven.

## 2026-09-25 · Settings persist per browser and override config defaults

Settings (§4.8) start from the values in `src/config/*` and save to `localStorage` (session-only when storage is blocked). Stored values are merged key by key and type-checked, so a stale or hand-edited entry can't break startup. A `?quality=` URL parameter still wins over the saved preset, so tests and screenshots stay deterministic. Keyboard bindings are rebindable; binding a key removes it from any other action. Gamepad bindings are fixed to the §4.7 table (a reference is shown), with the throttle source, stick hold, deadzone, expo and rumble adjustable.

## 2026-09-25 · Settings gets the O key

§4.7's key table has no settings key. O opens and closes Settings (Escape closes either panel). The HUD also has MOTORS and SETTINGS buttons. Like the rest of the HUD they hide in the FPV and HD views, but the keys and the touchpad work in every view.
