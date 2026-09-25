# Contributing to PROPWASH

Thanks for helping make browser FPV feel real.

## Setup

```bash
pnpm i
pnpm assets        # builds public/models/drone.glb from assets-src/
pnpm dev
```

## Before you open a PR

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm verify-assets             # if you touched the asset pipeline
pnpm build && pnpm test:e2e    # Playwright smoke test
```

CI runs all of these on every push and pull request.

## Ground rules

- **Look at it.** Rendering, animation, and UI changes need screenshots in the PR. Verify visually; don't assume a change worked.
- **Tunables go in `src/config/*.ts`.** No magic numbers inline.
- **Units:** meters, seconds, radians. **Axes:** Y-up, nose = −Z.
- **Stay in scope.** Ideas outside the current phase go in [`docs/BACKLOG.md`](docs/BACKLOG.md).
- **Record trade-offs.** When a requirement meets reality (an API limit, an asset problem), write it up in [`docs/DECISIONS.md`](docs/DECISIONS.md).
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`...).

## Assets

- Every third-party asset needs a license that allows redistribution, listed per file in [`CREDITS.md`](CREDITS.md).
- Never commit audio or models with unknown provenance.
- `tools/split-drone.mjs` is verified against the source model. If you change it, `pnpm verify-assets` must still pass exactly.

## Reporting bugs

Use the issue templates, and include your browser, OS, GPU, and input device.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
