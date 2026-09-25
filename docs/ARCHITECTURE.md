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
