import { defaultSettings, FOV_RANGE_DEG, type KeyAction, type Settings } from '../app/settings';
import { CAMERAS } from '../config/cameras';
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
`;

const TABS = ['Graphics', 'Camera', 'Audio', 'Drone', 'Controls', 'Credits'] as const;

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
  private tab: (typeof TABS)[number] = 'Graphics';
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
  private check(name: string): string {
    return `<input type="checkbox" data-k="${name}">`;
  }
  private select(name: string, opts: [string, string][]): string {
    return `<select data-k="${name}">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
  }

  private sections(credit: string): string {
    const [fmin, fmax] = FOV_RANGE_DEG;
    const [umin, umax] = CAMERAS.fpv.uptiltRangeDeg;
    return `
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
      <div class="pw-pad-t"><b>R1</b>arm / disarm<b>L1 + R1</b>kill<b>Options (hold)</b>battery<b>△ / □</b>camera / feed<b>○</b>beacon<b>Touchpad</b>motor test<b>Share</b>payload</div>
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
    else if (c instanceof HTMLInputElement && c.type === 'range') v = Number(c.value);
    this.put(k, v);
    this.showValue(c);
    this.onChange?.(this.s);
  }

  private onClick(e: MouseEvent): void {
    e.stopPropagation();
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    if (t.dataset.tab) return this.showTab(t.dataset.tab as (typeof TABS)[number]);
    const a = t.dataset.a;
    if (a === 'close') this.setOpen(false);
    else if (a === 'calibrate') this.onCalibrate?.();
    else if (a === 'reset-keys') {
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
