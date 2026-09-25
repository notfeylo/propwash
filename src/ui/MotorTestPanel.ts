import { DRONE, SPIN_ARROWS } from '../config/drone';
import { injectCss, THEME } from './style';

export type MotorTestStatus = 'unpowered' | 'booting' | 'armed' | 'ready';

const CSS = `
.pw-mt {
  position: fixed; right: 16px; top: 64px; bottom: 16px; z-index: 12; width: 316px;
  padding: 14px 14px 12px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto;
  transform: translateX(calc(100% + 24px)); transition: transform 0.22s ease; background: rgba(12,14,17,0.9);
}
.pw-mt.pw-open { transform: none; }
.pw-mt h2 { margin: 0; font-size: 12px; letter-spacing: 0.14em; display: flex; justify-content: space-between; align-items: center; }
.pw-mt .pw-warnbox {
  border: 1px solid rgba(255,179,71,0.5); background: rgba(255,179,71,0.08); color: #ffd9a3;
  border-radius: 8px; padding: 9px 10px; font-size: 11px;
}
.pw-mt label.pw-safety { display: flex; gap: 8px; align-items: center; margin-top: 8px; color: var(--pw-text); cursor: pointer; }
.pw-mt label.pw-safety input { width: 16px; height: 16px; accent-color: var(--pw-warn); }
.pw-mt .pw-status { font-size: 11px; color: var(--pw-dim); min-height: 1.3em; }
.pw-mt .pw-status[data-s="ready"] { color: var(--pw-ok); }
.pw-mt svg { width: 100%; height: auto; display: block; }
.pw-mt .pw-sl { display: grid; grid-template-columns: 58px 1fr 64px; gap: 8px; align-items: center; font-variant-numeric: tabular-nums; }
.pw-mt .pw-sl b { font-weight: 600; }
.pw-mt .pw-sl span { text-align: right; color: var(--pw-dim); font-size: 11px; }
.pw-mt .pw-sl.pw-master { padding-bottom: 8px; border-bottom: 1px solid var(--pw-line); }
.pw-mt fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 9px; }
.pw-mt fieldset:disabled { opacity: 0.45; }
`;

const POS: Record<string, [number, number]> = {
  'Front-Left': [60, 52],
  'Front-Right': [200, 52],
  'Rear-Left': [60, 168],
  'Rear-Right': [200, 168],
};
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Spin-direction diagram: quad X from above, nose up, M1–M4 with CW/CCW arrows and live RPM. */
function diagram(): string {
  const arms = Object.values(POS)
    .map(
      ([x, y]) =>
        `<line x1="130" y1="110" x2="${x}" y2="${y}" stroke="rgba(255,255,255,0.25)" stroke-width="6" stroke-linecap="round"/>`,
    )
    .join('');
  const motors = DRONE.motorPosition
    .map((p, i) => {
      const [x, y] = POS[p];
      const spin = DRONE.motorSpin[i];
      const c = hex(SPIN_ARROWS.colors[spin]);
      // Arc arrow: CW runs clockwise on screen (seen from above).
      const r = 30;
      const a0 = -140;
      const a1 = 110;
      const pt = (a: number) => [x + r * Math.cos((a * Math.PI) / 180), y + r * Math.sin((a * Math.PI) / 180)];
      const [sx, sy] = pt(spin === 'CW' ? a0 : a1);
      const [ex, ey] = pt(spin === 'CW' ? a1 : a0);
      return `<g>
        <circle cx="${x}" cy="${y}" r="38" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.14)"/>
        <path d="M${sx} ${sy} A${r} ${r} 0 1 ${spin === 'CW' ? 1 : 0} ${ex} ${ey}" fill="none" stroke="${c}" stroke-width="3" marker-end="url(#pw-ah-${spin})"/>
        <text x="${x}" y="${y - 2}" text-anchor="middle" fill="#e7eaee" font-size="15" font-weight="700">M${i + 1}</text>
        <text x="${x}" y="${y + 14}" text-anchor="middle" fill="${c}" font-size="10">${spin}</text>
        <text x="${x}" y="${y + 56}" text-anchor="middle" fill="rgba(231,234,238,0.7)" font-size="11" data-rpm="${i}">0 rpm</text>
      </g>`;
    })
    .join('');
  const marker = (spin: 'CW' | 'CCW') =>
    `<marker id="pw-ah-${spin}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${hex(SPIN_ARROWS.colors[spin])}"/></marker>`;
  return `<svg viewBox="0 0 260 240" role="img" aria-label="Motor layout: M1 rear right CW, M2 front right CCW, M3 rear left CCW, M4 front left CW, props in" font-family="ui-monospace, Consolas, monospace">
    <defs>${marker('CW')}${marker('CCW')}</defs>
    ${arms}<rect x="112" y="84" width="36" height="52" rx="6" fill="#1a1f25" stroke="rgba(255,255,255,0.3)"/>
    <path d="M130 70 l-8 12 h16z" fill="var(--pw-accent)"/><text x="130" y="64" text-anchor="middle" fill="rgba(231,234,238,0.6)" font-size="9">FRONT</text>
    ${motors}</svg>`;
}

