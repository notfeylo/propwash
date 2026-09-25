# Backlog

Ideas outside the current phase. Move items into a phase in `docs/PRD.md` when they're picked up.

- Content-hashed URLs for `public/models`, `public/audio`, `public/hdri` so immutable caching is safe (see DECISIONS).
- KTX2 textures with a `?tex=webp|ktx2` switch (PRD §4.1 stretch).
- Code-split three.js addons out of the main chunk (Vite warns at 900 kB).
- Generate the procedural pad/floor textures in a worker (they run on the main thread at startup today).
- Per-instance opacity for smear ghosts (older sub-frame samples fainter) for a smoother motion-blur falloff.
- Run `verify:visual` in CI on a GPU runner and diff against committed baselines.
