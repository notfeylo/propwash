import type RAPIER_NS from '@dimforge/rapier3d-deterministic-compat';
import { TURTLE, type WindPreset } from '../../config/aero';
import { type Airframe, MOTOR_PROP, ROTORS } from '../../config/airframes';
import { HULL_POINTS, MOTOR_FEET, PAYLOAD_CAPSULE } from '../../config/airframes/colliders';
import { ARMING_FC } from '../../config/fc';
import { DRONE_COLLIDERS, IMPACT, PAD_COLLIDER, PHYSICS } from '../../config/physics';
import type { FieldLayout } from '../../world/fieldLayout';
import type { Terrain } from '../../world/terrain';
import { FlightController, type Sticks } from '../fc/FlightController';
import { BODY, type FlightAxes, flightToBody } from '../frames';
import { Rng } from '../rng';
import {
  add,
  cross,
  dot,
  quatIdentity,
  scale,
  sub,
  v3,
  type Quat,
  type V3,
  rotate,
  rotateInv,
  len,
  lerp3,
  slerp,
} from '../vec';
import { angularDamping, bodyDrag, Wind } from './Aero';
import { FlightBattery } from './FlightBattery';
import { FlightMotors, thrust } from './FlightMotors';

export type Rapier = typeof RAPIER_NS;

/** What the pilot commands this step. */
export interface FlightInputs {
  /** ESCs driving the motors (armed or motor test). */
  driven: boolean;
  /** Direct per-motor command 0..1 (M1..M4): motor test, or open-loop tests without `sticks`. */
  cmd: readonly number[];
  /** Armed flight: sticks go through the flight controller, which produces the commands. */
  sticks?: Sticks;
  /** Motor test: a 0 command stops the motor rather than idling. */
  stopAtZero?: boolean;
  /** Turtle mode (flip over after crash): the sticks spin motors in reverse. */
  turtle?: boolean;
}

/** Everything render, audio and the tests read. Plain data: safe to copy to a worker later. */
export interface FlightState {
  time: number;
  step: number;
  /** Model origin (world, m) and attitude. */
  position: V3;
  quaternion: Quat;
  /** Centre-of-mass velocity (world, m/s) and angular velocity (world, rad/s). */
  velocity: V3;
  angularVelocity: V3;
  /** Linear acceleration of the CoM over the last step, gravity included (world, m/s²). */
  acceleration: V3;
  omega: number[];
  rpm: number[];
  thrust: number[];
  voltage: number;
  current: number;
  usedMah: number;
  /** A drone collider is touching the ground or an object. */
  onGround: boolean;
  /** Per prop: its disc is inside the ground or an object this step (prop strike). */
  propStrike: boolean[];
  /** Contact acceleration this step (g): what the ground or an object did to the drone. */
  impactG: number;
}

export interface FlightSimOptions {
  rapier: Rapier;
  airframe: Airframe;
  seed?: number;
  wind?: WindPreset;
  /** Height of the flat ground / pad top (world y, m), when there is no field. */
  groundY?: number;
  /** The test field: heightfield, objects and the launch pad (PRD §5). Flat ground without it. */
  field?: { terrain: Terrain; layout: FieldLayout; padTopY: number };
  /** Where the model origin starts (world, m); defaults to resting on the ground at the origin. */
  spawn?: V3;
  /** Heading of the nose at spawn (rad, clockwise from −Z). */
  spawnYaw?: number;
}

const toV3 = (v: { x: number; y: number; z: number }): V3 => v3(v.x, v.y, v.z);

/**
 * The flight physics core (Phase 2 PRD §1–§2): a Rapier rigid body with explicit mass, CoM and
 * principal inertia, stepped at a fixed 1 kHz. Every aerodynamic and motor force and torque is
 * computed here and applied each step (reset → add). Pure TypeScript: no three.js, no DOM.
 *
 * Group 1 has no flight controller: `inputs.cmd` drives the motors open loop.
 */
