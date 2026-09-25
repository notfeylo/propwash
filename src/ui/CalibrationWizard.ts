import { CAL_PROMPTS, CAL_STEPS, type RadioCalibration, RadioCalibrator } from '../input/RadioInput';
import type { PadSnapshot } from '../input/types';

const CSS = `
.pw-cal {
  position: fixed; inset: 0; z-index: 30; display: grid; place-items: center;
  background: rgba(5,6,8,0.6); backdrop-filter: blur(3px);
}
.pw-cal-box {
  width: min(460px, calc(100vw - 32px)); padding: 18px 20px; border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.14); background: #111418; color: #e7eaee;
  font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace;
}
.pw-cal-box h2 { margin: 0 0 4px; font-size: 14px; letter-spacing: 0.06em; }
.pw-cal-box .pw-step { color: rgba(231,234,238,0.55); font-size: 11px; margin-bottom: 10px; }
.pw-cal-box .pw-err { color: #ffb86b; min-height: 1.4em; }
.pw-cal-axes { display: grid; gap: 4px; margin: 12px 0; }
.pw-cal-axes div { display: grid; grid-template-columns: 34px 1fr; gap: 8px; align-items: center; font-size: 11px; }
.pw-cal-axes i { display: block; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.08); position: relative; }
.pw-cal-axes i b { position: absolute; top: 0; bottom: 0; width: 4px; margin-left: -2px; border-radius: 2px; background: #27c7ff; }
.pw-cal-axes div.pw-lead span { color: #27c7ff; }
.pw-cal-row { display: flex; gap: 8px; justify-content: flex-end; }
.pw-cal-row button {
  padding: 7px 12px; border-radius: 8px; cursor: pointer; font: inherit;
  border: 1px solid rgba(255,255,255,0.2); background: #1b2026; color: #e7eaee;
}
.pw-cal-row button.pw-primary { border-color: #27c7ff; background: #0f3a4a; }
.pw-cal-row button:focus-visible { outline: 2px solid #27c7ff; outline-offset: 2px; }
`;

let styled = false;

/** Modal wizard around RadioCalibrator: live axis bars, Next / Skip / Cancel. */
export class CalibrationWizard {
  private root: HTMLDivElement;
  private cal: RadioCalibrator;
  private axesEl: HTMLDivElement;
  private raf = 0;

  constructor(
    private radioId: string,
    private read: () => PadSnapshot | null,
    private onDone: (cal: RadioCalibration | null) => void,
  ) {
    if (!styled) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      styled = true;
    }
    this.cal = new RadioCalibrator(radioId);
    this.root = document.createElement('div');
    this.root.className = 'pw-cal';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Radio calibration');
    this.root.innerHTML = `<div class="pw-cal-box">
      <h2>RADIO CALIBRATION</h2><div class="pw-step"></div>
      <p class="pw-prompt"></p><div class="pw-cal-axes"></div><div class="pw-err" role="alert"></div>
      <div class="pw-cal-row"><button type="button" data-a="cancel">Cancel</button>
      <button type="button" data-a="skip">Skip</button><button type="button" data-a="next" class="pw-primary">Next</button></div></div>`;
    this.axesEl = this.root.querySelector('.pw-cal-axes')!;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
    this.render();
    this.loop();
    (this.root.querySelector('[data-a="next"]') as HTMLButtonElement).focus();
  }

  private onClick(e: MouseEvent): void {
    e.stopPropagation();
    const a = (e.target as HTMLElement).dataset?.a;
    if (a === 'cancel') return this.close(null);
    if (a === 'skip') this.cal.skip();
    if (a === 'next') {
      if (this.cal.step === 'done') return this.close(this.cal.calibration);
      this.cal.next();
    }
    this.render();
  }

  private render(): void {
    const step = this.cal.step;
    const n = CAL_STEPS.indexOf(step) + 1;
    this.root.querySelector('.pw-step')!.textContent =
      `${this.radioId.replace(/\s*\(.*\)\s*$/, '')} · step ${n} of ${CAL_STEPS.length}`;
    this.root.querySelector('.pw-prompt')!.textContent = CAL_PROMPTS[step];
    this.root.querySelector('.pw-err')!.textContent = this.cal.error ?? '';
    (this.root.querySelector('[data-a="skip"]') as HTMLButtonElement).hidden = step !== 'arm';
    (this.root.querySelector('[data-a="next"]') as HTMLButtonElement).textContent = step === 'done' ? 'Finish' : 'Next';
  }

  private loop = (): void => {
    const pad = this.read();
    if (pad) {
      this.cal.sample(pad);
      const lead = this.cal.leadingAxis;
      this.axesEl.innerHTML = pad.axes
        .map(
          (v, i) =>
            `<div class="${i === lead && this.cal.step !== 'center' ? 'pw-lead' : ''}"><span>A${i}</span><i><b style="left:${((v + 1) / 2) * 100}%"></b></i></div>`,
        )
        .join('');
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private close(cal: RadioCalibration | null): void {
    cancelAnimationFrame(this.raf);
    this.root.remove();
    this.onDone(cal);
  }
}
