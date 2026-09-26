import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { FLIGHT_LAB } from '../config/blackbox';
import type { Blackbox, Channel, ImportedLog } from '../sim/blackbox';
import type { FlightRecording } from '../sim/recorder';
import { stepResponse, type StepResponse } from '../sim/stepResponse';
import { injectCss, THEME } from './style';

// Flight Lab (Phase 2 PRD §8.2–§8.3): blackbox graphs live and after the flight, the step
// response, CSV export, replay, and a real Betaflight log flown through the sim and overlaid.

export interface ImportResult {
  name: string;
  log: ImportedLog;
  sim: { gyro: Float32Array[]; setpoint: Float32Array[] };
  airframe: string;
  drive: 'setpoint' | 'sticks';
}

export interface FlightLabHost {
  /** The recording in progress, else the last one. */
  recording(): FlightRecording | null;
  recordingActive(): boolean;
  exportCsv(): void;
  startReplay(): void;
  importLog(file: File, drive: 'setpoint' | 'sticks'): Promise<ImportResult>;
}

const AX = ['roll', 'pitch', 'yaw'] as const;
const AX_COLOR = { roll: '#27c7ff', pitch: '#3ddc84', yaw: '#ffb347' };
const MOTOR_COLOR = ['#27c7ff', '#3ddc84', '#ffb347', '#ff6bd6'];
const SP_COLOR = 'rgba(231,234,238,0.55)';
const REAL_COLOR = '#ffb347';
const TABS = ['Live', 'Flight', 'Step response', 'Log import'] as const;
type Tab = (typeof TABS)[number];

const CSS = `
.pw-fl {
  position: fixed; right: 16px; top: 64px; bottom: 16px; z-index: 13; width: min(760px, calc(100vw - 32px));
  padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto;
  transform: translateX(calc(100% + 24px)); transition: transform 0.22s ease; background: rgba(12,14,17,0.93);
}
.pw-fl.pw-open { transform: none; }
.pw-fl h2 { margin: 0; font-size: 12px; letter-spacing: 0.14em; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.pw-fl .pw-fl-status { color: var(--pw-dim); font-size: 11px; letter-spacing: 0.04em; font-weight: 500; }
.pw-fl .pw-fl-status b { color: var(--pw-danger); }
.pw-fl .pw-fl-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.pw-fl .pw-fl-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--pw-line); }
.pw-fl .pw-fl-tabs button { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--pw-dim); font: 600 11px var(--pw-font); letter-spacing: 0.08em; padding: 6px 8px; cursor: pointer; }
.pw-fl .pw-fl-tabs button[aria-selected="true"] { color: var(--pw-accent); border-bottom-color: var(--pw-accent); }
.pw-fl .pw-fl-body { display: grid; gap: 8px; }
.pw-fl .pw-fl-note { color: var(--pw-dim); font-size: 11px; line-height: 1.5; }
.pw-fl .pw-fl-note b { color: var(--pw-text); font-weight: 600; }
.pw-fl .pw-fl-metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px; font-size: 11px; font-variant-numeric: tabular-nums; }
.pw-fl .pw-fl-metrics div { border: 1px solid var(--pw-line); border-radius: 8px; padding: 6px 8px; }
.pw-fl .pw-fl-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pw-fl .uplot { font-family: var(--pw-font); }
.pw-fl .u-title { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; color: var(--pw-text); text-align: left; padding-left: 44px; }
.pw-fl .u-legend { font-size: 10px; color: var(--pw-dim); }
.pw-fl .u-legend .u-marker { width: 10px; height: 3px; }
.pw-fl .u-select { background: rgba(39,199,255,0.12); }
`;

