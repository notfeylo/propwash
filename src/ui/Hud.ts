import { DRONE, SPIN_ARROWS } from '../config/drone';
import { injectCss, THEME } from './style';

export interface HudData {
  state: 'OFF' | 'BOOTING' | 'DISARMED' | 'ARMED' | 'SPINNING';
  testing: boolean;
  voltage: number;
  cellVoltage: number;
  usedMah: number;
  soc: number;
  lowBattery: boolean;
  rpms: readonly number[];
  camera: string;
  device: string;
  fps: number | null;
}

const CSS = `
.pw-hud { position: fixed; left: 16px; top: 16px; z-index: 9; width: 262px; padding: 10px 12px 11px; user-select: none; }
.pw-hud-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pw-badge {
  font: 700 11px/1 var(--pw-font); letter-spacing: 0.12em; padding: 5px 8px; border-radius: 6px;
  border: 1px solid currentColor; color: var(--pw-dim);
}
.pw-badge[data-s="BOOTING"] { color: var(--pw-warn); }
.pw-badge[data-s="DISARMED"] { color: var(--pw-accent); }
.pw-badge[data-s="ARMED"] { color: var(--pw-ok); background: rgba(61,220,132,0.12); }
.pw-badge[data-s="TEST"] { color: var(--pw-warn); background: rgba(255,179,71,0.12); }
.pw-hud-cam { color: var(--pw-dim); font-size: 11px; letter-spacing: 0.1em; }
.pw-batt { margin-top: 9px; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; align-items: center; }
.pw-batt b { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.pw-batt small { color: var(--pw-dim); font-size: 11px; font-variant-numeric: tabular-nums; }
.pw-batt i { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; }
.pw-batt i u { display: block; height: 100%; background: var(--pw-ok); text-decoration: none; }
.pw-batt.pw-low b, .pw-batt.pw-low small { color: var(--pw-warn); }
.pw-batt.pw-low i u { background: var(--pw-warn); }
.pw-motors { margin-top: 10px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.pw-motor { display: grid; gap: 3px; font-size: 10px; color: var(--pw-dim); }
.pw-motor span { display: flex; justify-content: space-between; }
.pw-motor em { font-style: normal; font-size: 9px; }
.pw-motor s { display: block; height: 30px; border-radius: 3px; background: rgba(255,255,255,0.06); position: relative; text-decoration: none; overflow: hidden; }
.pw-motor s u { position: absolute; left: 0; right: 0; bottom: 0; text-decoration: none; }
.pw-motor b { color: var(--pw-text); font-weight: 600; font-variant-numeric: tabular-nums; font-size: 11px; }
.pw-hud-foot { margin-top: 8px; color: var(--pw-dim); font-size: 10px; letter-spacing: 0.08em; }
.pw-hud-tools { position: fixed; right: 16px; top: 16px; z-index: 9; display: flex; gap: 6px; }
.pw-hide-ui .pw-hud, .pw-hide-ui .pw-hud-tools, .pw-feed-view .pw-hud, .pw-feed-view .pw-hud-tools { visibility: hidden; }
`;

const MOTORS = ['M1', 'M2', 'M3', 'M4'];

/**
 * Minimal HUD (PRD §4.8): state badge, battery, per-motor RPM, camera, device, optional FPS,
 * plus the Motors / Settings buttons. Hidden in the FPV and HD views (the OSD covers those).
 */
export class Hud {
  readonly el: HTMLDivElement;
  readonly tools: HTMLDivElement;
  onMotors?: () => void;
  onSettings?: () => void;
  private badge: HTMLSpanElement;
  private cam: HTMLSpanElement;
  private batt: HTMLDivElement;
  private motors: { b: HTMLElement; u: HTMLElement }[] = [];
  private foot: HTMLDivElement;
  private last = '';

  constructor(parent: HTMLElement = document.body) {
    injectCss('theme', THEME);
    injectCss('hud', CSS);
    this.el = document.createElement('div');
    this.el.className = 'pw-hud pw-panel';
    this.el.setAttribute('aria-label', 'Drone status');
    this.el.innerHTML = `
      <div class="pw-hud-row"><span class="pw-badge" role="status"></span><span class="pw-hud-cam"></span></div>
      <div class="pw-batt"><b></b><small></small><i><u></u></i></div>
      <div class="pw-motors">${MOTORS.map(
        (m, i) =>
          `<div class="pw-motor"><span>${m}<em>${DRONE.motorSpin[i]}</em></span><s><u style="background:#${SPIN_ARROWS.colors[DRONE.motorSpin[i]].toString(16).padStart(6, '0')}"></u></s><b>0</b></div>`,
      ).join('')}</div>
      <div class="pw-hud-foot"></div>`;
    this.badge = this.el.querySelector('.pw-badge')!;
    this.cam = this.el.querySelector('.pw-hud-cam')!;
    this.batt = this.el.querySelector('.pw-batt')!;
    this.foot = this.el.querySelector('.pw-hud-foot')!;
    this.el
      .querySelectorAll('.pw-motor')
      .forEach((m) => this.motors.push({ b: m.querySelector('b')!, u: m.querySelector('u')! }));

    this.tools = document.createElement('div');
    this.tools.className = 'pw-hud-tools';
    this.tools.innerHTML = `<button type="button" class="pw-btn pw-panel" data-a="motors" title="Motor test (M)">MOTORS</button>
      <button type="button" class="pw-btn pw-panel" data-a="settings" title="Settings (O)">SETTINGS</button>`;
    this.tools.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'motors') this.onMotors?.();
      if (a === 'settings') this.onSettings?.();
    });
    parent.append(this.el, this.tools);
  }

  update(d: HudData): void {
    const label = d.testing ? 'TEST' : d.state === 'SPINNING' ? 'ARMED' : d.state;
    const rpm = d.rpms.map((r) => Math.round(r / 10) * 10);
    const key = [
      label,
      d.voltage.toFixed(1),
      d.cellVoltage.toFixed(2),
      Math.round(d.usedMah),
      d.camera,
      d.device,
      d.fps,
      d.lowBattery,
      ...rpm,
    ].join('|');
    if (key === this.last) return;
    this.last = key;
    this.badge.textContent = d.testing ? 'MOTOR TEST' : label;
    this.badge.dataset.s = label;
    this.cam.textContent = d.camera;
    const on = d.state !== 'OFF';
    this.batt.classList.toggle('pw-low', d.lowBattery);
    this.batt.querySelector('b')!.textContent = on ? `${d.voltage.toFixed(1)} V` : 'NO BATT';
    this.batt.querySelector('small')!.textContent = on
      ? `${d.cellVoltage.toFixed(2)} V/cell · ${Math.round(d.usedMah)} mAh`
      : 'press P / hold Options';
    (this.batt.querySelector('u') as HTMLElement).style.width = `${on ? Math.round(d.soc * 100) : 0}%`;
    rpm.forEach((r, i) => {
      this.motors[i].b.textContent = r.toLocaleString('en-US');
      this.motors[i].u.style.height = `${Math.min(100, (r / DRONE.rpmMax) * 100)}%`;
    });
    this.foot.textContent = [d.device.toUpperCase(), d.fps !== null ? `${d.fps} FPS` : ''].filter(Boolean).join(' · ');
  }
}
