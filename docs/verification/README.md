# Phase 1 acceptance (PRD §4.9)

Checked 2026-09-25 against `main` and the production deploy at https://propwash-sim.vercel.app. Each item links to the evidence. "Automated" means a test or script in this repo re-checks it.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Public repo with MIT LICENSE, CREDITS (model credit verbatim), README, CONTRIBUTING, CoC, templates, green CI | pass | `github.com/notfeylo/propwash` is public, license MIT, topics set. [CREDITS.md](../../CREDITS.md) carries the credit verbatim plus the changes line; Settings → Credits repeats it. `.github/` has issue and PR templates. CI runs lint, typecheck, unit tests, assets + verify-assets, build, Playwright and the procedural audio verification. |
| 2 | Live on Vercel; the smoke test passes against production | pass | `BASE_URL=https://propwash-sim.vercel.app npx playwright test tests/e2e/smoke.spec.ts`: 1 passed. |
| 3 | `verify-assets`: node names, tri counts, mounts in extras, `drone.glb` ≤ 3 MB | pass (automated) | `node tools/verify-assets.mjs`: all checks pass; `drone.glb` is 2.68 MB. |
| 4 | Top-down rotor angles 0° and 60°: props rotate about fixed bell centres | pass (automated) | [rotor-angle-0.jpg](rotor-angle-0.jpg), [rotor-angle-60.jpg](rotor-angle-60.jpg), [rotor-angle-overlay.jpg](rotor-angle-overlay.jpg); `tests/e2e/rig.spec.ts` checks hub centroids stay on the pivots. |
| 5 | Spin directions match §2.1 (debug arrows toggle) | pass (automated) | [spin-directions.jpg](spin-directions.jpg) tracks a real blade tip against the arrows (`?arrows=1`); `rig.spec.ts` checks every rotor's sign. |
| 6 | Plug-in: XT60 tick → 3 rising ESC tones → 2 ready tones, from the motor positions | pass (automated) | [audio/README.md](audio/README.md): tick at −19.4 dBFS within 60 ms, tones at 1047/1319/1568 then 1175/1568 Hz, 7.6 dB louder in the ear facing the drone. |
| 7 | Arming > 5% refused with a warning; arming at 0 brings props to idle smoothly | pass (automated) | Audio report (refusal: THROTTLE warning + long low beep; arm: monotonic ramp to 2,406 RPM, 0 clicks); `power.spec.ts`; OSD shows the blinking THROTTLE warning and a toast explains the fix per device. |
| 8 | 0 → 100 → 0% over 4 s: continuous pitch and loudness, no clicks/gaps/phasing; smooth mesh → smear → disc | pass (automated) | Audio report: 0 clicks, worst 10 ms dip 1.15 dB, pitch median error 18 cents, loudness/RPM correlation 0.94. [prop-stages.jpg](prop-stages.jpg) and `propBlend` unit tests cover the continuous crossfades. |
| 9 | Throttle snap (< 100 ms) triggers audible transient layer E | pass (automated) | Audio report: +32.6 dB in 1–6 kHz over the 80 ms after a 50 ms snap vs. E muted. |
| 10 | Disarm at high RPM: props coast down over ~1 s with matching audio | pass (automated) | Audio report: 19,669 → 6,468 RPM after 1 s, level −8.8 dB, silent once stopped, 0 clicks. |
| 11 | FPV view shows props in frame, vibration shake, OSD, both feeds; HD view works | pass | [camera-fpv-analog-armed.jpg](camera-fpv-analog-armed.jpg), [camera-fpv-digital-armed.jpg](camera-fpv-digital-armed.jpg), [camera-fpv-analog-disarmed.jpg](camera-fpv-analog-disarmed.jpg), [camera-fpv-no-signal.jpg](camera-fpv-no-signal.jpg), [camera-hd.jpg](camera-hd.jpg). Shake: the FPV camera travels 0.06–0.11 mm peak-to-peak at 22,600 RPM ([budgets.md](budgets.md)). `cameras.spec.ts` checks the cycle, feeds and OSD. |
| 12 | PS4, PS5, keyboard, and a USB RC radio (or the simulated calibration test) work; rumble in Chrome | pass, with notes | **PS4:** tested live with a real DualShock 4 (054c:09cc) in Chrome: Options-hold plug, R1 arm/disarm, L1+R1 kill, R2 throttle to 24k RPM, △ □ ○ touchpad all fired; three findings fixed in 9f2235f. **Keyboard:** every binding in `power`, `cameras`, `input` and `ui` specs through real key events. **RC radio:** simulated calibration test in `tests/unit/input.test.ts` (axis detection, endpoints, inversion, arm switch). **PS5:** no DualSense was available; it uses the same Chrome standard mapping as the DS4 and its ids are recognized (unit-tested). **Rumble:** Chrome accepted every `dual-rumble` effect on the real DS4 (weak motor 0.09 → 0.21 with RPM); the simulated-pad e2e test checks strong pulses and load tracking. |
| 13 | §4.2 budgets met on High; no console errors | pass on this machine | [budgets.md](budgets.md), production: 4.15 MB before the first frame (≤ 8 MB), first frame 2.2 s on 50 Mbps (≤ 3 s), no console errors. 1440p High frame times p95 ≈ 3 ms. The dev GPU is an RTX 4070 SUPER, faster than the RTX 3060 target, so frame time here isn't proof for that class; dynamic resolution covers slower GPUs. |
| 14 | 20 s GIF (plug → arm → throttle sweep → FPV → disarm) in the README | pass | [../media/propwash.gif](../media/propwash.gif), rendered by `pnpm record:gif` with the sim stepped one frame per capture. |

## Regenerating

```bash
pnpm dev                                   # in one terminal
CHANNEL=chrome pnpm verify:visual          # screenshots in this folder
FFMPEG_PATH=… pnpm verify:audio            # audio/README.md (add --clips with the local recording)
CHANNEL=chrome pnpm verify:budgets <url>   # budgets.md (use the production URL for download and first frame)
FFMPEG_PATH=… CHANNEL=chrome pnpm record:gif
```
