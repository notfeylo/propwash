# Architecture

Units are meters, seconds, radians. Axes are Y-up with the nose along −Z.

## Asset pipeline

```
assets-src/drone/scene.gltf
  └─ tools/split-drone.mjs ─────────▶ public/models/drone.raw.glb
       └─ gltf-transform optimize ──▶ public/models/drone.glb ──▶ tools/verify-assets.mjs
```

`split-drone.mjs` breaks the single Sketchfab mesh into loose parts and groups them:

```
Scene
└─ drone                     extras: mounts{fpvCam,hdCam}, propDiameterM, bladeCount, layout, credit, source
   ├─ body                   14,616 tris
   ├─ payload                 3,393 tris
   ├─ antenna                (pivot at whip base)
   │  └─ antenna_mesh           440 tris
   └─ rotor_RR|FR|RL|FL      (mesh-less pivot on the motor axis; extras: motor, spin)
      └─ rotor_XX_mesh        1,566 tris each
```

Spin only the pivot nodes. Optimizers re-center mesh nodes during quantization, so a mesh node used as the rotation axis would wobble.

## Render pipeline

```
opaque prepass (normals, depth) ──▶ GTAO ──┐ (indirect light only, builtinAOContext)
scene pass (MRT: color, velocity; depth) ◀─┘ ──▶ TRAA ──▶ + Bloom ──▶ AgX tone map + sRGB
```

Lighting is a CC0 studio HDRI (IBL + optional blurred backdrop) plus one soft-shadowed key light fitted to the drone. The floor fades into the backdrop by distance from the pad. Quality presets (`src/config/render.ts`) are auto-picked from early frame times, and a dynamic render scale holds frame time.

## Drone rig (`src/drone`)

```
drone_root            placed so the lowest visible part rests on the pad
└─ drone (body)       carries vibration; everything below shakes together
   ├─ body, payload + payload_straps, antenna → antenna_mesh (damped spring)
   ├─ rotor_XX (pivot, spins)
   │  ├─ rotor_XX_hub      bell, adapter, nut: always solid
   │  ├─ rotor_XX_blades   fades out from 400 → 2,500 RPM
   │  └─ rotor_XX_ghosts   8-instance sub-frame smear, 400 → 3,000 RPM
   ├─ rotor_XX_blur        disc in body space (does not spin), from 1,900 RPM
   ├─ mount_fpvCam, mount_hdCam
   ├─ leds                 FC, VTX, optional rear strip
   └─ spin_arrows          debug overlay (?arrows=1)
```

Rotor angles are integrated from RPM each frame (`angle += spinSign · rpm/60 · 2π · dt`). Stage weights are smoothsteps of RPM (`propWeights`), so every crossfade is continuous. The disc streak turns at the strobed (aliased) rate.

## Verification

- `pnpm test`: unit tests (blend continuity, aliasing, vibration bounds, antenna stability, quality picker).
- `pnpm test:e2e`: smoke test plus rig checks (pivots on the PRD axes, hubs fixed while turning, spin directions, stages by RPM, ground offset).
- `pnpm verify:visual [url]`: renders the §4.9 screenshots into `docs/verification/`. Set `CHANNEL=chrome` to use an installed Chrome with WebGPU.
- `window.__propwash` (see `src/app/debug.ts`) drives all of the above: freeze/step the sim clock, set RPM or rotor angles, toggle arrows, payload and LEDs, and project world points to pixels.

## Source layout

| Dir           | Responsibility                                               |
| ------------- | ------------------------------------------------------------ |
| `src/app`     | Bootstrap, main loop, resize, visibility pause               |
| `src/render`  | Renderer, RenderPipeline, lighting, environment, bench scene |
| `src/drone`   | DroneModel, Rotor, PropBlur, Antenna, LEDs                   |
| `src/sim`     | MotorModel, PowerStateMachine, Battery                       |
| `src/audio`   | AudioEngine, MotorVoice, Beeper, loop builder                |
| `src/input`   | InputManager, keyboard/mouse, gamepad, RC radio, bindings    |
| `src/cameras` | Orbit, FPV, HD cameras and the CameraDirector                |
| `src/ui`      | OSD, HUD, Motor Test Panel, Settings, Credits                |
| `src/config`  | Every tunable value                                          |
