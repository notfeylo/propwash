import { HD_REC, OSD } from '../config/cameras';
import type { CameraMode, FeedStyle } from '../config/cameras';
import type { VideoBox } from '../cameras/CameraDirector';

export interface OsdData {
  mode: CameraMode;
  feed: FeedStyle;
  /** FC + VTX powered (battery plugged). */
  powered: boolean;
  armed: boolean;
  /** Betaflight OSD flight-mode text (ACRO / ANGL / HOR). */
  flightMode: string;
  voltage: number;
  cellVoltage: number;
  usedMah: number;
  /** Armed time since plug-in (s), Betaflight "fly time". */
  armedTimeS: number;
  throttle: number;
  /** Centre warning, highest priority first (null = none). */
  warning: string | null;
  /** HD view: recording time (s). */
  recTimeS: number;
  /** 0..1 dip to black of a camera cut; overlays fade with the video. */
  fade: number;
  /** Seconds, for blinking. */
  time: number;
}

type Align = 'left' | 'right' | 'center';

const CSS = `
.pw-osd { position: fixed; inset: 0; z-index: 5; pointer-events: none; width: 100%; height: 100%; }
`;

export const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Betaflight-style OSD for the FPV feed (canvas 2D, original monospace styling). Elements sit
 * on the video system's character grid: PAL 30×16 for analog, a finer 53×20 for digital.
 * Unpowered, the goggles show "NO SIGNAL". The HD view shows only a REC indicator + timer.
 */
export class OsdOverlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private lastKey = '';
  visible = true;

  constructor(parent: HTMLElement = document.body) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pw-osd';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.lastKey = '';
  }

  /** Text currently on screen, for tests (one element per line). */
  lines: string[] = [];

  draw(d: OsdData, box: VideoBox): void {
    const blinkOn = Math.floor(d.time * OSD.blinkHz * 2) % 2 === 0;
    const recBlink = Math.floor(d.time * HD_REC.blinkHz * 2) % 2 === 0;
    const items = this.visible ? this.layout(d, blinkOn, recBlink) : [];
    const key = JSON.stringify([items, box, d.fade.toFixed(2), d.mode, d.feed, d.powered, d.armed]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.lines = items.map((i) => i.text);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!items.length && !(this.visible && d.mode === 'fpv' && d.powered)) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1 - d.fade;

    const grid = d.feed === 'analog' ? OSD.analogGrid : OSD.digitalGrid;
    const cw = box.width / grid.cols;
    const ch = box.height / grid.rows;
    const analog = d.mode === 'fpv' && d.feed === 'analog';
    const size = d.mode === 'fpv' ? Math.min(ch * (analog ? 0.72 : 0.62), cw * (analog ? 1.25 : 1.5)) : box.height / 26;

    for (const it of items) {
      const s = size * (it.scale ?? 1);
      let px = box.x + (it.col + 0.5) * cw;
      let py = box.y + (it.row + 0.5) * ch;
      if (it.anchor === 'center') {
        px = box.x + box.width / 2;
        py = box.y + box.height / 2;
      } else if (it.anchor === 'topLeft') {
        const margin = box.height * 0.045;
        px = box.x + margin + s;
        py = box.y + margin + s / 2;
      }
      ctx.font = `${analog ? 700 : 600} ${s}px ${OSD.font}`;
      ctx.textAlign = it.align;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      if (it.dot) {
        ctx.fillStyle = HD_REC.dotColor;
        ctx.beginPath();
        ctx.arc(px - s * 0.6, py, s * 0.32, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.lineWidth = Math.max(2, s * (analog ? 0.2 : 0.14));
      ctx.strokeStyle = OSD.outline;
      ctx.strokeText(it.text, px, py);
      ctx.fillStyle = it.color ?? OSD.color;
      ctx.fillText(it.text, px, py);
    }

    if (d.mode === 'fpv' && d.powered && this.visible) this.crosshair(box, size, analog);
  }

  private crosshair(box: VideoBox, size: number, analog: boolean): void {
    const ctx = this.ctx;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const arm = size * 0.9;
    const gap = size * 0.28;
    ctx.lineCap = 'butt';
    for (const [w, color] of [
      [Math.max(3, size * (analog ? 0.26 : 0.2)), OSD.outline],
      [Math.max(1.5, size * (analog ? 0.11 : 0.08)), OSD.color],
    ] as const) {
      ctx.lineWidth = w;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - gap - arm, cy);
      ctx.lineTo(cx - gap, cy);
      ctx.moveTo(cx + gap, cy);
      ctx.lineTo(cx + gap + arm, cy);
      ctx.moveTo(cx, cy - gap);
      ctx.lineTo(cx, cy - gap - arm * 0.55);
      ctx.stroke();
    }
  }

  private layout(d: OsdData, blinkOn: boolean, recBlink: boolean): Item[] {
    if (d.mode !== 'fpv' && d.mode !== 'hd') return [];
    if (d.mode === 'hd') {
      const rec: Item = { text: `REC ${mmss(d.recTimeS)}`, col: 0, row: 0, align: 'left', anchor: 'topLeft' };
      return recBlink ? [{ ...rec, text: '', dot: true }, rec] : [rec];
    }
    if (!d.powered) return [{ text: 'NO SIGNAL', col: 0, row: 0, align: 'center', anchor: 'center' }];

    const g = d.feed === 'analog' ? OSD.analogGrid : OSD.digitalGrid;
    const L = 1;
    const R = g.cols - 2;
    const C = (g.cols - 1) / 2;
    const bottom = g.rows - 2;
    const mid = Math.floor(g.rows / 2);
    const items: Item[] = [
      { text: `RSSI ${OSD.rssi}`, col: L, row: 1, align: 'left' },
      { text: `LQ ${OSD.lq}`, col: L, row: 2, align: 'left' },
      { text: d.flightMode, col: R, row: 1, align: 'right' },
      { text: `${d.cellVoltage.toFixed(2)}V`, col: L, row: bottom - 1, align: 'left' },
      { text: `${d.voltage.toFixed(1)}V`, col: L, row: bottom, align: 'left' },
      { text: `THR ${String(Math.round(d.throttle * 100)).padStart(3, ' ')}`, col: C, row: bottom, align: 'center' },
      { text: mmss(d.armedTimeS), col: R, row: bottom - 1, align: 'right' },
      { text: `${Math.round(d.usedMah)}MAH`, col: R, row: bottom, align: 'right' },
    ];
    if (!d.armed) items.push({ text: 'DISARMED', col: C, row: mid + 3, align: 'center' });
    if (d.warning && blinkOn)
      items.push({ text: d.warning, col: C, row: mid + 4, align: 'center', color: OSD.warnColor });
    return items;
  }
}

interface Item {
  text: string;
  col: number;
  row: number;
  align: Align;
  color?: string;
  scale?: number;
  /** Placed relative to the video box instead of the character grid. */
  anchor?: 'center' | 'topLeft';
  /** REC dot (drawn left of the anchor, no text). */
  dot?: boolean;
}
