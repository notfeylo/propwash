# Backlog

Ideas outside the current phase. Move items into a phase in `docs/PRD.md` when they're picked up.

- Content-hashed URLs for `public/models`, `public/audio`, `public/hdri` so immutable caching is safe (see DECISIONS).
- KTX2 textures with a `?tex=webp|ktx2` switch (PRD §4.1 stretch).
- Code-split three.js addons out of the main chunk (Vite warns at 900 kB).
- Generate the procedural pad/floor textures in a worker (they run on the main thread at startup today).
- Per-instance opacity for smear ghosts (older sub-frame samples fainter) for a smoother motion-blur falloff.
- Run `verify:visual` in CI on a GPU runner and diff against committed baselines.
- Wire the FPV audio mix (close-mic shelf, prop-wash rumble) to the FPV camera in Task 6; the engine already takes `cameraMode`.
- Multi-sample RPM bank from our own recordings (Phase 5) to replace the single loop + synth.
- Settings UI for per-layer volume (`AUDIO.userVolume`) and soft-arm (Task 8).
