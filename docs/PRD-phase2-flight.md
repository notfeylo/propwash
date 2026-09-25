# PROPWASH — Phase 2 PRD: Flight

> **Goal:** make the drone fly like a real 7″ FPV quad. Same physics, same flight controller behavior (Betaflight-faithful), same stick feel, and the same visible and audible reactions: tilting, banking, flipping, hovering, prop wash, punch-outs, landings, crashes, turtle mode.
> Phase 1 (bench) is done. The environment and art pass come in Phase 3. This phase adds only a **minimal flight test field** so there's something to fly over.

Repo: `notfeylo/propwash` · File: `docs/PRD-phase2-flight.md`

---

## 0. Implementation rules
1. Read this file and the existing `docs/PRD.md` first. Reuse the Phase 1 modules (`MotorModel`, `AudioEngine`, `InputManager`, `CameraDirector`, `DroneModel`), extending them rather than replacing them.
2. **The physics core is a pure TypeScript module (`src/sim/`) with no three.js or DOM imports.** It must run headless in Vitest. Rendering only reads its state.
3. All physical constants live in `src/config/airframes/*.ts`, in SI units. No magic numbers in code.
4. Every task ends with its automated **Flight Lab** tests (§8) passing. "Feels right" isn't done until the numbers in §9 pass.
5. The §2 numbers were **verified in a numerical sim on 2026-09-25**. Start from them. If you change one, record why in `docs/DECISIONS.md`.
6. Commit per task (Conventional Commits). Stop after each task group listed in §10 and report back with test output and a short screen-capture GIF.

---

## 1. Architecture decisions

