import { BLACKBOX } from '../config/blackbox';
import { MOTOR } from '../config/motor';
import type { FlightSim } from './flight/FlightSim';

// Blackbox (Phase 2 PRD §8.2): the flight at 500 Hz, in memory, in chunks of one second.

/** Recorded channels, in storage order. Rates in deg/s; sticks −1..1 (throttle 0..1). */
export const CHANNELS = [
  'rc.roll',
  'rc.pitch',
  'rc.yaw',
  'rc.throttle',
  'sp.roll',
  'sp.pitch',
  'sp.yaw',
  'sp.throttle',
  'gyro.roll',
  'gyro.pitch',
  'gyro.yaw',
  'gyroRaw.roll',
  'gyroRaw.pitch',
  'gyroRaw.yaw',
  'p.roll',
  'p.pitch',
  'p.yaw',
  'i.roll',
  'i.pitch',
  'i.yaw',
  'd.roll',
  'd.pitch',
  'd.yaw',
  'f.roll',
  'f.pitch',
  'f.yaw',
  'motor.0',
  'motor.1',
  'motor.2',
  'motor.3',
  'rpm.0',
  'rpm.1',
  'rpm.2',
  'rpm.3',
  'quat.x',
  'quat.y',
  'quat.z',
  'quat.w',
  'pos.x',
  'pos.y',
  'pos.z',
  'vel.x',
  'vel.y',
  'vel.z',
  'vbat',
  'amps',
  'mah',
  'att.roll',
  'att.pitch',
  'att.yaw',
] as const;
export type Channel = (typeof CHANNELS)[number];
const NCH = CHANNELS.length;
const INDEX = Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as Record<Channel, number>;
const AX = ['roll', 'pitch', 'yaw'] as const;
const DEG = 180 / Math.PI;

export class Blackbox {
  readonly rateHz = BLACKBOX.rateHz;
  private chunks: Float32Array[] = [];
  private n = 0;
  private readonly perChunk = BLACKBOX.rateHz;
  readonly maxSamples = BLACKBOX.maxS * BLACKBOX.rateHz;

  get length(): number {
    return this.n;
  }

  get duration(): number {
    return this.n / this.rateHz;
  }

  get full(): boolean {
    return this.n >= this.maxSamples;
  }

  /** Append one frame of values (CHANNELS order). */
  push(row: ArrayLike<number>): void {
    if (this.full) return;
    const c = Math.floor(this.n / this.perChunk);
    if (!this.chunks[c]) this.chunks[c] = new Float32Array(this.perChunk * NCH);
    this.chunks[c].set(row, (this.n % this.perChunk) * NCH);
    this.n++;
  }

  /** One sample from the sim, now. */
  sample(s: FlightSim): void {
    const row = this.row;
    const t = s.fc.telemetry;
    const st = s.state;
    const sticks = s.inputs.sticks;
    let k = 0;
    row[k++] = sticks?.roll ?? 0;
    row[k++] = sticks?.pitch ?? 0;
    row[k++] = sticks?.yaw ?? 0;
    row[k++] = sticks?.throttle ?? 0;
    for (const a of AX) row[k++] = t.setpoint[a];
    row[k++] = t.throttle;
    for (const a of AX) row[k++] = t.gyro[a];
    for (const a of AX) row[k++] = t.gyroRaw[a];
    for (const term of [t.p, t.i, t.d, t.f]) for (const a of AX) row[k++] = term[a];
    for (let i = 0; i < 4; i++) row[k++] = s.inputs.driven ? (t.cmd[i] ?? 0) : 0;
    for (let i = 0; i < 4; i++) row[k++] = st.rpm[i];
    row[k++] = st.quaternion.x;
    row[k++] = st.quaternion.y;
    row[k++] = st.quaternion.z;
    row[k++] = st.quaternion.w;
    row[k++] = st.position.x;
    row[k++] = st.position.y;
    row[k++] = st.position.z;
    row[k++] = st.velocity.x;
    row[k++] = st.velocity.y;
    row[k++] = st.velocity.z;
    row[k++] = st.voltage;
    row[k++] = st.current;
    row[k++] = st.usedMah;
    for (const a of AX) row[k++] = t.attitude[a] * DEG;
    this.push(row);
  }
  private row = new Float32Array(NCH);

  /** A value. */
  at(i: number, ch: Channel): number {
    const c = this.chunks[Math.floor(i / this.perChunk)];
    return c ? c[(i % this.perChunk) * NCH + INDEX[ch]] : 0;
  }