export class FlightSim {
  readonly world: RAPIER_NS.World;
  readonly body: RAPIER_NS.RigidBody;
  readonly motors: FlightMotors;
  readonly battery: FlightBattery;
  readonly wind: Wind;
  readonly fc: FlightController;
  readonly rng: Rng;
  /** Test hook: an external torque (N·m, flight axes) applied every step while set. */
  disturbance: FlightAxes | null = null;
  readonly h = 1 / PHYSICS.rateHz;
  airframe: Airframe;
  inputs: FlightInputs = { driven: false, cmd: [0, 0, 0, 0] };
  /** Current and previous fixed-step states; render interpolates between them. */
  state!: FlightState;
  prev!: FlightState;
  /** Fraction of a step accumulated since `state` (render interpolation weight). */
  alpha = 0;
  /** Steps dropped because a frame needed more than the per-frame cap (slow-motion). */
  droppedSteps = 0;
  /** Per-frame step cap; offline stepping (screenshots, recordings) lifts it. */
  maxStepsPerFrame = PHYSICS.maxStepsPerFrame;
  private colliders: RAPIER_NS.Collider[] = [];
  private propSensors: RAPIER_NS.Collider[] = [];
  /** World-frame force applied last step (N), to separate contact forces from ours. */
  private lastForce = v3();
  /** Latched impacts since the owner last read them (crash detection, sounds). */
  impacts: { g: number; time: number }[] = [];
  private readonly field: FlightSimOptions['field'];
  private acc = 0;
  private stepIndex = 0;
  private lastVel = v3();
  private readonly groundY: number;
  private readonly R: Rapier;
  private readonly motorRng: Rng;

  constructor(o: FlightSimOptions) {
    const R = (this.R = o.rapier);
    this.airframe = o.airframe;
    this.groundY = o.groundY ?? 0;
    this.rng = new Rng(o.seed ?? PHYSICS.seed);
    this.motorRng = this.rng.fork('motors');
    this.motors = new FlightMotors(this.rng.fork('imbalance'));
    this.battery = new FlightBattery(o.airframe.pack);
    this.wind = new Wind(this.rng.fork('wind'), o.wind);
    this.fc = new FlightController(o.airframe, this.rng.fork('fc'), this.h);

    this.world = new R.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
    this.world.timestep = this.h;
    this.field = o.field;
    if (o.field) this.buildField(o.field);
    else {
      const ground = R.ColliderDesc.cuboid(1000, 0.5, 1000)
        .setTranslation(0, this.groundY - 0.5, 0)
        .setFriction(PHYSICS.contact.friction)
        .setRestitution(PHYSICS.contact.restitution);
      this.world.createCollider(ground);
    }

    const spawn = o.spawn ?? this.restingAt(0, 0, o.airframe);
    const q = yawQuat(o.spawnYaw ?? 0);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setRotation(q)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = this.world.createRigidBody(desc);
    this.applyMassProperties();
    this.buildDroneColliders(o.airframe);
    this.lastVel = v3();
    this.state = this.snapshot();
    this.prev = this.state;
  }

  /** Ground height under (x, z): the pad top on the pad, else the terrain (or the flat ground). */
  groundAt(x: number, z: number): number {
    const f = this.field;
    if (!f) return this.groundY;
    if (Math.hypot(x, z) <= PAD_COLLIDER.radiusM) return f.padTopY;
    return f.terrain.heightAt(x, z);
  }

  /** Model-frame y of the lowest collider point when level (what rests on the ground). */
  bottomY(a: Airframe = this.airframe): number {
    let y = Math.min(...HULL_POINTS.map((p) => p[1]), ...MOTOR_FEET.map((p) => p[1] - DRONE_COLLIDERS.footRadiusM));
    if (a.payload) y = Math.min(y, PAYLOAD_CAPSULE.center[1] - PAYLOAD_CAPSULE.radius);
    return y;
  }

