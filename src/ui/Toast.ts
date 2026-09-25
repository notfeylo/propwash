import type { ArmBlocker } from '../sim/PowerStateMachine';

const CSS = `
.pw-toast {
  position: fixed; left: 50%; bottom: 64px; z-index: 20;
  transform: translate(-50%, 8px); opacity: 0;
  max-width: min(560px, calc(100vw - 32px));
  padding: 10px 16px; border-radius: 10px;
  border: 1px solid rgba(255, 190, 90, 0.45);
  background: rgba(20, 14, 6, 0.86); color: #ffe2b0;
  font: 500 13px/1.35 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.02em;
  text-align: center; pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.pw-toast.pw-show { opacity: 1; transform: translate(-50%, 0); }
.pw-toast b { color: #fff; }
`;

export type InputHintDevice = 'keyboard' | 'gamepad' | 'radio';

/** Why arming was refused, and what to do about it, per input device. */
export function armBlockedMessage(reason: ArmBlocker, device: InputHintDevice = 'keyboard'): string {
  switch (reason) {
    case 'NO POWER':
      return `Battery unplugged: ${device === 'gamepad' ? 'hold <b>Options</b>' : 'press <b>P</b>'} to plug in`;
    case 'BOOTING':
      return 'ESCs starting: wait for the two ready tones, then arm';
    case 'THROTTLE': {
      const fix =
        device === 'keyboard'
          ? 'Press <b>0</b> or hold <b>S</b>'
          : device === 'gamepad'
            ? 'Lower the throttle (left stick down, or release <b>R2</b>)'
            : 'Lower the throttle';
      return `Arming blocked: throttle above 5%. ${fix}, then arm${device === 'radio' ? ' (flip the switch off and on)' : ''}`;
    }
    case 'ANGLE':
      return 'Arming blocked: tilted more than 25°. Set the drone level (R resets to the pad)';
    case 'FAILSAFE':
      return 'Arming blocked: failsafe (no radio signal)';
  }
}

/** Short status messages (arming refusals, mode changes). Task 8's HUD shows these too. */
export class Toast {
  private el: HTMLDivElement;
  private timer = 0;

  constructor(parent: HTMLElement = document.body) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'pw-toast';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    parent.appendChild(this.el);
  }

  show(html: string, ms = 2600): void {
    this.el.innerHTML = html;
    this.el.classList.add('pw-show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('pw-show'), ms);
  }

  get text(): string {
    return this.el.classList.contains('pw-show') ? (this.el.textContent ?? '') : '';
  }
}