/**
 * Motor Test Panel (PRD §4.8), modeled on the Betaflight Configurator Motors tab: a safety
 * toggle, a master slider and four per-motor sliders with live RPM, and the spin diagram.
 * Motors only run while the drone is powered and disarmed; arming is blocked while it's open.
 */
export class MotorTestPanel {
  readonly el: HTMLDivElement;
  open = false;
  /** 0..1 per motor, as set by the sliders (zeroed without the safety toggle). */
  readonly values = [0, 0, 0, 0];
  safety = false;
  onChange?: () => void;
  onClose?: () => void;
  private sliders: HTMLInputElement[];
  private master: HTMLInputElement;
  private fields: HTMLFieldSetElement;
  private status: HTMLDivElement;
  private safetyBox: HTMLInputElement;
  private lastRpm = '';

  constructor(parent: HTMLElement = document.body) {
    injectCss('theme', THEME);
    injectCss('motor-test', CSS);
    this.el = document.createElement('div');
    this.el.className = 'pw-mt pw-panel';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Motor test');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.inert = true;
    const slider = (label: string, cls = '', id = '') =>
      `<label class="pw-sl ${cls}"><b>${label}</b><input type="range" min="0" max="100" step="1" value="0" ${id}><span>0%</span></label>`;
    this.el.innerHTML = `
      <h2>MOTORS <button type="button" class="pw-btn" data-a="close" aria-label="Close motor test">CLOSE</button></h2>
      <div class="pw-warnbox">The props are on. On a real quad, remove them before testing motors.
        <label class="pw-safety"><input type="checkbox" data-a="safety"> I understand the props are on</label></div>
      <div class="pw-status" role="status"></div>
      ${diagram()}
      <fieldset disabled>
        ${slider('MASTER', 'pw-master', 'data-master')}
        ${DRONE.motorPosition.map((_, i) => slider(`M${i + 1}`, '', `data-m="${i}"`)).join('')}
        <button type="button" class="pw-btn" data-a="stop">STOP ALL</button>
      </fieldset>`;
    this.fields = this.el.querySelector('fieldset')!;
    this.status = this.el.querySelector('.pw-status')!;
    this.safetyBox = this.el.querySelector('[data-a="safety"]')!;
    this.master = this.el.querySelector('[data-master]')!;
    this.sliders = [...this.el.querySelectorAll<HTMLInputElement>('[data-m]')];

    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (a?.dataset.a === 'close') this.setOpen(false);
      if (a?.dataset.a === 'stop') this.stop();
    });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.setOpen(false);
      e.stopPropagation(); // arrow keys drive sliders, not the sim
    });
    this.safetyBox.addEventListener('change', () => this.setSafety(this.safetyBox.checked));
    this.master.addEventListener('input', () => {
      const v = Number(this.master.value);
      this.sliders.forEach((s) => (s.value = String(v)));
      this.read();
    });
    for (const s of this.sliders) s.addEventListener('input', () => this.read());
    parent.appendChild(this.el);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.el.classList.toggle('pw-open', open);
    this.el.setAttribute('aria-hidden', String(!open));
    this.el.inert = !open;
    if (open) (this.el.querySelector('[data-a="safety"]') as HTMLElement).focus({ preventScroll: true });
    else {
      this.setSafety(false);
      this.onClose?.();
    }
    this.onChange?.();
  }

  setSafety(on: boolean): void {
    this.safety = on;
    this.safetyBox.checked = on;
    this.fields.disabled = !on;
    if (!on) this.stop();
    this.onChange?.();
  }

  /** Set one motor (0..3) or all (−1) to a 0..1 command, as if its slider moved. */
  set(index: number, value: number): void {
    const v = String(Math.round(Math.max(0, Math.min(1, value)) * 100));
    if (index < 0) {
      this.master.value = v;
      this.sliders.forEach((s) => (s.value = v));
    } else this.sliders[index].value = v;
    this.read();
  }

  stop(): void {
    this.master.value = '0';
    this.sliders.forEach((s) => (s.value = '0'));
    this.read();
  }

  private read(): void {
    this.sliders.forEach((s, i) => {
      this.values[i] = this.safety ? Number(s.value) / 100 : 0;
      (s.nextElementSibling as HTMLElement).textContent = `${s.value}%`;
    });
    (this.master.nextElementSibling as HTMLElement).textContent = `${this.master.value}%`;
    this.onChange?.();
  }

  update(status: MotorTestStatus, rpms: readonly number[]): void {
    if (!this.open) return;
    const text: Record<MotorTestStatus, string> = {
      unpowered: 'Plug in the battery to test motors (P / hold Options).',
      booting: 'ESCs starting…',
      armed: 'Disarm to use the motor test.',
      ready: this.safety ? 'Live: sliders drive the motors.' : 'Tick the safety box to enable the sliders.',
    };
    if (this.status.textContent !== text[status]) {
      this.status.textContent = text[status];
      this.status.dataset.s = status;
    }
    const r = rpms.map((x) => Math.round(x / 10) * 10);
    const key = r.join(',');
    if (key === this.lastRpm) return;
    this.lastRpm = key;
    this.el
      .querySelectorAll<SVGTextElement>('[data-rpm]')
      .forEach((t, i) => (t.textContent = `${r[i].toLocaleString('en-US')} rpm`));
  }
}
