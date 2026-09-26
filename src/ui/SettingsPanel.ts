import { defaultSettings, FOV_RANGE_DEG, type KeyAction, type Settings } from '../app/settings';
import { CAMERAS } from '../config/cameras';
import { RATES, type RatesModel } from '../config/fc';
import { rate } from '../sim/fc/rates';
import { injectCss, THEME } from './style';

const CSS = `
.pw-set {
  position: fixed; right: 16px; top: 64px; bottom: 16px; z-index: 13; width: min(380px, calc(100vw - 32px));
  display: flex; flex-direction: column; background: rgba(12,14,17,0.94);
  transform: translateX(calc(100% + 24px)); transition: transform 0.22s ease;
}
.pw-set.pw-open { transform: none; }
.pw-set header { display: flex; justify-content: space-between; align-items: center; padding: 14px 14px 10px; border-bottom: 1px solid var(--pw-line); }
.pw-set header h2 { margin: 0; font-size: 12px; letter-spacing: 0.14em; }
.pw-set nav { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 14px 0; }
.pw-set nav button { padding: 6px 8px; }
.pw-set .pw-body { overflow-y: auto; padding: 12px 14px 16px; display: grid; gap: 10px; align-content: start; flex: 1; }
.pw-set section { display: none; gap: 10px; }
.pw-set section.pw-on { display: grid; }
.pw-set h3 { margin: 6px 0 0; font-size: 10px; letter-spacing: 0.16em; color: var(--pw-dim); font-weight: 600; }
.pw-set .pw-f { display: grid; grid-template-columns: 1fr 150px; gap: 10px; align-items: center; }
.pw-set .pw-f > span { display: grid; gap: 1px; }
.pw-set .pw-f small { color: var(--pw-dim); font-size: 10px; }
.pw-set .pw-f .pw-rng { display: grid; grid-template-columns: 1fr 42px; gap: 6px; align-items: center; }
.pw-set .pw-f .pw-rng output { text-align: right; font-variant-numeric: tabular-nums; color: var(--pw-accent); font-size: 11px; }
.pw-set .pw-f input[type=checkbox] { justify-self: end; width: 16px; height: 16px; accent-color: var(--pw-accent); }
.pw-set .pw-f select { justify-self: stretch; }
.pw-set .pw-keys-t { display: grid; grid-template-columns: 1fr auto; gap: 5px 10px; align-items: center; }
.pw-set .pw-keys-t button { min-width: 92px; }
.pw-set .pw-keys-t button.pw-listen { border-color: var(--pw-warn); color: var(--pw-warn); }
.pw-set .pw-credits p { margin: 0 0 8px; color: var(--pw-dim); font-size: 11px; line-height: 1.5; }
.pw-set .pw-credits a { color: var(--pw-accent); }
.pw-set .pw-credits b { color: var(--pw-text); }
.pw-set .pw-pad-t { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 11px; color: var(--pw-dim); }
.pw-set .pw-pad-t b { color: var(--pw-text); font-weight: 600; }
.pw-set input[type=number] {
  width: 100%; box-sizing: border-box; font: 500 12px var(--pw-font); color: var(--pw-text);
  background: #1a1f25; border: 1px solid var(--pw-line-strong); border-radius: 6px; padding: 4px 6px;
}
.pw-set .pw-rates { display: grid; grid-template-columns: 1fr repeat(3, 70px); gap: 6px; align-items: end; }
.pw-set .pw-rates label { display: grid; gap: 2px; }
.pw-set .pw-rates small { color: var(--pw-dim); font-size: 9px; }
.pw-set .pw-pid { display: grid; grid-template-columns: 1fr repeat(4, 54px); gap: 6px 6px; align-items: center; }
.pw-set .pw-pid b { text-align: center; color: var(--pw-dim); font-size: 10px; }
.pw-set .pw-rate-curve { width: 100%; height: auto; border: 1px solid var(--pw-line); border-radius: 8px; }
`;

const TABS = ['Flight', 'Graphics', 'Camera', 'Audio', 'Drone', 'Controls', 'Credits'] as const;

/** What the three rate numbers mean in each model. */
const RATE_LABELS: Record<RatesModel, [string, string, string]> = {
  actual: ['Center (°/s)', 'Max rate (°/s)', 'Expo'],
  betaflight: ['RC rate', 'Super rate', 'RC expo'],
  raceflight: ['Rate (°/s)', 'Acro+', 'Expo'],
  kiss: ['RC rate', 'Rate', 'RC curve'],
};