| Item | Decision |
|---|---|
| Integrator | **Rapier** (`@dimforge/rapier3d-compat`) rigid body integrates motion and handles contacts. Our code computes every aerodynamic and motor force/torque and applies them each sub-step (`resetForces` → `addForce` / `addTorque`). Mass and principal inertia are set explicitly, not derived from colliders. |
| Rates | **Physics + flight controller at 1000 Hz** fixed step (accumulator, max 8 sub-steps per frame, then slow-mo rather than spiral). Render interpolates between the last two states. |
| Determinism | Seeded RNG for all noise, gusts and prop wash. The same seed + inputs must replay bit-identically (it's needed for replays, tests and ghosts). |
| Frames | three.js world: Y-up, nose −Z, right +X. Keep one `frames.ts` helper converting to Betaflight body axes (roll = about the nose axis, pitch = about the right axis, yaw = about up) with explicit sign tests. **Never hand-flip signs anywhere else.** |
| Threading | Main thread to start (a single body at 1 kHz costs less than 1 ms per frame). Keep the sim worker-ready: no shared mutable state with render. |

---

## 2. Physical model (per airframe preset)

### 2.1 Presets (`src/config/airframes/`)
Geometry comes from `drone.glb`: rotor pivots at (±0.1217, 0.0700, ±0.1233) m, prop R = 0.0889 m, 3 blades, props-in (M1 RR CW, M2 FR CCW, M3 RL CCW, M4 FL CW).

| Param | `freestyle7` (LiPo 6S 1300, no payload) | `longrange7` (Li-ion 6S2P, default for this model) | `longrange7_payload` |
|---|---|---|---|
| Mass (AUW) | 0.85 kg | 1.35 kg | 1.65 kg |
| Inertia pitch / yaw / roll (kg·m²) | 0.0048 / 0.0085 / 0.0045 | 0.0079 / 0.0110 / 0.0075 | 0.0095 / 0.0125 / 0.0090 |
| Thrust-to-weight | 8.9 | 5.6 | 4.6 |
| Hover RPM / cmd | ~8,200 / 26% | ~10,350 / 36% | ~11,450 / 41% |
| Battery | 6S LiPo, 1300 mAh, R_int 0.012 Ω/cell | 6S2P Li-ion 21700, 8000 mAh, R_int 0.020 Ω/cell | same |
| Drag CdA front / top (m²) | 0.008 / 0.020 | 0.010 / 0.025 | 0.012 / 0.028 |

The payload canister toggle switches between the last two presets. Centre of mass is at the bbox centre, offset −0.01 m in y when the payload is on.

### 2.2 Motor + prop (per motor i, all presets: 2807 1300 KV, 7×4×3 prop)
- **Speed dynamics:** `dω/dt = (ω_cmd − ω)/τ`, with τ_up = 0.035 s and τ_down = 0.050 s (DShot active braking).
  `ω_cmd = ω_idle + (ω_max(V) − ω_idle) · cmd`, where `ω_idle` = 2,400 rpm and `ω_max(V) = 0.75 · KV · V_bat_loaded · 2π/60`. That's ≈ 2,573 rad/s ≈ 24,570 rpm at 25.2 V.
- **Thrust:** `T = kT · ω² · clamp(1 − v_in / (K_eff · v_pitch(ω)), 0, 1.2) · GE(h)`, with:
  - `kT = 2.815e-6 N/(rad/s)²` (gives 18.6 N ≈ 1.9 kgf static at max)
  - `v_pitch = ω/(2π) · 0.1016 m` (4″ pitch) and `K_eff = 1.7`
  - `v_in = dot(v_air_at_rotor, thrustAxis)`: positive when climbing or flying into the disc, so thrust fades at speed
  - Ground effect: `GE(h) = 1 / (1 − (R/(4h))²)` for h > R/2, clamped to 1.33
- **Reaction torque (yaw):** `Q = kQ · ω²` with `kQ = 0.015 · kT = 4.22e-8`. It acts on the body opposite the prop spin.
- **Rotor inertia yaw kick:** `τ_y += −s_i · J_r · dω_i/dt`, with J_r = 3.0e-5 kg·m² (prop + bell). This gives real quads their yaw twitch on throttle punches, and it's required.
- **Gyroscopic term (optional flag, default on):** `τ += −ω_body × (Σ s_i J_r ω_i · ŷ)`.
- **H-force / rotor drag:** `F = −kD · ω · v_perp` per rotor (v_perp = air velocity in the rotor plane), with kD = 1.0e-5. It makes low-speed drag feel linear, as it does on real quads.
- **Imbalance vibration:** each motor has a fixed imbalance `u_i ∈ [0.5, 1.5]%`. It injects force at rotor frequency into the gyro model and the FPV-cam shake. It's cosmetic for the body but real for the gyro (§3.6).

### 2.3 Body aerodynamics
- Drag: `F = −½ ρ · CdA(attitude) · |v_air| · v_air`, where `CdA` blends front and top areas by the angle between velocity and the body up-axis. ρ = 1.225.
- Angular damping: `τ = −c_ω · ω_body`, c_ω = 2e-4 (small, since the rate PID does the real work).
- **Wind:** a constant vector plus gusts (Dryden-lite: 3-axis filtered noise with σ and a length scale). Presets: Calm, Light (2 m/s ± 1), Breezy (6 m/s ± 3). Default is Light.

### 2.4 Prop wash / vortex ring (the 7″ signature)
When a rotor sits in its own or another rotor's wake, that is, descending (`v_in < −0.6 · v_induced`, with `v_induced = √(T/(2ρA))`, ≈ 6–8 m/s at hover) with low horizontal speed:
- inject band-limited (10–40 Hz) random torques and thrust loss per rotor, with amplitude ∝ severity
- the PID fights it, which produces the real wobble and the "prop wash oscillation"
- also scale audio layer D AM (§6)

Severity fades out as horizontal speed exceeds ~4 m/s. Tunable in `config/aero.ts`.

### 2.5 Battery
`V_loaded = V_ocv(SoC) − I · R_int`, where `I = Σ (Q_i · ω_i) / (η · V)` with η = 0.8, and SoC is integrated from mAh. V_ocv comes from a per-chemistry curve (LiPo vs Li-ion tables). Sag reduces `ω_max`, so punch-outs get weaker as the pack drains, and the OSD shows the sag in real time.

---

## 3. Flight controller (Betaflight-faithful)

### 3.1 Pipeline (every 1 ms)
`sticks → RC smoothing → rates → setpoint → (angle/horizon outer loop) → rate PID → mixer (+airmode, TPA) → motor cmd → DShot idle clamp → motor model`

### 3.2 Rates: Betaflight "Actual" rates (default)
```
expof   = |x| * (x^5 * expo + x * (1 - expo))
rate°/s = x * center + max(0, maxRate - center) * expof
```
Defaults on all axes: center 70, max 670, expo 0.54. Also implement Betaflight (RC rate / super / expo), RaceFlight and KISS as selectable models. Include a rates preview curve in Settings.

### 3.3 RC smoothing
Setpoint smoothing PT3 with an auto cutoff ~15 ms (configurable). Feedforward uses the smoothed setpoint derivative, with jitter reduction.

### 3.4 Rate PID (physical units; the output is angular acceleration)
`α_cmd = Kp·e + Ki·∫e + Kd·(−dω_filtered/dt) + FF·dSetpoint/dt`, then `τ_cmd = I · α_cmd`.

**Verified starting tune** (1 kHz loop, τ_motor 35 ms, gyro LPF 90 Hz): **Kp 10 s⁻¹, Ki 5 s⁻², Kd 0.03 s, FF 0.8**, same on roll and pitch. On `freestyle7` this gives a 0→500°/s step with **~85 ms rise to 90% and < 8% overshoot**. Yaw: Kp 8, Ki 5, Kd 0, FF 0.6.
- **I-term relax** (setpoint-based, like BF) to stop bounce-back after flips.
- **Anti-windup:** clamp I, and freeze it while the mixer saturates.
- **TPA:** attenuate Kd by 30% above 65% throttle.
- Also expose a "Betaflight numbers" view (P/I/D/FF on a 0–200 scale) mapped linearly to the physical gains, for pilots who think in BF terms.

### 3.5 Mixer + airmode
- **Build the allocation matrix from geometry and spin** (`τ = r × T`, yaw from `−s_i · kQ`), then invert it (pseudo-inverse) to turn `[T_total, τ_roll, τ_pitch, τ_yaw]` into per-motor thrust, then into ω_cmd, then into cmd.
- **Airmode (default on):** when any motor would exceed [0, 1], shift throttle to preserve the differential. If the spread itself exceeds 1, scale the differential down, yaw first.
- **Unit tests (sign safety):** +roll stick rolls right, +pitch stick pitches nose down, +yaw stick yaws right (nose goes right), and hover produces no net torque. Test each against physics output, not against the matrix.

### 3.6 Gyro and sensor model
- Gyro = true ω_body + white noise (σ 0.3°/s) + motor-imbalance vibration at each rotor frequency (aliased correctly for 1 kHz) + bias drift. Then a PT1 LPF at 90 Hz plus an RPM-notch filter centered on the motor frequencies (so filtering matters, as it does on a real FC).
- Accelerometer (Angle mode only): noise + LPF.
- These imperfections are what make it feel real rather than "game-perfect". Include a toggle, "Ideal sensors", for debugging.

### 3.7 Modes and safety
| Mode | Behavior |
|---|---|
| **Acro** (default) | Rate mode above. |
| **Angle** (self-level) | Outer loop: `rate_sp = kLevel · (angle_target − angle)`, with kLevel 7 s⁻¹ and max angle 55°. Yaw stays rate. This is the "balancing" mode. |
| **Horizon** | Angle near center stick, blending to Acro toward full stick (allows flips). |
| **Turtle** (flip over after crash) | Available only when disarmed and upside-down on the ground. Motors run **in reverse** (props visibly and audibly spin the opposite way) on the side commanded by the stick, to flip the quad back. |

- **Arming:** throttle ≤ 5%, tilt < 25° (BF `small_angle`), not in failsafe. Otherwise OSD warns with `THROTTLE` / `ANGLE`.
- **Crash detection:** off by default, as in BF. Optionally an impact above a threshold disarms.
- **Motor idle:** DShot idle 5.5%. Airmode keeps authority at zero throttle (fast dives and hang-time stay controllable).
- **Failsafe:** a stub only in this phase (hook in place for Phase 4 radio range).

---

## 4. Input (upgrade from Phase 1)
Sticks now drive everything. Mode 2 is default (Mode 1 selectable). Per-axis deadzone, expo, and invert.

| Device | Throttle |
|---|---|
| **RC radio (USB HID)** | Direct. This is the gold-standard feel, so recommend it in the UI. |
| **PS4/PS5** | Left stick Y absolute (bottom = 0, spring center = 50%) by default, with a **"hover-centered" option** that maps center to the preset's measured hover cmd through a smooth curve. R2 (analog) is an alternative throttle binding. |
| **Keyboard** | W/S throttle (incremental + auto-hover assist toggle), A/D yaw, arrows pitch/roll. Mark it "not recommended for acro". |
- Stick visualizer in the HUD (two gimbals) plus a raw-input debug panel.
- Mode switch binding (Acro/Angle/Horizon), turtle binding, and camera + reset bindings (`R` or D-pad-down resets to the launch pad).

---

## 5. Minimal flight test field (not the Phase 3 world)
It exists only to give depth cues and something to judge speed and attitude against.
- A 600×600 m procedural grass heightfield: gentle hills and one flat launch area with the Phase 1 landing pad. Instanced low grass cards near the camera only.
- **Reference objects:** vertical poles every 20 m in a grid, 6 race gates in a loop, a tall "dive tower" (40 m), a few boxes and ramps for proximity flying, 10–20 simple trees, and wind flags (they show the wind vector).
- Sky: the Phase 1 HDRI or a physical sky (sun + atmosphere). Distance fog for scale.
- Colliders: heightfield + primitives in Rapier. **Drone colliders:** a convex hull of the frame + battery, a capsule for the payload, 4 thin cylinders for prop discs (used for prop-strike detection), and contact points on the 4 motor bottoms for landing.

---

## 6. Visual + audio coupling (the drone must *look and sound* like its physics)
- **Per-motor RPM from physics** drives each rotor's spin and blur stage (Phase 1 system). During rolls and yaws, opposite props visibly and audibly differ.
- **Turtle mode:** reverse spin with the correct blur direction, plus the distinctive strained turtle sound (low-RPM, high-torque buzz).
- **Audio:** per-motor voices already exist. Add:
  - **F. Wind/air rush:** noise ∝ airspeed², band-passed, stronger in FPV view
  - **Prop wash chop:** amplitude modulation 10–30 Hz of layers A/D, scaled by §2.4 severity
  - **Doppler + distance attenuation** in Chase and LOS cameras (use `PannerNode` velocity or manual pitch shift)
  - **Crash / impact:** impact sounds on carbon, grass and hard surfaces; prop-strike tick; an optional "motor desync" screech if a prop strike is severe
  - The **snap-rotation transient (layer E)** now fires naturally on flips and hard stops
- **Body:** the FPV cam inherits the real body motion plus imbalance vibration. Antenna sway is driven by real body acceleration and airspeed.
- **Props in FPV view:** tilt with the body; blur discs show per-motor differences.

## 7. Cameras (additions)
- **FPV:** the primary flight view (uptilt 25° default, adjustable live).
- **Chase:** a spring-arm behind and above with velocity look-ahead and a no-clip camera collider.
- **LOS (line of sight):** a camera standing at the pilot position on the launch pad at 1.7 m height, tracking the drone with smooth auto-zoom. Shows how the drone behaves from the ground, the way a spotter sees it.
- **HD/GoPro:** add **horizon-lock / stabilized mode** (GoPro HyperSmooth or Gyroflow-style), produced from the known attitude and a smoothed virtual camera. Raw is also available.
- **Replay:** a free cam over a recorded flight (§8.2).

---

## 8. Flight Lab: balance tests, telemetry, validation

### 8.1 Automated tests (Vitest, headless, deterministic, also runnable in-app)
| # | Test | Pass condition (`freestyle7` unless noted) |
|---|---|---|
| T1 | **Hover equilibrium** | Hover cmd 24–28% (LR: 34–38%). In Angle mode, calm wind, 30 s: drift < 0.5 m, yaw drift < 2°. |
| T2 | **Roll/pitch rate step** 0→500°/s | 90% rise 70–110 ms, overshoot < 10%, settles within ±2% by 250 ms. |
| T3 | **Yaw step** 0→400°/s | Reached < 250 ms, overshoot < 12%. |
| T4 | **Flip** (full roll stick from hover) | 360° in 0.55–0.75 s, no bounce-back > 5° (I-relax working). |
| T5 | **Punch-out** 100% for 2 s from hover | Initial accel 7–9 g; ~40 m/s (~150 km/h) and ~60 m climbed at 2 s. LR: 4–5 g, ~37 m/s, ~50 m. |
| T6 | **Top level speed** | 130–160 km/h (freestyle), 120–150 km/h (LR). Dives go faster. |
| T7 | **Disturbance rejection** | 0.05 N·m roll impulse for 50 ms at hover recovers to < 2°/s in < 150 ms. |
| T8 | **Prop wash** | Vertical descent at 7 m/s then a 60% punch: gyro RMS in the 10–40 Hz band rises ≥ 3× vs clean hover, with a visible wobble. |
| T9 | **Battery sag** | 10 s at 100% gives V_loaded drop ≥ 2.0 V (LiPo 6S fresh) and max RPM drop ≥ 6%. |
| T10 | **Sign safety** | The §3.5 stick-direction tests. |
| T11 | **Determinism** | Same seed + input log gives identical state after 60 s. |
| T12 | **Landing** | Descent at 1 m/s onto the pad rests upright, no bounce > 3 cm, disarm spools down. |
| T13 | **Turtle** | Upside-down on grass, turtle stick flips upright in < 2 s. |

The §2 parameters already hit T1, T2, T4, T5 and T6 in a simplified numerical model. Getting the rest to pass is tuning, not redesign.

### 8.2 Blackbox and replay
- Record at 500 Hz: time, sticks, setpoint[4], gyro[3] (raw + filtered), PID P/I/D/FF per axis, motor cmd[4], rpm[4], attitude quaternion, position, velocity, V/I/mAh, and the RNG seed.
- **In-app graph panel** (uPlot): live and post-flight, with a step-response view (PIDtoolbox-style deconvolution).
- **Export CSV** with column names modeled on Betaflight `blackbox_decode` output (`gyroADC[0]`, `setpoint[0]`, `motor[0]`, `rcCommand[0]`, and so on), so pilots can compare with real logs.
- **Replay** a flight from the input log + seed (deterministic), with free camera and scrub bar. Export an FPV/HD video via `MediaRecorder`.

### 8.3 Real-world validation (the "exact replica" loop)
- **Import a real 7″ Betaflight blackbox CSV** (decoded with `blackbox_decode`). Feed its stick inputs into the sim and overlay the sim's gyro against the real gyro, plus step-response curves.
- Tune the airframe preset until the curves match. Store matched presets in `config/airframes/validated/` with the log's source noted.
- The owner will supply logs or record their own. Until then, test the tool with synthetic logs.

---

## 9. Phase 2 definition of done
- [ ] T1–T13 pass in CI, headless.
- [ ] Flying in FPV with a PS5 controller and a USB radio: hover, forward flight, banked turns, flips, rolls, power loops, split-S, dives, gate runs, landing, crash, turtle, re-arm.
- [ ] Prop wash is visible and audible on hard descents. Punch-outs show battery sag on the OSD.
- [ ] Per-motor RPM differences are visible (blur) and audible in rolls and yaws.
- [ ] Chase, LOS, FPV, HD (raw + horizon-lock) and Replay cameras work.
- [ ] Blackbox panel, CSV export and deterministic replay work.
- [ ] Still 60 fps on High (the physics budget must stay < 1.5 ms per frame at 1 kHz).
- [ ] A README GIF of an FPV flight: takeoff → gate loop → flip → dive → landing.

## 10. Task order (stop and report after each group)
1. **Sim core:** `frames.ts`, airframe config, motor + thrust + drag + battery, Rapier body. T1 (open-loop hover), T5, T6, T9, T11.
2. **Flight controller:** rates, smoothing, PID, mixer + airmode, sensor model, modes, arming. T2–T4, T7, T10.
3. **Test field + colliders + landing/crash/turtle.** T12, T13.
4. **Coupling:** rotor visuals + audio layers F, prop wash chop, Doppler, impacts; prop wash physics. T8.
5. **Cameras:** Chase, LOS, HD horizon-lock, Replay.
6. **Flight Lab UI:** blackbox panel, CSV export, blackbox import + overlay.
7. The §9 checklist, performance pass, README GIF, and deploy.

## 11. Out of scope (don't build yet)
The Phase 3 world (jungle, mountains, clouds from the reference videos), race timing and ghosts, long-range radio/video link simulation (RSSI/LQ, analog breakup, failsafe), GPS rescue, prop damage models, multiplayer.