function axisOpts(unit: string): uPlot.Axis[] {
  const common = {
    stroke: 'rgba(231,234,238,0.6)',
    grid: { stroke: 'rgba(255,255,255,0.07)', width: 1 },
    ticks: { stroke: 'rgba(255,255,255,0.12)', width: 1 },
    font: '10px ui-monospace, Consolas, monospace',
  };
  return [
    { ...common, values: (_u, v) => v.map((x) => `${+x.toFixed(2)}s`) },
    { ...common, size: 48, label: unit, labelSize: 14, labelFont: '10px ui-monospace, Consolas, monospace' },
  ];
}

/** Evenly thinned [from, to) of a blackbox channel (plots stay light on long flights). */
function thin(b: Blackbox, ch: Channel, from: number, to: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i += stride) out.push(b.at(i, ch));
  return out;
}

export class FlightLabPanel {
  readonly el: HTMLDivElement;
  open = false;
  private tab: Tab = 'Live';
  private body: HTMLDivElement;
  private status: HTMLSpanElement;
  private plots: uPlot[] = [];
  private since = 0;
  private builtFor: string | null = null;
  private imported: ImportResult | null = null;
  private importBusy = false;

  constructor(private host: FlightLabHost) {
    injectCss('theme', THEME);
    injectCss('flightlab', CSS);
    this.el = document.createElement('div');
    this.el.className = 'pw-fl pw-panel';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Flight Lab');
    this.el.innerHTML = `
      <h2><span>FLIGHT LAB <span class="pw-fl-status"></span></span>
        <span class="pw-fl-actions">
          <button type="button" class="pw-btn" data-a="csv" title="Betaflight blackbox_decode-style CSV">EXPORT CSV</button>
          <button type="button" class="pw-btn" data-a="replay" title="Replay the last flight (Y)">REPLAY</button>
          <button type="button" class="pw-btn" data-a="close" aria-label="Close">✕</button>
        </span></h2>
      <div class="pw-fl-tabs" role="tablist">${TABS.map((t) => `<button type="button" role="tab" data-tab="${t}">${t.toUpperCase()}</button>`).join('')}</div>
      <div class="pw-fl-body"></div>`;
    this.body = this.el.querySelector('.pw-fl-body')!;
    this.status = this.el.querySelector('.pw-fl-status')!;
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.tab) this.setTab(b.dataset.tab as Tab);
      else if (b.dataset.a === 'csv') this.host.exportCsv();
      else if (b.dataset.a === 'replay') this.host.startReplay();
      else if (b.dataset.a === 'close') this.setOpen(false);
    });
    // Keys typed in the panel's inputs must not fly the drone.
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(this.el);
    this.setTab('Live');
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.el.classList.toggle('pw-open', open);
    this.builtFor = null;
    if (open) this.render();
  }

  setTab(t: Tab): void {
    this.tab = t;
    this.el
      .querySelectorAll<HTMLButtonElement>('[data-tab]')
      .forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    this.builtFor = null;
    this.render();
  }

  /** Per frame: the status line always; live plots at FLIGHT_LAB.liveHz while open. */
  update(dt: number): void {
    const r = this.host.recording();
    const active = this.host.recordingActive();
    const text = r
      ? `${active ? '<b>● REC</b> ' : 'LAST FLIGHT '}${r.blackbox.duration.toFixed(1)} s · ${r.airframeId} · seed ${r.seed}`
      : 'arm to record';
    if (this.status.innerHTML !== text) this.status.innerHTML = text;
    if (!this.open) return;
    this.since += dt;
    if (this.tab === 'Live' && this.since >= 1 / FLIGHT_LAB.liveHz) {
      this.since = 0;
      this.render();
    } else if ((this.tab === 'Flight' || this.tab === 'Step response') && this.builtFor !== this.key(r)) this.render();
  }

  private key(r: FlightRecording | null): string {
    return r ? `${r.startedAt.getTime()}:${this.host.recordingActive() ? 'live' : r.blackbox.length}` : 'none';
  }

  private clearPlots(): void {
    for (const p of this.plots) p.destroy();
    this.plots = [];
  }

  private width(): number {
    return Math.max(280, this.body.clientWidth || 700);
  }

  private render(): void {
    if (!this.open) return;
    const r = this.host.recording();
    if (this.tab === 'Live') return this.renderTraces(r, true);
    if (this.builtFor === this.key(r) && this.tab !== 'Log import') return;
    this.builtFor = this.key(r);
    if (this.tab === 'Flight') this.renderTraces(r, false);
    else if (this.tab === 'Step response') this.renderStep(r);
    else this.renderImport();
  }

  /** Setpoint vs gyro per axis, and the motors: the last few seconds (live) or the whole flight. */
  private renderTraces(r: FlightRecording | null, live: boolean): void {
    if (!r || r.blackbox.length < 2) {
      this.clearPlots();
      this.body.innerHTML = `<p class="pw-fl-note">Nothing recorded yet. <b>Arm</b> to start a recording: the blackbox logs at 500 Hz from arming until ${3} s after the disarm. Then this tab shows the sticks' setpoint against the gyro on each axis and the four motors.</p>`;
      return;
    }
    const b = r.blackbox;
    const n = b.length;
    const from = live ? Math.max(0, n - FLIGHT_LAB.liveWindowS * b.rateHz) : 0;
    const stride = Math.max(1, Math.ceil((n - from) / (live ? 900 : 4000)));
    const t: number[] = [];
    for (let i = from; i < n; i += stride) t.push(b.time(i));
    const series: {
      title: string;
      unit: string;
      lines: { label: string; ch: Channel; color: string; dash?: number[]; scale?: number }[];
    }[] = [
      ...AX.map((a) => ({
        title: a.toUpperCase(),
        unit: '°/s',
        lines: [
          { label: 'setpoint', ch: `sp.${a}` as Channel, color: SP_COLOR, dash: [4, 3] },
          { label: 'gyro', ch: `gyro.${a}` as Channel, color: AX_COLOR[a] },
        ],
      })),
      {
        title: 'MOTORS',
        unit: '%',
        lines: [0, 1, 2, 3].map((m) => ({
          label: `M${m + 1}`,
          ch: `motor.${m}` as Channel,
          color: MOTOR_COLOR[m],
          scale: 100,
        })),
      },
    ];
    if (!live) series.push({ title: 'BATTERY', unit: 'V', lines: [{ label: 'vbat', ch: 'vbat', color: '#e7eaee' }] });
    const data = series.map((s) => [
      t,
      ...s.lines.map((l) => thin(b, l.ch, from, n, stride).map((v) => v * (l.scale ?? 1))),
    ]);
    // Live: reuse the plots and just swap the data.
    if (live && this.plots.length === series.length && this.body.dataset.view === 'live') {
      this.plots.forEach((p, k) => p.setData(data[k] as uPlot.AlignedData));
      return;
    }
    this.clearPlots();
    this.body.dataset.view = live ? 'live' : 'flight';
    this.body.innerHTML = live
      ? ''
      : `<p class="pw-fl-note">The whole recording (${b.duration.toFixed(1)} s at ${b.rateHz} Hz). Drag across a plot to zoom, double-click to zoom out.</p>`;
    const w = this.width();
    series.forEach((s, k) => {
      const div = document.createElement('div');
      this.body.appendChild(div);
      const opts: uPlot.Options = {
        title: s.title,
        width: w,
        height: live ? 120 : 140,
        cursor: { drag: { x: !live, y: false }, sync: { key: 'pw-fl' } },
        scales: { x: { time: false } },
        axes: axisOpts(s.unit),
        legend: { show: true },
        series: [
          {},
          ...s.lines.map((l) => ({
            label: l.label,
            stroke: l.color,
            width: 1.25,
            dash: l.dash,
            points: { show: false },
          })),
        ],
      };
      this.plots.push(new uPlot(opts, data[k] as uPlot.AlignedData, div));
    });
  }

  private renderStep(r: FlightRecording | null): void {
    this.clearPlots();
    this.body.dataset.view = 'step';
    if (!r || r.blackbox.duration < 3) {
      this.body.innerHTML = `<p class="pw-fl-note">Needs a recording of at least a few seconds with stick movement. The step response is estimated from the flight itself (PIDtoolbox-style deconvolution of gyro by setpoint), so fly some rolls, flips and stick snaps, then look here.</p>`;
      return;
    }
    const b = r.blackbox;
    const res = AX.map((a) => stepResponse(b.series(`sp.${a}`), b.series(`gyro.${a}`), b.rateHz));
    this.body.innerHTML = `<p class="pw-fl-note">Step response from ${b.duration.toFixed(1)} s of flight: the gyro's response to a unit step of setpoint, averaged over 2 s windows (Wiener deconvolution, as in PIDtoolbox). 1.0 = on target.</p>
      <div class="pw-fl-metrics">${AX.map((a, k) => metric(a, res[k])).join('')}</div>`;
    this.plotSteps(res.map((s, k) => ({ s, label: AX[k], color: AX_COLOR[AX[k]] })));
  }

  private plotSteps(curves: { s: StepResponse | null; label: string; color: string; dash?: number[] }[]): void {
    const ok = curves.filter((c) => c.s);
    if (!ok.length) return;
    const t = Array.from(ok[0].s!.t);
    const div = document.createElement('div');
    this.body.appendChild(div);
    this.plots.push(
      new uPlot(
        {
          title: 'STEP RESPONSE',
          width: this.width(),
          height: 220,
          scales: { x: { time: false }, y: { range: [0, 1.6] } },
          axes: axisOpts('response'),
          series: [
            {},
            ...ok.map((c) => ({ label: c.label, stroke: c.color, width: 1.5, dash: c.dash, points: { show: false } })),
          ],
        },
        [t, ...ok.map((c) => Array.from(c.s!.y))] as uPlot.AlignedData,
        div,
      ),
    );
  }

  private renderImport(): void {
    this.clearPlots();
    this.body.dataset.view = 'import';
    const im = this.imported;
    this.body.innerHTML = `
      <p class="pw-fl-note">Load a <b>real Betaflight blackbox log</b>, decoded to CSV with <b>blackbox_decode</b>. Its rate setpoints (or sticks) and throttle fly this sim's flight controller and airframe; the sim's gyro is overlaid on the real one, with both step responses. Tune the airframe until they match (PRD §8.3). A CSV exported from here works too (a synthetic log).</p>
      <div class="pw-fl-row">
        <input type="file" accept=".csv,text/csv" data-k="file">
        <label>Drive by <select data-k="drive"><option value="setpoint">the log's setpoints</option><option value="sticks">its sticks (through these rates)</option></select></label>
      </div>
      <div data-k="out" class="pw-fl-body">${this.importBusy ? '<p class="pw-fl-note">Flying the log through the sim…</p>' : ''}</div>`;
    const file = this.body.querySelector<HTMLInputElement>('[data-k="file"]')!;
    const drive = this.body.querySelector<HTMLSelectElement>('[data-k="drive"]')!;
    if (im) drive.value = im.drive;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      this.importBusy = true;
      this.renderImport();
      this.host
        .importLog(f, drive.value as 'setpoint' | 'sticks')
        .then((res) => {
          this.imported = res;
        })
        .catch((err: unknown) => {
          this.imported = null;
          this.importError = err instanceof Error ? err.message : String(err);
        })
        .finally(() => {
          this.importBusy = false;
          this.renderImport();
        });
    });
    const out = this.body.querySelector<HTMLDivElement>('[data-k="out"]')!;
    if (this.importError && !im) {
      out.innerHTML = `<p class="pw-fl-note" style="color:var(--pw-warn)">${this.importError}</p>`;
      this.importError = '';
      return;
    }
    if (!im || this.importBusy) return;
    const L = im.log;
    const n = L.time.length;
    const stride = Math.max(1, Math.ceil(n / 4000));
    const t: number[] = [];
    for (let i = 0; i < n; i += stride) t.push(L.time[i]);
    const pick = (a: Float32Array) => {
      const o: number[] = [];
      for (let i = 0; i < n; i += stride) o.push(a[i]);
      return o;
    };
    const rms = AX.map((_, k) => {
      let e = 0;
      let sig = 0;
      for (let i = 0; i < n; i++) {
        e += (im.sim.gyro[k][i] - L.gyro[k][i]) ** 2;
        sig += L.gyro[k][i] ** 2;
      }
      return { err: Math.sqrt(e / n), sig: Math.sqrt(sig / n) };
    });
    const sp = L.setpoint ?? im.sim.setpoint;
    const real = AX.map((_, k) => stepResponse(sp[k], L.gyro[k], L.rateHz));
    const sim = AX.map((_, k) => stepResponse(im.sim.setpoint[k], im.sim.gyro[k], L.rateHz));
    out.innerHTML = `<p class="pw-fl-note"><b>${im.name}</b>: ${n.toLocaleString('en-US')} rows, ${L.time[n - 1].toFixed(1)} s at ${L.rateHz.toFixed(0)} Hz, flown through <b>${im.airframe}</b> by its ${im.drive}. Amber = the log, colour = the sim.</p>
      <div class="pw-fl-metrics">${AX.map(
        (a, k) =>
          `<div><b>${a.toUpperCase()}</b> gyro RMS error ${rms[k].err.toFixed(1)} °/s (signal ${rms[k].sig.toFixed(0)})<br>` +
          `step 90%: log ${fmtMs(real[k]?.rise90)} · sim ${fmtMs(sim[k]?.rise90)}<br>overshoot: log ${fmtPct(real[k]?.overshoot)} · sim ${fmtPct(sim[k]?.overshoot)}</div>`,
      ).join('')}</div>`;
    const w = this.width();
    AX.forEach((a, k) => {
      const div = document.createElement('div');
      out.appendChild(div);
      this.plots.push(
        new uPlot(
          {
            title: `${a.toUpperCase()} GYRO: LOG vs SIM`,
            width: w,
            height: 140,
            cursor: { drag: { x: true, y: false }, sync: { key: 'pw-fl-imp' } },
            scales: { x: { time: false } },
            axes: axisOpts('°/s'),
            series: [
              {},
              { label: 'setpoint', stroke: SP_COLOR, width: 1, dash: [4, 3], points: { show: false } },
              { label: 'log gyro', stroke: REAL_COLOR, width: 1.25, points: { show: false } },
              { label: 'sim gyro', stroke: AX_COLOR[a], width: 1.25, points: { show: false } },
            ],
          },
          [t, pick(sp[k]), pick(L.gyro[k]), pick(im.sim.gyro[k])] as uPlot.AlignedData,
          div,
        ),
      );
    });
    const tmp = this.body;
    this.body = out;
    this.plotSteps([
      ...AX.map((a, k) => ({ s: real[k], label: `${a} log`, color: REAL_COLOR, dash: [4, 3] })),
      ...AX.map((a, k) => ({ s: sim[k], label: `${a} sim`, color: AX_COLOR[a] })),
    ]);
    this.body = tmp;
  }
  private importError = '';
}

const fmtMs = (v: number | undefined) =>
  v === undefined || !Number.isFinite(v) ? 'n/a' : `${(v * 1000).toFixed(0)} ms`;
const fmtPct = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(0)}%`);

function metric(axis: string, s: StepResponse | null): string {
  if (!s) return `<div><b>${axis.toUpperCase()}</b> not enough stick movement on this axis</div>`;
  return `<div><b>${axis.toUpperCase()}</b> 50% ${fmtMs(s.delay50)} · 90% ${fmtMs(s.rise90)}<br>overshoot ${fmtPct(s.overshoot)} · ${s.segments} windows</div>`;
}
