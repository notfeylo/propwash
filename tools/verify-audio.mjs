/* global window */
// tools/verify-audio.mjs — `pnpm verify:audio [baseUrl] [--clips]`
// Renders scripted bench sessions offline through the real motor model + audio engine
// (window.__propwash.renderAudio) and checks the PRD §4.9 audio criteria with measurements:
// boot tone order and pitch, spatial origin, clicks/gaps/pitch tracking over a throttle sweep,
// the transient "rip" on a throttle snap, and the coast-down after disarm.
// Writes spectrograms + a report to docs/verification/audio/. The public (procedural) path is
// always rendered; --clips also renders the recording path locally (never committed: the
// recording's license is unverified, PRD §7).
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/verification/audio');
const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173';
const WITH_CLIPS = args.includes('--clips');
const LOCAL_OUT = path.join(ROOT, 'test-results/audio-recording-path');
mkdirSync(OUT, { recursive: true });

// Must match src/config (asserted against the page below).
const F0_AT_HOVER = 294.7;
const RPM_HOVER = 11000;
const f0 = (rpm) => (F0_AT_HOVER * rpm) / RPM_HOVER;

// ── DSP helpers ────────────────────────────────────────────────────────────
function decode(b64) {
  const buf = Buffer.from(b64, 'base64');
  const i16 = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  return Float32Array.from(i16, (v) => v / 32767);
}
const rms = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));

/**
 * Perceived level (dBFS): mean power over both ears, not a mono downmix — summing L+R creates
 * cancellations no listener hears. Loudness checks use EBU-style 400 ms short-term windows,
 * which average over the natural beating of four motors at slightly different RPM.
 */
function level(r, t0, t1) {
  const a = Math.max(0, Math.round(t0 * r.sampleRate));
  const b = Math.min(r.L.length, Math.round(t1 * r.sampleRate));
  let s = 0;
  for (let i = a; i < b; i++) s += r.L[i] * r.L[i] + r.R[i] * r.R[i];
  return 10 * Math.log10(s / (2 * Math.max(1, b - a)) + 1e-18);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
}

/** Magnitude spectrum of a Hann-windowed frame. */
function spectrum(x, start, n) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  return Float64Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
}

/** Autocorrelation pitch in [lo, hi] Hz (normalized, parabolic peak). */
function pitch(x, start, n, sr, lo, hi) {
  const seg = x.subarray(start, start + n);
  const mean = seg.reduce((s, v) => s + v, 0) / n;
  const minLag = Math.floor(sr / hi);
  const maxLag = Math.ceil(sr / lo);
  let best = 0;
  let bestLag = 0;
  const r = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = seg[i] - mean;
      const b = seg[i + lag] - mean;
      s += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    r[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
  }
  for (let lag = minLag; lag <= maxLag; lag++)
    if (r[lag] > best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      best = r[lag];
      bestLag = lag;
    }
  if (!bestLag) return { hz: 0, clarity: 0 };
  const [a, b, c] = [r[bestLag - 1], r[bestLag], r[bestLag + 1]];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return { hz: sr / (bestLag + shift), clarity: best };
}

/** Clicks: |2nd difference| spikes far above the local level (±10 ms). */
function countClicks(x, sr, a, b) {
  const d = new Float32Array(b - a);
  for (let i = Math.max(a, 2); i < b; i++) d[i - a] = x[i] - 2 * x[i - 1] + x[i - 2];
  const w = Math.round(0.01 * sr);
  let clicks = 0;
  let worst = 0;
  for (let i = w; i < d.length - w; i += 1) {
    const v = Math.abs(d[i]);
    if (v < 1e-4) continue;
    if (i % 32 !== 0 && v < worst * 0.5) continue;
    const local = rms(d, i - w, i + w);
    const ratio = v / (local + 1e-6);
    worst = Math.max(worst, ratio);
    if (ratio > 12) {
      clicks++;
      i += w;
    }
  }
  return { clicks, worstRatio: +worst.toFixed(1) };
}