const LAYERS: [keyof Settings['layers'], string, string][] = [
  ['A', 'A · Recorded body', 'Only with the local recording (not in the public build)'],
  ['B', 'B · Blade-pass tone', 'Pitched motor tone from the measured harmonics'],
  ['C', 'C · Motor whine', 'Electrical whine, loudest at low RPM'],
  ['D', 'D · Air / prop wash', 'Band-passed noise tracking RPM'],
  ['E', 'E · Transients', 'The "rip" on throttle snaps'],
  ['beeps', 'Beeps', 'ESC tones and FC buzzer'],
];

const KEY_LABELS: Record<KeyAction, string> = {
  plugToggle: 'Plug / unplug battery',
  armToggle: 'Arm / disarm',
  kill: 'Kill',
  throttleUp: 'Throttle up (hold)',
  throttleDown: 'Throttle down (hold)',
  throttleZero: 'Throttle to 0',
  cameraCycle: 'Cycle camera',
  feedCycle: 'Cycle feed style',
  beaconToggle: 'Beacon',
  motorTest: 'Motor test panel',
  payloadToggle: 'Payload toggle',
  hideUi: 'Hide UI',
  fullscreen: 'Fullscreen',
  settings: 'Settings',
  reset: 'Reset to launch pad',
  modeCycle: 'Flight mode (Acro / Angle / Horizon)',
  turtleToggle: 'Turtle mode (flip over after crash)',
  yawLeft: 'Yaw left',
  yawRight: 'Yaw right',
  pitchForward: 'Pitch forward',
  pitchBack: 'Pitch back',
  rollLeft: 'Roll left',
  rollRight: 'Roll right',
  fast: 'Fast throttle modifier',
};

export const keyLabel = (code: string) =>
  code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad(\d)$/, 'Num $1')
    .replace(
      /^(Shift|Control|Alt)(Left|Right)$/,
      (_, k: string, s: string) => `${s[0]}-${k === 'Control' ? 'Ctrl' : k}`,
    )
    .replace(/^Arrow/, '');

/** Settings (PRD §4.8). Every change is applied live and saved through `onChange`. */
export class SettingsPanel {
  readonly el: HTMLDivElement;
  open = false;
  onChange?: (s: Settings) => void;
  onCalibrate?: () => void;
  private s: Settings;
  private tab: (typeof TABS)[number] = 'Flight';
  private listening: KeyAction | null = null;