  /** Heightfield, the launch pad and every field object as fixed colliders. */
  private buildField(f: NonNullable<FlightSimOptions['field']>): void {
    const R = this.R;
    const { terrain, layout } = f;
    const n = terrain.cells + 1;
    // Rapier's heightfield is column-major with rows along z and columns along x.
    const hs = new Float32Array(n * n);
    for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) hs[ix * n + iz] = terrain.heights[iz * n + ix];
    const mat = (d: RAPIER_NS.ColliderDesc) =>
      d.setFriction(PHYSICS.contact.friction).setRestitution(PHYSICS.contact.restitution);
    this.world.createCollider(
      mat(R.ColliderDesc.heightfield(terrain.cells, terrain.cells, hs, { x: terrain.size, y: 1, z: terrain.size })),
    );
    const t = PAD_COLLIDER.thicknessM;
    this.world.createCollider(
      mat(R.ColliderDesc.cylinder(t / 2, PAD_COLLIDER.radiusM).setTranslation(0, f.padTopY - t / 2, 0)),
    );
    for (const p of layout.prims) {
      const d =
        p.shape === 'box'
          ? R.ColliderDesc.cuboid(...p.halfExtents)
          : p.shape === 'cylinder'
            ? R.ColliderDesc.cylinder(p.halfHeight, p.radius)
            : R.ColliderDesc.ball(p.radius);
      const [x, y, z] = p.position;
      const [qx, qy, qz, qw] = p.rotation;
      this.world.createCollider(mat(d.setTranslation(x, y, z).setRotation({ x: qx, y: qy, z: qz, w: qw })));
    }
  }

  /**
   * The drone's collision set (PRD §5): convex hull of frame + stack + battery, a capsule for the
   * canister when fitted, contact balls under the motors, and four prop-disc sensors.
   */
  private buildDroneColliders(a: Airframe): void {
    const R = this.R;
    for (const c of [...this.colliders, ...this.propSensors]) this.world.removeCollider(c, false);
    this.colliders = [];
    this.propSensors = [];
    const solid = (d: RAPIER_NS.ColliderDesc | null) => {
      if (!d) return;
      d.setDensity(0) // mass comes only from the airframe's explicit properties
        .setFriction(PHYSICS.contact.friction)
        .setRestitution(PHYSICS.contact.restitution);
      this.colliders.push(this.world.createCollider(d, this.body));
    };
    solid(R.ColliderDesc.convexHull(new Float32Array(HULL_POINTS.flat())));
    for (const [x, y, z] of MOTOR_FEET) solid(R.ColliderDesc.ball(DRONE_COLLIDERS.footRadiusM).setTranslation(x, y, z));
    if (a.payload) {
      const c = PAYLOAD_CAPSULE;
      // Rapier capsules run along local Y; turn it onto the canister's axis.
      const q =
        c.axis === 'z'
          ? { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }
          : { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
      solid(
        R.ColliderDesc.capsule(c.halfLength, c.radius)
          .setTranslation(...c.center)
          .setRotation(q),
      );
    }
    for (const r of ROTORS) {
      const d = R.ColliderDesc.cylinder(DRONE_COLLIDERS.propDiscHalfHeightM, MOTOR_PROP.propRadiusM)
        .setTranslation(r.position[0], r.position[1], r.position[2])
        .setSensor(true)
        .setDensity(0);
      this.propSensors.push(this.world.createCollider(d, this.body));
    }
  }

  private applyMassProperties(): void {
    const a = this.airframe;
    const [cx, cy, cz] = a.com;
    this.body.setAdditionalMassProperties(
      a.massKg,
      { x: cx, y: cy, z: cz },
      { x: a.inertia.pitch, y: a.inertia.yaw, z: a.inertia.roll },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
  }

  /** Switch preset (payload toggle): mass, CoM, inertia, pack spec and collider. */
  setAirframe(a: Airframe): void {
    if (a.id === this.airframe.id) return;
    // Resting on the ground: raise or lower the body so the new collider bottom sits on it.
    if (len(toV3(this.body.linvel())) < 0.05) {
      const t = this.body.translation();
      this.body.setTranslation({ x: t.x, y: t.y + this.bottomY(this.airframe) - this.bottomY(a), z: t.z }, true);
    }
    this.airframe = a;
    this.fc.setAirframe(a);
    this.applyMassProperties();
    this.buildDroneColliders(a);
  }

  get rpms(): number[] {
    return this.motors.rpms;
  }

  /**
   * Advance by a rendered frame's dt at the fixed rate: at most `maxStepsPerFrame` steps,
   * then the rest is dropped (slow-motion) instead of spiralling.
   */
  advance(dt: number): number {
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.h && n < this.maxStepsPerFrame) {
      this.stepOnce();
      this.acc -= this.h;
      n++;
    }
    if (this.acc >= this.h) {
      this.droppedSteps += Math.floor(this.acc / this.h);
      this.acc %= this.h;
    }
    this.alpha = this.acc / this.h;
    return n;
  }

  /** One fixed 1 ms step: motors → battery → forces → Rapier. */
  stepOnce(): void {
    const h = this.h;
    const a = this.airframe;
    const m = MOTOR_PROP;
    const body = this.body;
    const inp = this.inputs;
    const ms = this.motors.motors;

    // Flight controller: sensors sample the body as it is now, then the loop sets the motors.
    const q0 = toQuat(body.rotation());
    const truth = {
      angularVelocityBody: rotateInv(q0, toV3(body.angvel())),
      quaternion: q0,
      accelWorld: this.state.acceleration,
      gravity: PHYSICS.gravity,
      motors: ms,
      vLoaded: this.battery.voltage,
    };
    let cmd = inp.cmd;
    let stopAtZero = inp.stopAtZero;
    if (inp.sticks && inp.driven && inp.turtle) {
      this.fc.sense(truth, false);
      cmd = this.fc.turtle(inp.sticks);
      stopAtZero = true;
    } else if (inp.sticks && inp.driven) cmd = this.fc.update(truth, inp.sticks);
    else this.fc.sense(truth, false);

    this.motors.drive = inp.driven && this.battery.connected ? 'driven' : 'coast';
    this.motors.step(h, cmd, this.battery.connected ? this.battery.voltage : 0, stopAtZero);
    this.battery.update(
      h,
      ms.reduce((p, s) => p + m.kQ * Math.abs(s.omega) ** 3, 0),
      this.motors.drive === 'driven',
    );

    const q = toQuat(body.rotation());
    const pos = toV3(body.translation());
    const vCom = toV3(body.linvel());
    const w = toV3(body.angvel());
    const com = add(pos, rotate(q, v3(...a.com)));
    const up = rotate(q, BODY.up);
    const windV = this.wind.velocity;

    let force = v3();
    let torque = v3();
    const thrusts: number[] = [];
    // Body-frame yaw from reaction torque and the rotor-inertia kick; angular momentum of the props.
    let yawBody = 0;
    let rotorMomentum = 0;
    ROTORS.forEach((r, i) => {
      const s = ms[i];
      const pw = add(pos, rotate(q, v3(...r.position)));
      const arm = sub(pw, com);
      const vPoint = add(vCom, cross(w, arm));
      const vAir = sub(vPoint, windV);
      const vIn = dot(vAir, up);
      const vPerp = sub(vAir, scale(up, vIn));
      const t = thrust(s.omega, vIn, pw.y - this.groundAt(pw.x, pw.z));
      thrusts.push(t);
      const f = add(scale(up, t), scale(vPerp, -m.kD * Math.abs(s.omega)));
      force = add(force, f);
      torque = add(torque, cross(arm, f));
      yawBody += -s.spin * (m.kQ * s.omega * Math.abs(s.omega) + m.rotorInertia * s.domega);
      rotorMomentum += s.spin * m.rotorInertia * s.omega;
    });
    const wBody = rotateInv(q, w);
    let torqueBody = v3(0, yawBody, 0);
    if (m.gyroscopic) torqueBody = add(torqueBody, scale(cross(wBody, v3(0, rotorMomentum, 0)), -1));
    torque = add(torque, rotate(q, torqueBody));

    const vAirBody = sub(vCom, windV);
    force = add(force, bodyDrag(a, vAirBody, up));
    torque = add(torque, angularDamping(w));
    if (this.disturbance) torque = add(torque, rotate(q, flightToBody(this.disturbance)));

    body.resetForces(false);
    body.resetTorques(false);
    body.addForce(force, true);
    body.addTorque(torque, true);
    this.lastForce = force;
    this.world.step();
    this.wind.step(h, len(vAirBody));

    this.stepIndex++;
    this.prev = this.state;
    this.state = this.snapshot(thrusts);
  }

  private snapshot(thrusts: number[] = [0, 0, 0, 0]): FlightState {
    const b = this.body;
    const vel = toV3(b.linvel());
    const accel = scale(sub(vel, this.lastVel), 1 / this.h);
    this.lastVel = vel;
    const ms = this.motors.motors;
    // Contact acceleration = what happened minus what gravity and our forces explain.
    const own = add(scale(this.lastForce, 1 / this.airframe.massKg), v3(0, -PHYSICS.gravity, 0));
    const impactG = len(sub(accel, own)) / PHYSICS.gravity;
    let onGround = false;
    for (const c of this.colliders)
      this.world.contactPairsWith(c, (other) => {
        if (onGround) return;
        this.world.contactPair(c, other, (manifold) => {
          if (manifold.numContacts() > 0) onGround = true;
        });
      });
    // Sensors catch objects; Rapier sensors don't report heightfields, so each prop disc's rim is
    // also tested against the ground directly.
    const q = toQuat(b.rotation());
    const origin = toV3(b.translation());
    const propStrike = this.propSensors.map((c, i) => {
      let hit = false;
      this.world.intersectionPairsWith(c, () => (hit = true));
      if (hit) return true;
      const r = ROTORS[i].position;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const p = add(
          origin,
          rotate(q, v3(r[0] + Math.cos(a) * MOTOR_PROP.propRadiusM, r[1], r[2] + Math.sin(a) * MOTOR_PROP.propRadiusM)),
        );
        if (p.y < this.groundAt(p.x, p.z)) return true;
      }
      return false;
    });
    if (onGround && impactG > IMPACT.minG && this.stepIndex > 0)
      this.impacts.push({ g: impactG, time: this.stepIndex * this.h });
    return {
      time: this.stepIndex * this.h,
      step: this.stepIndex,
      position: toV3(b.translation()),
      quaternion: toQuat(b.rotation()),
      velocity: vel,
      angularVelocity: toV3(b.angvel()),
      acceleration: accel,
      omega: ms.map((s) => s.omega),
      rpm: this.motors.rpms,
      thrust: thrusts,
      voltage: this.battery.voltage,
      current: this.battery.current,
      usedMah: this.battery.usedMah,
      onGround,
      propStrike,
      impactG: onGround ? impactG : 0,
    };
  }

  /** Upside down (for turtle), from the FC's attitude estimate, and on the ground. */
  get turtleReady(): boolean {
    return this.state.onGround && this.fcTiltDeg > TURTLE.invertedDeg;
  }

  /** Upright again on the ground (turtle is done). */
  get uprightOnGround(): boolean {
    return this.state.onGround && this.fcTiltDeg < TURTLE.uprightDeg;
  }

  /** Crash detection (off by default, as in Betaflight): an impact above the threshold. */
  takeCrash(): boolean {
    const hit = ARMING_FC.crashDetection.enabled && this.impacts.some((i) => i.g > ARMING_FC.crashDetection.impactG);
    this.impacts = [];
    return hit;
  }

  /** Pose for rendering: interpolated between the last two fixed steps. */
  interpolated(): { position: V3; quaternion: Quat } {
    return {
      position: lerp3(this.prev.position, this.state.position, this.alpha),
      quaternion: slerp(this.prev.quaternion, this.state.quaternion, this.alpha),
    };
  }

  /** Model origin resting on the ground at (x, z). */
  restingAt(x = 0, z = 0, a: Airframe = this.airframe): V3 {
    return v3(x, this.groundAt(x, z) - this.bottomY(a), z);
  }

  /** Put the drone back at rest (launch pad reset); motors and pack keep their state. */
  reset(position: V3 = this.restingAt(), yaw = 0): void {
    this.body.setTranslation(position, true);
    this.body.setRotation(yawQuat(yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastVel = v3();
    this.state = this.snapshot(this.state.thrust);
    this.prev = this.state;
    this.acc = 0;
  }

  /** Arming ramp (idle stagger) with this sim's seeded randomness. */
  arm(soft?: boolean): void {
    this.motors.arm(this.motorRng, soft);
    this.fc.reset(toQuat(this.body.rotation()), this.inputs.sticks);
  }

  /** Tilt the flight controller believes (deg): the arming small-angle check. */
  get fcTiltDeg(): number {
    return (this.fc.tilt * 180) / Math.PI;
  }

  dispose(): void {
    this.world.free();
  }
}

function toQuat(r: { x: number; y: number; z: number; w: number }): Quat {
  return { x: r.x, y: r.y, z: r.z, w: r.w };
}

/** Heading (clockwise from −Z seen from above) → rotation about +Y. */
function yawQuat(yaw: number): Quat {
  if (!yaw) return quatIdentity();
  return { x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) };
}