/** Dropouts: 10 ms RMS falling more than `limitDb` below the 100 ms average. */
function worstDip(x, sr, a, b) {
  const s = Math.round(0.01 * sr);
  const env = [];
  for (let i = a; i + s <= b; i += s) env.push(db(rms(x, i, i + s)));
  let worst = 0;
  for (let i = 5; i < env.length - 5; i++) {
    const avg = env.slice(i - 5, i + 5).reduce((t, v) => t + v, 0) / 10;
    worst = Math.max(worst, avg - env[i]);
  }
  return +worst.toFixed(2);
}

const bandEnergy = (x, sr, a, b, lo, hi) => {
  const n = 2048;
  let e = 0;
  let count = 0;
  for (let s = a; s + n <= b; s += n / 2) {
    const m = spectrum(x, s, n);
    for (let k = Math.floor((lo * n) / sr); k < Math.ceil((hi * n) / sr); k++) e += m[k] * m[k];
    count++;
  }
  return e / Math.max(1, count);
};

// ── Spectrogram ────────────────────────────────────────────────────────────
function color(t) {
  // Dark → violet → orange → pale yellow.
  const stops = [
    [0, [8, 8, 16]],
    [0.35, [70, 24, 110]],
    [0.65, [210, 70, 60]],
    [0.85, [250, 170, 40]],
    [1, [255, 250, 200]],
  ];
  for (let i = 1; i < stops.length; i++)
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((c, j) => Math.round(c + (c1[j] - c) * k));
    }
  return stops[stops.length - 1][1];
}

