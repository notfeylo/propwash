import type { ControlState } from '../input/types';

const CSS = `
.pw-input {
  position: fixed; right: 16px; bottom: 16px; z-index: 9;
  display: flex; flex-direction: column; gap: 6px; align-items: stretch;
  padding: 10px 12px 9px; border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(12,14,17,0.72); color: #e7eaee;
  font: 500 11px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.04em;
  backdrop-filter: blur(6px); user-select: none;
  transition: opacity 0.25s ease;
}
.pw-input.pw-off { opacity: 0; pointer-events: none; }
.pw-input .pw-dev { display: flex; align-items: center; gap: 7px; color: rgba(231,234,238,0.75); }
.pw-input .pw-dev b { color: #fff; font-weight: 600; }
.pw-input .pw-dot { width: 7px; height: 7px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 6px #3ddc84; }
.pw-input canvas { display: block; }
.pw-input button {
  margin-top: 2px; padding: 5px 8px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(255,190,90,0.5); background: rgba(40,28,10,0.8); color: #ffe2b0;
  font: inherit;
}
.pw-input button:focus-visible { outline: 2px solid #27c7ff; outline-offset: 2px; }
.pw-hide-ui .pw-input, .pw-hide-ui .pw-keys, .pw-hide-ui .pw-audio, .pw-hide-ui .pw-toast { visibility: hidden; }
.pw-feed-view .pw-keys { visibility: hidden !important; }
`;

const W = 196;
const H = 104;

/**
 * Device indicator + live input visualizer (PRD §4.7): two Mode 2 gimbals (throttle/yaw left,
 * pitch/roll right) and ARM / KILL pips. Offers radio calibration when a radio needs it.
 */
export class InputVisualizer {
  readonly el: HTMLDivElement;
  private dev: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private calibrate: HTMLButtonElement;
  private lastKey = '';
  onCalibrate?: () => void;

  constructor(parent: HTMLElement = document.body) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'pw-input';
    this.dev = document.createElement('div');
    this.dev.className = 'pw-dev';
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.calibrate = document.createElement('button');
    this.calibrate.type = 'button';
    this.calibrate.textContent = 'Calibrate radio';
    this.calibrate.hidden = true;
    this.calibrate.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onCalibrate?.();
    });
    this.el.append(this.dev, this.canvas, this.calibrate);
    parent.appendChild(this.el);
  }

  set visible(v: boolean) {
    this.el.classList.toggle('pw-off', !v);
  }

  /** @param armed the drone is armed (lights ARM for toggle-style devices too). */
  update(s: ControlState, armed: boolean, needsCalibration: boolean): void {
    this.calibrate.hidden = !needsCalibration;
    const label = s.device === 'keyboard' ? 'KEYBOARD' : s.device === 'gamepad' ? 'GAMEPAD' : 'RADIO';
    const key = [label, s.deviceName, s.throttle, s.yaw, s.pitch, s.roll, armed, s.kill].map((v) =>
      typeof v === 'number' ? v.toFixed(3) : String(v),
    );
    const k = key.join('|');
    if (k === this.lastKey) return;
    this.lastKey = k;
    this.dev.innerHTML = `<span class="pw-dot"></span><span>${label}</span><b></b>`;
    this.dev.querySelector('b')!.textContent = s.device === 'keyboard' ? '' : s.deviceName;
    this.draw(s, armed);
  }

  private draw(s: ControlState, armed: boolean): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const size = 78;
    const gimbal = (x0: number, gx: number, gy: number, label: string) => {
      const y0 = 4;
      c.strokeStyle = 'rgba(255,255,255,0.22)';
      c.lineWidth = 1;
      c.strokeRect(x0 + 0.5, y0 + 0.5, size, size);
      c.beginPath();
      c.moveTo(x0 + size / 2 + 0.5, y0 + 4);
      c.lineTo(x0 + size / 2 + 0.5, y0 + size - 4);
      c.moveTo(x0 + 4, y0 + size / 2 + 0.5);
      c.lineTo(x0 + size - 4, y0 + size / 2 + 0.5);
      c.strokeStyle = 'rgba(255,255,255,0.1)';
      c.stroke();
      const px = x0 + size / 2 + (gx * (size - 12)) / 2;
      const py = y0 + size / 2 - (gy * (size - 12)) / 2;
      c.fillStyle = '#27c7ff';
      c.beginPath();
      c.arc(px, py, 5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(231,234,238,0.55)';
      c.font = '9px ui-monospace, Consolas, monospace';
      c.textAlign = 'center';
      c.fillText(label, x0 + size / 2, y0 + size + 12);
    };
    // Mode 2: left = yaw (x) / throttle (y, bottom = 0); right = roll (x) / pitch (y).
    gimbal(2, s.yaw, s.throttle * 2 - 1, `THR ${Math.round(s.throttle * 100)}%`);
    gimbal(W - size - 3, s.roll, s.pitch, 'PITCH/ROLL');
    const pip = (x: number, y: number, on: boolean, text: string, color: string) => {
      c.fillStyle = on ? color : 'rgba(255,255,255,0.12)';
      c.beginPath();
      c.roundRect(x - 13, y - 7, 26, 14, 4);
      c.fill();
      c.fillStyle = on ? '#0c0e11' : 'rgba(231,234,238,0.5)';
      c.font = 'bold 8px ui-monospace, Consolas, monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, x, y + 0.5);
      c.textBaseline = 'alphabetic';
    };
    pip(W / 2, 22, armed, 'ARM', '#3ddc84');
    pip(W / 2, 42, s.kill, 'KILL', '#ff5a4f');
  }
}
