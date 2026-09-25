# Audio source: license unverified

The motor recording used for local development (`drone.mp3`) has **unknown provenance**, so it is git-ignored and never committed or deployed.

- `pnpm assets` cuts loop and spool clips from it **only if it is present locally**. Without it, the audio engine runs procedural-only (blade-pass tone, motor whine, prop wash, transients), which is what CI and the public build use.
- Replacement plan: a CC0 recording, or our own recordings at fixed RPMs (roadmap Phase 5).