  constructor(settings: Settings, credit: string, parent: HTMLElement = document.body) {
    injectCss('theme', THEME);
    injectCss('settings', CSS);
    this.s = settings;
    this.el = document.createElement('div');
    this.el.className = 'pw-set pw-panel';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Settings');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.inert = true;
    this.el.innerHTML = `<header><h2>SETTINGS</h2><button type="button" class="pw-btn" data-a="close">CLOSE</button></header>
      <nav role="tablist">${TABS.map((t) => `<button type="button" role="tab" class="pw-btn" data-tab="${t}">${t.toUpperCase()}</button>`).join('')}</nav>
      <div class="pw-body">${this.sections(credit)}</div>`;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e.target as HTMLInputElement | HTMLSelectElement));
    this.el.addEventListener('change', (e) => this.onInput(e.target as HTMLInputElement | HTMLSelectElement));
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    // While waiting for a key to bind, take it before anything else (focus may be on the page).
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.listening) return;
        e.stopImmediatePropagation();
        this.onKey(e);
      },
      true,
    );
    parent.appendChild(this.el);
    this.showTab(this.tab);
    this.sync();
  }

  get settings(): Settings {
    return this.s;
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.listening = null;
    this.el.classList.toggle('pw-open', open);
    this.el.setAttribute('aria-hidden', String(!open));
    this.el.inert = !open;
    this.renderKeys();
    if (open) (this.el.querySelector(`[data-tab="${this.tab}"]`) as HTMLElement).focus({ preventScroll: true });
  }

  /** Change settings from outside (e.g. V pressed): refresh the controls without re-emitting. */
  patch(p: Partial<Settings>): void {
    Object.assign(this.s, p);
    this.sync();
  }

  private field(label: string, hint: string, control: string): string {
    return `<label class="pw-f"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span>${control}</label>`;
  }
  private range(name: string, min: number, max: number, step: number): string {
    return `<span class="pw-rng"><input type="range" data-k="${name}" min="${min}" max="${max}" step="${step}"><output data-o="${name}"></output></span>`;
  }
  private num(name: string, step: number): string {
    return `<input type="number" data-k="${name}" step="${step}" inputmode="decimal">`;
  }
  private check(name: string): string {
    return `<input type="checkbox" data-k="${name}">`;
  }
  private select(name: string, opts: [string, string][]): string {
    return `<select data-k="${name}">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
  }

  private sections(credit: string): string {
    const [fmin, fmax] = FOV_RANGE_DEG;
    const [umin, umax] = CAMERAS.fpv.uptiltRangeDeg;
    const pid = (axis: 'pidRP' | 'pidYaw') =>
      `<div class="pw-pid"><span></span><b>P</b><b>I</b><b>D</b><b>F</b><span>${axis === 'pidRP' ? 'Roll / pitch' : 'Yaw'}</span>${[
        'p',
        'i',
        'd',
        'f',
      ]
        .map((t) => this.num(`${axis}.${t}`, 1))
        .join('')}</div>`;
    const rates = (axis: 'ratesRP' | 'ratesYaw') =>
      `<div class="pw-rates"><span>${axis === 'ratesRP' ? 'Roll / pitch' : 'Yaw'}</span>${['a', 'b', 'c']
        .map((t, i) => `<label><small data-rl="${i}"></small>${this.num(`${axis}.${t}`, t === 'c' ? 0.01 : 1)}</label>`)
        .join('')}</div>`;
    return `
    <section data-sec="Flight">
      ${this.field(
        'Flight mode',
        'Q / L2 cycles in flight',
        this.select('flightMode', [
          ['acro', 'Acro (rate)'],
          ['angle', 'Angle (self-level)'],
          ['horizon', 'Horizon'],
        ]),
      )}
      ${this.field('Airmode', 'Keeps control authority at zero throttle', this.check('airmode'))}
      ${this.field('Ideal sensors', 'Debug: no gyro noise, vibration or filter lag', this.check('idealSensors'))}
      ${this.field('Crash detection', 'Disarm on a hard impact (off in Betaflight by default)', this.check('crashDetection'))}
      <h3>RATES</h3>
      ${this.field(
        'Rates model',
        '',
        this.select('ratesModel', [
          ['actual', 'Actual (Betaflight default)'],
          ['betaflight', 'Betaflight'],
          ['raceflight', 'RaceFlight'],
          ['kiss', 'KISS'],
        ]),
      )}
      ${rates('ratesRP')}
      ${rates('ratesYaw')}
      <canvas class="pw-rate-curve" width="680" height="260" aria-label="Rates preview: stick deflection against rotation rate"></canvas>
      <h3>PID (BETAFLIGHT NUMBERS)</h3>
      ${pid('pidRP')}
      ${pid('pidYaw')}
      <button type="button" class="pw-btn" data-a="reset-flight">RESET RATES AND PIDS</button>
    </section>
    <section data-sec="Graphics">
      ${this.field(
        'Quality preset',
        'Auto picks from the first frames',
        this.select('quality', [
          ['auto', 'Auto'],
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
          ['ultra', 'Ultra'],
        ]),
      )}
      ${this.field('FPS counter', 'Shown in the HUD', this.check('showFps'))}
    </section>
    <section data-sec="Camera">
      ${this.field(
        'FPV feed',
        'Also V / Square',
        this.select('feed', [
          ['analog', 'Analog 4:3'],
          ['digital', 'Digital HD 16:9'],
        ]),
      )}
      ${this.field('Camera uptilt', 'Degrees', this.range('uptiltDeg', umin, umax, 1))}
      ${this.field('FPV field of view', 'Horizontal, before the fisheye', this.range('fpvFovDeg', fmin, fmax, 1))}
      ${this.field('Whip-pan on camera cuts', '', this.check('whipPan'))}
      ${this.field('HD rolling-shutter jello', 'Follows frame vibration', this.check('jello'))}
    </section>
    <section data-sec="Audio">
      ${this.field('Master volume', '', this.range('volume', 0, 1, 0.01))}
      <h3>LAYERS</h3>
      ${LAYERS.map(([k, l, h]) => this.field(l, h, this.range(`layers.${k}`, 0, 1.5, 0.05))).join('')}
    </section>
    <section data-sec="Drone">
      ${this.field('Payload canister', 'Also L / Share', this.check('payload'))}
      ${this.field('Soft arm', 'Idle ramps over 600 ms instead of 150 ms', this.check('softArm'))}
    </section>
    <section data-sec="Controls">
      <h3>GAMEPAD</h3>
      ${this.field(
        'Throttle',
        'Stick: Mode 2 left stick',
        this.select('throttleSource', [
          ['trigger', 'R2 trigger'],
          ['stick', 'Left stick'],
        ]),
      )}
      ${this.field('Stick throttle hold', 'Push to raise, release to hold', this.check('throttleHold'))}
      ${this.field('Stick deadzone', '', this.range('deadzone', 0, 0.3, 0.01))}
      ${this.field('Stick expo', '', this.range('expo', 0, 1, 0.05))}
      ${this.field('Rumble', 'Chrome desktop', this.check('rumble'))}
      <div class="pw-pad-t"><b>R1</b>arm / disarm<b>L1 + R1</b>kill<b>Options (hold)</b>battery<b>△ / □</b>camera / feed<b>○</b>beacon<b>Touchpad</b>motor test<b>Share</b>payload<b>D-pad ↓</b>reset to pad<b>L2</b>flight mode<b>D-pad ↑</b>turtle mode</div>
      <h3>RC RADIO</h3>
      <button type="button" class="pw-btn" data-a="calibrate">CALIBRATE RADIO…</button>
      <h3>KEYBOARD <small style="letter-spacing:0">(click, then press a key)</small></h3>
      <div class="pw-keys-t"></div>
      <button type="button" class="pw-btn" data-a="reset-keys">RESET KEYS</button>
    </section>
    <section data-sec="Credits" class="pw-credits">
      <p><b>Drone model.</b> ${credit}</p>
      <p>Changes were made: split into parts, re-scaled to meters, textures re-encoded.</p>
      <p><b>Environment.</b> <a href="https://polyhaven.com/a/studio_small_09" target="_blank" rel="noopener">Studio Small 09</a> by Sergej Majboroda, Poly Haven, CC0.</p>
      <p><b>Audio.</b> Motor sound and beeps are synthesized in the browser; no recordings ship.</p>
      <p><b>Code.</b> PROPWASH is open source under the MIT license: <a href="https://github.com/notfeylo/propwash" target="_blank" rel="noopener">github.com/notfeylo/propwash</a></p>
    </section>
    <button type="button" class="pw-btn" data-a="reset-all">RESET ALL SETTINGS</button>`;
  }

  private showTab(tab: (typeof TABS)[number]): void {
    this.tab = tab;
    this.el.querySelectorAll('section').forEach((s) => s.classList.toggle('pw-on', s.dataset.sec === tab));
    this.el
      .querySelectorAll<HTMLElement>('[data-tab]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  }

  private get(path: string): unknown {
    const [a, b] = path.split('.');
    const v = (this.s as unknown as Record<string, unknown>)[a];
    return b ? (v as Record<string, unknown>)[b] : v;
  }
  private put(path: string, value: unknown): void {
    const [a, b] = path.split('.');
    if (b) (this.s as unknown as Record<string, Record<string, unknown>>)[a][b] = value;
    else (this.s as unknown as Record<string, unknown>)[a] = value;
  }

  private sync(): void {
    this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((c) => {
      const v = this.get(c.dataset.k!);
      if (c instanceof HTMLInputElement && c.type === 'checkbox') c.checked = !!v;
      else c.value = String(v);
      this.showValue(c);
    });
    this.renderKeys();
    this.drawRates();
  }

  private showValue(c: HTMLInputElement | HTMLSelectElement): void {
    const out = this.el.querySelector<HTMLOutputElement>(`[data-o="${c.dataset.k}"]`);
    if (!out) return;
    const k = c.dataset.k!;
    const n = Number(c.value);
    out.textContent = k.endsWith('Deg')
      ? `${n}°`
      : k === 'deadzone' || k === 'expo'
        ? n.toFixed(2)
        : `${Math.round(n * 100)}%`;
  }

  private onInput(c: HTMLInputElement | HTMLSelectElement): void {
    const k = c?.dataset?.k;
    if (!k) return;
    let v: unknown = c.value;
    if (c instanceof HTMLInputElement && c.type === 'checkbox') v = c.checked;
    else if (c instanceof HTMLInputElement && (c.type === 'range' || c.type === 'number')) {
      v = Number(c.value);
      if (!Number.isFinite(v as number)) return;
    }
    this.put(k, v);
    if (k === 'ratesModel') {
      // A new model starts from its own defaults: the numbers mean different things.
      const d = RATES.defaults[v as RatesModel];
      this.s.ratesRP = { ...d };
      this.s.ratesYaw = { ...d };
      this.sync();
    }
    this.showValue(c);
    this.drawRates();
    this.onChange?.(this.s);
  }

  /** Stick → rate curves for roll/pitch and yaw, with the full-stick rate. */
  private drawRates(): void {
    const cv = this.el.querySelector<HTMLCanvasElement>('.pw-rate-curve');
    if (!cv) return;
    const model = this.s.ratesModel;
    this.el
      .querySelectorAll<HTMLElement>('[data-rl]')
      .forEach((el) => (el.textContent = RATE_LABELS[model][Number(el.dataset.rl)]));
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    const pad = 34;
    const top = Math.max(rate(model, 1, this.s.ratesRP), rate(model, 1, this.s.ratesYaw), 200);
    const yMax = Math.ceil(top / 200) * 200;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '20px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(231,234,238,0.5)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let v = 0; v <= yMax; v += 200) {
      const y = H - pad - (v / yMax) * (H - 2 * pad);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - 8, y);
      ctx.stroke();
      ctx.fillText(String(v), 0, y + 7);
    }
    const plot = (p: typeof this.s.ratesRP, color: string, label: string, row: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const x = pad + (i / 100) * (W - pad - 8);
        const y = H - pad - (rate(model, i / 100, p) / yMax) * (H - 2 * pad);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(`${label} ${Math.round(rate(model, 1, p))}°/s`, pad + 10, 28 + row * 24);
    };
    plot(this.s.ratesRP, '#27c7ff', 'ROLL/PITCH', 0);
    plot(this.s.ratesYaw, '#ffb347', 'YAW', 1);
    ctx.fillStyle = 'rgba(231,234,238,0.5)';
    ctx.fillText('stick →', W - 110, H - 6);
  }

  private onClick(e: MouseEvent): void {
    e.stopPropagation();
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    if (t.dataset.tab) return this.showTab(t.dataset.tab as (typeof TABS)[number]);
    const a = t.dataset.a;
    if (a === 'close') this.setOpen(false);
    else if (a === 'calibrate') this.onCalibrate?.();
    else if (a === 'reset-flight') {
      const d = defaultSettings();
      Object.assign(this.s, {
        ratesModel: d.ratesModel,
        ratesRP: d.ratesRP,
        ratesYaw: d.ratesYaw,
        pidRP: d.pidRP,
        pidYaw: d.pidYaw,
      });
      this.sync();
      this.onChange?.(this.s);
    } else if (a === 'reset-keys') {
      this.s.keys = defaultSettings().keys;
      this.renderKeys();
      this.onChange?.(this.s);
    } else if (a === 'reset-all') {
      const keep = this.tab;
      this.s = defaultSettings();
      this.sync();
      this.showTab(keep);
      this.onChange?.(this.s);
    } else if (t.dataset.key) {
      this.listening = this.listening === t.dataset.key ? null : (t.dataset.key as KeyAction);
      this.renderKeys();
    }
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation(); // typing in the panel never drives the sim
    if (this.listening) {
      e.preventDefault();
      if (e.code !== 'Escape') {
        const action = this.listening;
        for (const k of Object.keys(this.s.keys) as KeyAction[])
          this.s.keys[k] = this.s.keys[k].filter((c) => c !== e.code);
        this.s.keys[action] = [e.code];
        this.onChange?.(this.s);
      }
      this.listening = null;
      this.renderKeys();
      return;
    }
    if (e.code === 'Escape') this.setOpen(false);
  }

  private renderKeys(): void {
    const t = this.el.querySelector('.pw-keys-t');
    if (!t) return;
    t.innerHTML = (Object.keys(KEY_LABELS) as KeyAction[])
      .map((k) => {
        const on = this.listening === k;
        const codes = this.s.keys[k] ?? [];
        return `<span>${KEY_LABELS[k]}</span><button type="button" class="pw-btn${on ? ' pw-listen' : ''}" data-key="${k}">${on ? 'PRESS A KEY' : codes.map(keyLabel).join(' / ') || '—'}</button>`;
      })
      .join('');
  }
}