  /** A channel as one array, samples [from, to). */
  series(ch: Channel, from = 0, to = this.n): Float32Array {
    from = Math.max(0, from);
    to = Math.min(this.n, to);
    const out = new Float32Array(Math.max(0, to - from));
    const j = INDEX[ch];
    for (let i = from; i < to; i++)
      out[i - from] = this.chunks[Math.floor(i / this.perChunk)][(i % this.perChunk) * NCH + j];
    return out;
  }

  /** Time of sample i (s). */
  time(i: number): number {
    return i / this.rateHz;
  }

  /** First sample in [from, upTo) where the two recordings differ (bitwise), or −1. */
  firstDifference(other: Blackbox, from = 0, upTo = Math.min(this.n, other.n)): number {
    for (let i = from; i < upTo; i++) {
      const a = this.chunks[Math.floor(i / this.perChunk)];
      const b = other.chunks[Math.floor(i / this.perChunk)];
      const o = (i % this.perChunk) * NCH;
      for (let k = o; k < o + NCH; k++) if (a[k] !== b[k] && !(Number.isNaN(a[k]) && Number.isNaN(b[k]))) return i;
    }
    return -1;
  }
}

// ---------------------------------------------------------------------------------------------
// CSV, with Betaflight blackbox_decode column names and units where one exists (PRD §8.2).

interface Column {
  name: string;
  get: (b: Blackbox, i: number) => number;
  digits: number;
}

const dshot = (x: number) => Math.round(BLACKBOX.dshot.min + x * (BLACKBOX.dshot.max - BLACKBOX.dshot.min));

function columns(): Column[] {
  const cols: Column[] = [];
  const add = (name: string, get: Column['get'], digits = 3) => cols.push({ name, get, digits });
  add('loopIteration', (_, i) => i * 2, 0);
  add('time (us)', (b, i) => Math.round(b.time(i) * 1e6), 0);
  for (const [bf, ours] of [
    ['axisP', 'p'],
    ['axisI', 'i'],
    ['axisD', 'd'],
    ['axisF', 'f'],
  ] as const)
    AX.forEach((a, k) => add(`${bf}[${k}]`, (b, i) => b.at(i, `${ours}.${a}` as Channel), 2));
  AX.forEach((a, k) => add(`rcCommand[${k}]`, (b, i) => b.at(i, `rc.${a}` as Channel) * 500, 1));
  add('rcCommand[3]', (b, i) => 1000 + b.at(i, 'rc.throttle') * 1000, 1);
  AX.forEach((a, k) => add(`setpoint[${k}]`, (b, i) => b.at(i, `sp.${a}` as Channel), 2));
  add('setpoint[3]', (b, i) => b.at(i, 'sp.throttle') * 1000, 1);
  add('vbatLatest (V)', (b, i) => b.at(i, 'vbat'), 3);
  add('amperageLatest (A)', (b, i) => b.at(i, 'amps'), 2);
  add('energyCumulative (mAh)', (b, i) => b.at(i, 'mah'), 1);
  AX.forEach((a, k) => add(`gyroADC[${k}]`, (b, i) => b.at(i, `gyro.${a}` as Channel), 2));
  AX.forEach((a, k) => add(`gyroUnfilt[${k}]`, (b, i) => b.at(i, `gyroRaw.${a}` as Channel), 2));
  for (let m = 0; m < 4; m++) add(`motor[${m}]`, (b, i) => dshot(b.at(i, `motor.${m}` as Channel)), 0);
  for (let m = 0; m < 4; m++)
    add(`eRPM[${m}]`, (b, i) => b.at(i, `rpm.${m}` as Channel) * MOTOR.polePairs * BLACKBOX.erpmScale, 0);
  // PROPWASH extras (not in Betaflight logs): truth from the sim.
  for (let m = 0; m < 4; m++) add(`rpm[${m}]`, (b, i) => b.at(i, `rpm.${m}` as Channel), 0);
  AX.forEach((a, k) => add(`attitude[${k}] (deg)`, (b, i) => b.at(i, `att.${a}` as Channel), 2));
  (['x', 'y', 'z', 'w'] as const).forEach((a, k) => add(`quat[${k}]`, (b, i) => b.at(i, `quat.${a}` as Channel), 6));
  (['x', 'y', 'z'] as const).forEach((a, k) => add(`pos[${k}] (m)`, (b, i) => b.at(i, `pos.${a}` as Channel), 3));
  (['x', 'y', 'z'] as const).forEach((a, k) => add(`vel[${k}] (m/s)`, (b, i) => b.at(i, `vel.${a}` as Channel), 3));
  return cols;
}