async function spectrogram(file, x, sr, frames, title, marks = []) {
  const W = 1200;
  const H = 420;
  const PAD = { l: 58, r: 12, t: 34, b: 34 };
  const w = W - PAD.l - PAD.r;
  const h = H - PAD.t - PAD.b;
  const n = 4096;
  const [fLo, fHi] = [40, 12000];
  const yOf = (f) => PAD.t + h - (Math.log(f / fLo) / Math.log(fHi / fLo)) * h;
  const dur = x.length / sr;
  const px = Buffer.alloc(W * H * 3, 12);
  const cols = [];
  for (let c = 0; c < w; c++) {
    const start = Math.round((c / w) * (x.length - n));
    cols.push(spectrum(x, start, n));
  }
  let peak = 0;
  for (const m of cols) for (const v of m) peak = Math.max(peak, v);
  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) {
      const f = fLo * (fHi / fLo) ** ((h - r) / h);
      const k = Math.round((f * n) / sr);
      const v = db(cols[c][k] / peak);
      const t = Math.min(1, Math.max(0, (v + 90) / 90));
      const [R, G, B] = color(t);
      const o = ((PAD.t + r) * W + PAD.l + c) * 3;
      px[o] = R;
      px[o + 1] = G;
      px[o + 2] = B;
    }
  }
  const xOf = (t) => PAD.l + (t / dur) * w;
  const pts = frames
    .filter((fr) => fr.rpms[0] > 200)
    .map((fr) => `${xOf(fr.t).toFixed(1)},${yOf(f0(fr.rpms.reduce((s, v) => s + v, 0) / 4)).toFixed(1)}`);
  const ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <style>text{font-family:Consolas,monospace;fill:#ddd}</style>
    <text x="${PAD.l}" y="22" font-size="16">${title}</text>
    ${ticks.map((f) => `<text x="${PAD.l - 6}" y="${yOf(f) + 4}" font-size="11" text-anchor="end">${f >= 1000 ? f / 1000 + 'k' : f}</text><line x1="${PAD.l}" x2="${PAD.l + 4}" y1="${yOf(f)}" y2="${yOf(f)}" stroke="#888"/>`).join('')}
    ${Array.from({ length: Math.floor(dur) + 1 }, (_, s) => `<text x="${xOf(s)}" y="${H - 12}" font-size="11" text-anchor="middle">${s}s</text>`).join('')}
    ${pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#27c7ff" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.9"/>` : ''}
    ${marks.map((m) => `<line x1="${xOf(m.t)}" x2="${xOf(m.t)}" y1="${PAD.t}" y2="${PAD.t + h}" stroke="#fff" stroke-opacity="0.35"/><text x="${xOf(m.t) + 3}" y="${PAD.t + 13}" font-size="11">${m.label}</text>`).join('')}
    <text x="${W - PAD.r}" y="22" font-size="12" text-anchor="end" fill="#27c7ff">dashed = predicted f₀ from simulated RPM</text>
  </svg>`;
  await sharp(px, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(file);
}

function wav(file, l, r, sr) {
  const n = l.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(file, b);
}

// ── Scenarios ──────────────────────────────────────────────────────────────
const SCENARIOS = {
  boot: { durationS: 2.2, steps: [{ at: 0.2, do: 'plug' }] },
  bootRight: {
    durationS: 2.2,
    steps: [{ at: 0.2, do: 'plug' }],
    // Drone on the listener's right: listener at x = −1 facing −Z.
    listener: { position: [-1, 0.07, 0], target: [-1, 0.07, -1] },
  },
  refuseThenArm: {
    durationS: 3.4,
    steps: [
      { at: 0.1, do: 'plug' },
      { at: 1.5, do: { throttle: 0.2 } },
      { at: 1.7, do: 'arm' },
      { at: 2.3, do: { throttle: 0 } },
      { at: 2.5, do: 'arm' },
    ],
  },
  sweep: {
    durationS: 6.6,
    steps: [
      { at: 0.1, do: 'plug' },
      { at: 1.5, do: 'arm' },
      { at: 2.0, do: { ramp: { to: 1, overS: 2 } } },
      { at: 4.0, do: { ramp: { to: 0, overS: 2 } } },
    ],
  },
  snap: {
    durationS: 3.2,
    steps: [
      { at: 0.1, do: 'plug' },
      { at: 1.5, do: 'arm' },
      { at: 2.2, do: { ramp: { to: 1, overS: 0.05 } } },
    ],
  },
  beacon: {
    durationS: 4.6,
    steps: [
      { at: 0.1, do: 'plug' },
      { at: 1.5, do: 'beacon' },
    ],
  },
  lowBattery: { durationS: 6.5, batterySoc: 0.02, steps: [{ at: 0.1, do: 'plug' }] },
  coast: {
    durationS: 10.5,
    steps: [
      { at: 0.1, do: 'plug' },
      { at: 1.5, do: 'arm' },
      { at: 2.0, do: { ramp: { to: 0.8, overS: 0.5 } } },
      { at: 3.2, do: 'disarm' },
    ],
  },
};

const browser = await chromium.launch({ channel: process.env.CHANNEL || undefined });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/?quality=low&dynres=0`);
await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 60_000 });

async function render(name, extra = {}) {
  const s = { ...SCENARIOS[name], ...extra };
  const r = await page.evaluate((sc) => window.__propwash.renderAudio(sc), s);
  const L = decode(r.left);
  const R = decode(r.right);
  const M = Float32Array.from(L, (v, i) => (v + R[i]) / 2);
  return { ...r, L, R, M };
}