/** The recording as a CSV in blackbox_decode's layout (header row, one row per sample). */
export function toCsv(b: Blackbox): string {
  const cols = columns();
  const lines = [cols.map((c) => c.name).join(',')];
  for (let i = 0; i < b.length; i++) lines.push(cols.map((c) => fmt(c.get(b, i), c.digits)).join(','));
  return lines.join('\n') + '\n';
}

function fmt(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '0';
  return digits === 0 ? String(Math.round(v)) : String(Number(v.toFixed(digits)));
}

/** A real (or synthetic) Betaflight log, decoded by blackbox_decode (PRD §8.3). */
export interface ImportedLog {
  /** Seconds from the first row. */
  time: Float64Array;
  /** Rate setpoint (deg/s), when logged. */
  setpoint: [Float32Array, Float32Array, Float32Array] | null;
  /** Sticks −1..1, from rcCommand. */
  rc: [Float32Array, Float32Array, Float32Array] | null;
  /** Throttle 0..1. */
  throttle: Float32Array;
  gyro: [Float32Array, Float32Array, Float32Array];
  motor: Float32Array[] | null;
  vbat: Float32Array | null;
  /** Sample rate estimated from the time column (Hz). */
  rateHz: number;
  columns: string[];
}

/** Parse a blackbox_decode CSV (header names, µs time). Throws with a useful message. */
export function parseBlackboxCsv(text: string): ImportedLog {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 3) throw new Error('The file has no data rows.');
  // blackbox_decode writes the header on the first line; some tools prepend "key,value" metadata.
  const h = lines.findIndex((l) => /(^|,)\s*"?time \(us\)"?\s*(,|$)/.test(l));
  if (h < 0) throw new Error('No "time (us)" column: is this a blackbox_decode CSV?');
  const header = lines[h].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const col = (name: string) => header.indexOf(name);
  const need = (name: string) => {
    const i = col(name);
    if (i < 0) throw new Error(`Missing column "${name}".`);
    return i;
  };
  const tI = need('time (us)');
  const gI = [0, 1, 2].map((k) => need(`gyroADC[${k}]`));
  const spI = [0, 1, 2].map((k) => col(`setpoint[${k}]`));
  const rcI = [0, 1, 2, 3].map((k) => col(`rcCommand[${k}]`));
  const sp3 = col('setpoint[3]');
  if (spI.some((i) => i < 0) && rcI.slice(0, 3).some((i) => i < 0))
    throw new Error('Needs setpoint[0..2] or rcCommand[0..2] to drive the sim.');
  const mI = [0, 1, 2, 3].map((k) => col(`motor[${k}]`));
  const vI = col('vbatLatest (V)');

  const rows = lines.slice(h + 1).map((l) => l.split(','));
  const n = rows.length;
  const f = (i: number, scale = 1, off = 0) => {
    const a = new Float32Array(n);
    for (let r = 0; r < n; r++) a[r] = (Number(rows[r][i]) - off) * scale;
    return a;
  };
  const time = new Float64Array(n);
  const t0 = Number(rows[0][tI]);
  for (let r = 0; r < n; r++) time[r] = (Number(rows[r][tI]) - t0) / 1e6;
  const dt = (time[n - 1] - time[0]) / Math.max(1, n - 1);
  const throttle =
    rcI[3] >= 0 ? f(rcI[3], 1 / 1000, 1000) : sp3 >= 0 ? f(sp3, 1 / 1000) : new Float32Array(n).fill(0.5);
  const motor = mI.every((i) => i >= 0)
    ? mI.map((i) => f(i, 1 / (BLACKBOX.dshot.max - BLACKBOX.dshot.min), BLACKBOX.dshot.min))
    : null;
  return {
    time,
    setpoint: spI.every((i) => i >= 0) ? [f(spI[0]), f(spI[1]), f(spI[2])] : null,
    rc: rcI.slice(0, 3).every((i) => i >= 0) ? [f(rcI[0], 1 / 500), f(rcI[1], 1 / 500), f(rcI[2], 1 / 500)] : null,
    throttle,
    gyro: [f(gI[0]), f(gI[1]), f(gI[2])],
    motor,
    vbat: vI >= 0 ? f(vI) : null,
    rateHz: dt > 0 ? 1 / dt : 0,
    columns: header,
  };
}