const results = [];
const check = (path_, name, ok, detail) => {
  results.push({ path: path_, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${path_}] ${name} — ${detail}`);
};
const at = (r, t) => Math.round(t * r.sampleRate);
const evTime = (r, type) => r.frames.find((f) => f.events.includes(type))?.t;

async function runPath(clips) {
  const tag = clips ? 'recording' : 'procedural';
  const dir = clips ? LOCAL_OUT : OUT;
  mkdirSync(dir, { recursive: true });
  const saveAudio = (name, r) => {
    const file = path.join(clips ? LOCAL_OUT : path.join(ROOT, 'test-results'), `${tag}-${name}.wav`);
    mkdirSync(path.dirname(file), { recursive: true });
    wav(file, r.L, r.R, r.sampleRate);
    return file;
  };

  // Boot: tick, 3 ascending ESC tones, 2 ascending tones — from the motors.
  const boot = await render('boot', { clips });
  if (clips && boot.mode !== 'recording') throw new Error('--clips: server has no clips (run pnpm assets with ffmpeg)');
  const tOn = evTime(boot, 'escPowerOnTones');
  const tSig = evTime(boot, 'escSignalTones');
  const tones = [0, 1, 2]
    .map((i) => tOn + 0.15 * i)
    .concat([0, 1].map((i) => tSig + 0.12 * i))
    .map((t) => pitch(boot.M, at(boot, t + 0.025), 2048, boot.sampleRate, 900, 1800).hz);
  const expect = [1046.5, 1318.51, 1567.98, 1174.66, 1567.98];
  const toneErr = tones.map((f, i) => Math.abs(1200 * Math.log2(f / expect[i])));
  check(
    tag,
    'boot: 3 rising ESC tones, then 2 rising',
    toneErr.every((c) => c < 35) && tones[0] < tones[1] && tones[1] < tones[2] && tones[3] < tones[4],
    `detected ${tones.map((f) => f.toFixed(0)).join(', ')} Hz (C6 E6 G6 · D6 G6)`,
  );
  const plugT = evTime(boot, 'plugged');
  let tickPeak = 0;
  for (let i = at(boot, plugT); i < at(boot, plugT + 0.06); i++) tickPeak = Math.max(tickPeak, Math.abs(boot.M[i]));
  const preSilence = rms(boot.M, at(boot, 0.05), at(boot, 0.15));
  check(
    tag,
    'boot: XT60 tick + pop at plug-in (from silence)',
    db(tickPeak) > -30 && preSilence < 1e-4,
    `peak ${db(tickPeak).toFixed(1)} dBFS within 60 ms of plug-in; silent before (${preSilence === 0 ? 'digital silence' : db(preSilence).toFixed(0) + ' dBFS'})`,
  );
  const readyT = evTime(boot, 'ready');
  check(tag, 'boot: DISARMED after ≈1.2 s', Math.abs(readyT - plugT - 1.2) < 0.02, `${(readyT - plugT).toFixed(3)} s`);

  const right = await render('bootRight', { clips });
  const rt = evTime(right, 'escPowerOnTones');
  const [a, b] = [at(right, rt), at(right, rt + 0.45)];
  const lr = db(rms(right.R, a, b) / rms(right.L, a, b));
  check(
    tag,
    'boot: ESC tones come from the drone (drone on the right → right ear louder)',
    lr > 3,
    `R/L ${lr.toFixed(1)} dB`,
  );

  // Arm refused with throttle up, then armed at zero: smooth idle, no click.
  const ref = await render('refuseThenArm', { clips });
  const refusedAt = evTime(ref, 'armRefused');
  const afterRefuse = ref.frames.find((f) => f.t > refusedAt + 0.05);
  const beep = pitch(ref.M, at(ref, refusedAt + 0.1), 2048, ref.sampleRate, 1500, 3000).hz;
  check(
    tag,
    'arm refused at 20% throttle: stays DISARMED, THROTTLE warning, long low beep',
    afterRefuse.state === 'DISARMED' && afterRefuse.warning === 'THROTTLE' && Math.abs(beep - 2200) < 60,
    `state ${afterRefuse.state}, warning ${afterRefuse.warning}, beep ${beep.toFixed(0)} Hz`,
  );
  const armT = evTime(ref, 'armed');
  const armTrace = ref.frames.filter((f) => f.t >= armT && f.t < armT + 0.5).map((f) => f.rpms[0]);
  const rampMono = armTrace.every((v, i) => i === 0 || v >= armTrace[i - 1] - 30);
  const idleFinal = armTrace[armTrace.length - 1];
  const armClicks = countClicks(ref.M, ref.sampleRate, at(ref, armT + 0.06), at(ref, armT + 0.6));
  check(
    tag,
    'arm at 0%: props reach idle smoothly, no clicks',
    rampMono && Math.abs(idleFinal / 2400 - 1) < 0.03 && armClicks.clicks === 0,
    `idle ${idleFinal} RPM, monotonic ${rampMono}, clicks ${armClicks.clicks} (worst ${armClicks.worstRatio}×)`,
  );

  // Sweep 0 → 100% → 0 over 4 s.
  const sw = await render('sweep', { clips });
  const [s0, s1] = [at(sw, 2.05), at(sw, 5.95)];
  const cl = countClicks(sw.M, sw.sampleRate, s0, s1);
  const dip = worstDip(sw.M, sw.sampleRate, s0, s1);
  const hop = 0.05;
  const tracked = [];
  for (let t = 2.1; t < 5.9; t += hop) {
    const fr = sw.frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best));
    const mean = fr.rpms.reduce((s, v) => s + v, 0) / 4;
    const want = f0(mean);
    if (want < 70) continue;
    const got = pitch(sw.M, at(sw, t), 4096, sw.sampleRate, want / 1.6, want * 1.6);
    tracked.push({
      t,
      want,
      got: got.hz,
      cents: 1200 * Math.log2(got.hz / want),
      clarity: got.clarity,
      level: level(sw, t - 0.2, t + 0.2),
      rpm: mean,
    });
  }
  const cents = tracked.map((p) => Math.abs(p.cents)).sort((x, y) => x - y);
  const median = cents[Math.floor(cents.length / 2)];
  const within = cents.filter((c) => c < 50).length / cents.length;
  const xs = tracked.map((p) => Math.log(p.rpm));
  const ys = tracked.map((p) => p.level);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  const corr =
    xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0) /
    Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0) * ys.reduce((s, v) => s + (v - my) ** 2, 0));
  check(
    tag,
    'sweep: no clicks',
    cl.clicks === 0,
    `${cl.clicks} clicks (worst spike ${cl.worstRatio}× local level; limit 12×)`,
  );
  check(tag, 'sweep: no gaps', dip < 6, `worst 10 ms dip ${dip} dB below the 100 ms average (limit 6 dB)`);
  check(
    tag,
    'sweep: pitch follows RPM continuously',
    // ≥ 85%: the recording path carries the real recording's own slight pitch wander.
    median < 25 && within >= 0.85,
    `median error ${median.toFixed(1)} cents, ${(within * 100).toFixed(0)}% of frames within 50 cents (${tracked.length} frames)`,
  );
  check(
    tag,
    'sweep: loudness follows RPM',
    corr > 0.9,
    `correlation of 400 ms level (dB) with log RPM ${corr.toFixed(3)}`,
  );
  await spectrogram(
    path.join(dir, `sweep-${tag}.png`),
    sw.M,
    sw.sampleRate,
    sw.frames,
    `throttle sweep 0 → 100% → 0 over 4 s (${tag})`,
    [
      { t: evTime(sw, 'plugged'), label: 'plug' },
      { t: evTime(sw, 'armed'), label: 'arm' },
      { t: 2.0, label: 'sweep ↑' },
      { t: 4.0, label: 'sweep ↓' },
    ],
  );

  // Throttle snap: layer E adds a rip.
  const snap = await render('snap', { clips });
  const snapOff = await render('snap', { clips, volume: { E: 0 } });
  // The rip is short: measure the first 80 ms after the snap, before the full-throttle body takes over.
  const [a0, a1] = [at(snap, 2.2), at(snap, 2.28)];
  const rip =
    10 *
    Math.log10(
      bandEnergy(snap.M, snap.sampleRate, a0, a1, 1000, 6000) /
        bandEnergy(snapOff.M, snap.sampleRate, a0, a1, 1000, 6000),
    );
  const snapClicks = countClicks(snap.M, snap.sampleRate, at(snap, 2.1), at(snap, 3.1));
  check(
    tag,
    'snap 0 → 100% in 50 ms: transient layer E is audible',
    rip > 3,
    `+${rip.toFixed(1)} dB in 1–6 kHz over the 80 ms after the snap vs. E muted`,
  );
  check(
    tag,
    'snap: no clicks',
    snapClicks.clicks === 0,
    `${snapClicks.clicks} clicks (worst ${snapClicks.worstRatio}×)`,
  );
  await spectrogram(
    path.join(dir, `snap-${tag}.png`),
    snap.M,
    snap.sampleRate,
    snap.frames,
    `throttle snap 0 → 100% (${tag})`,
    [{ t: 2.2, label: 'snap' }],
  );

  // Coast after disarm at speed.
  const co = await render('coast', { clips });
  const dT = evTime(co, 'disarmed');
  const before = co.frames.find((f) => f.t >= dT).rpms[0];
  const after1 = co.frames.find((f) => f.t >= dT + 1).rpms[0];
  const lvl0 = level(co, dT - 0.4, dT);
  const lvl1 = level(co, dT + 0.8, dT + 1.2);
  const coastClicks = countClicks(co.M, co.sampleRate, at(co, dT + 0.25), at(co, dT + 2.5));
  // The layer curves predict ≈ 24·log10(RPM ratio) dB; one 400 ms window can land ±3 dB off it
  // because four motors at slightly different RPM beat slowly (PRD: natural beating).
  const predicted = 24 * Math.log10(after1 / before);
  const stopT = co.frames.find((f) => f.t > dT && f.rpms.every((r) => r === 0))?.t;
  const tail = stopT ? level(co, stopT + 0.4, stopT + 0.8) : 0;
  check(
    tag,
    'disarm at speed: props coast down over ~1 s with matching audio',
    after1 / before > 0.25 && after1 / before < 0.45 && lvl0 - lvl1 >= 6 && tail < -60 && coastClicks.clicks === 0,
    `RPM ${before} → ${after1} after 1 s (${((100 * after1) / before).toFixed(0)}%); level −${(lvl0 - lvl1).toFixed(1)} dB (layer curves predict ${predicted.toFixed(1)}); ${tail < -60 ? 'silent' : tail.toFixed(0) + ' dBFS'} once stopped at +${(stopT - dT).toFixed(1)} s; clicks ${coastClicks.clicks}`,
  );
  await spectrogram(
    path.join(dir, `coast-${tag}.png`),
    co.M,
    co.sampleRate,
    co.frames,
    `disarm at 80% throttle → coast (${tag})`,
    [{ t: dT, label: 'disarm' }],
  );
  await spectrogram(
    path.join(dir, `boot-${tag}.png`),
    boot.M,
    boot.sampleRate,
    boot.frames,
    `plug-in → ESC tones → ready (${tag})`,
    [
      { t: plugT, label: 'plug' },
      { t: tOn, label: 'ESC ×3' },
      { t: tSig, label: 'signal ×2' },
    ],
  );

  // DShot beacon: one ESC beep per second through the motors while toggled on.
  const bc = await render('beacon', { clips });
  /** Beep onsets: rising edges of 1–4 kHz band energy in 512-sample (≈12 ms) frames. */
  const onsets = (r, lo, hi, from, to) => {
    const n = 512;
    const hop = 0.004;
    const series = [];
    for (let t = from; t < to; t += hop) {
      const m = spectrum(r.M, at(r, t), n);
      let e = 0;
      for (let k = Math.floor((lo * n) / r.sampleRate); k <= Math.ceil((hi * n) / r.sampleRate); k++) e += m[k] * m[k];
      series.push([t, e]);
    }
    const thresh = Math.max(...series.map(([, e]) => e)) * 0.1;
    const out = [];
    series.forEach(([t, e], i) => {
      if (e > thresh && (i === 0 || series[i - 1][1] <= thresh)) out.push(+t.toFixed(3));
    });
    return out;
  };
  const beeps = onsets(bc, 1200, 4000, 1.45, 4.55);
  const gaps = beeps.slice(1).map((t, i) => t - beeps[i]);
  check(
    tag,
    'beacon: DShot beep once per second through the motors',
    beeps.length === 4 && gaps.every((g) => Math.abs(g - 1) < 0.02),
    `beeps at ${beeps.join(', ')} s`,
  );

  // Low battery: repeating FC double beep once the sag persists.
  const lb = await render('lowBattery', { clips });
  // After boot (ESC tones end ≈1.4 s); FC piezo at 4 kHz.
  const lbBeeps = onsets(lb, 3500, 4500, 1.6, 6.4);
  const pairs = lbBeeps.filter((_, i) => i % 2 === 0).map((t, i) => [t, lbBeeps[2 * i + 1]]);
  const pairOk = pairs.every(([a, b]) => b !== undefined && Math.abs(b - a - 0.2) < 0.02);
  const cadence = pairs.slice(1).map(([t], i) => t - pairs[i][0]);
  const lowAt = lb.frames.find((fr) => fr.t > 0.2 && fr.state !== 'BOOTING')?.t;
  check(
    tag,
    'low battery (3.1 V/cell): repeating FC double beep',
    pairs.length >= 2 && pairOk && cadence.every((c) => Math.abs(c - 1.5) < 0.02),
    `double beeps (0.2 s apart) starting ${pairs.map(([t]) => t.toFixed(2)).join(', ')} s, every ${cadence.map((c) => c.toFixed(2)).join('/')} s; warning after 2 s under 3.5 V/cell (ready at ${lowAt?.toFixed(2)} s)`,
  );

  // Listening copies (procedural: into test-results/, CI artifact; recording: local only).
  for (const [name, r] of [
    ['sweep', sw],
    ['snap', snap],
    ['coast', co],
    ['boot', boot],
    ['refuse-arm', ref],
  ])
    saveAudio(name, r);
}

await runPath(false);
if (WITH_CLIPS) await runPath(true);

// Encode the procedural listening copies for the repo if ffmpeg is around (small .m4a).
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
try {
  for (const name of ['sweep', 'snap', 'coast', 'boot', 'refuse-arm'])
    execFileSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      path.join(ROOT, 'test-results', `procedural-${name}.wav`),
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      path.join(OUT, `${name}-procedural.m4a`),
    ]);
  console.log('wrote docs/verification/audio/*-procedural.m4a');
} catch {
  console.log('ffmpeg not found (set FFMPEG_PATH): listening copies left as WAV in test-results/');
}

const lines = [
  '# Audio verification',
  '',
  `Generated by \`pnpm verify:audio\` (${new Date().toISOString().slice(0, 10)}). Sessions are rendered offline through the real motor model and audio engine; every number below is measured from the rendered audio.`,
  '',
  '| Path | Check | Result | Measurement |',
  '| --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.path} | ${r.name} | ${r.ok ? 'pass' : '**FAIL**'} | ${r.detail} |`),
  '',
  'The procedural path is what the public build ships. The recording path (layer A + spool one-shots) needs the git-ignored recording and is rendered only locally with `--clips`; its audio is never committed.',
  '',
];
writeFileSync(path.join(OUT, 'README.md'), lines.join('\n'));
console.log('wrote docs/verification/audio/README.md');

await browser.close();
const failed = results.filter((r) => !r.ok).length;
if (errors.length) console.error('console errors:\n' + errors.join('\n'));
if (failed || errors.length) process.exit(1);
