import { REPLAY } from '../config/blackbox';
import { injectCss, THEME } from './style';

// Replay controls (Phase 2 PRD §8.2): play / pause, scrub, speed, video export, and whether the
// resimulated flight is still bit-identical to the recording.

const CSS = `
.pw-rb {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 12;
  width: min(760px, calc(100vw - 32px)); padding: 10px 12px; display: grid; gap: 8px;
}
.pw-rb[hidden] { display: none; }
.pw-rb .pw-rb-row { display: flex; gap: 8px; align-items: center; }
.pw-rb .pw-rb-row > span { font-variant-numeric: tabular-nums; color: var(--pw-dim); font-size: 11px; white-space: nowrap; }
.pw-rb input[type=range] { flex: 1; }
.pw-rb .pw-rb-title { font-size: 11px; letter-spacing: 0.14em; font-weight: 700; color: var(--pw-accent); }
.pw-rb .pw-rb-ok { color: var(--pw-ok) !important; }
.pw-rb .pw-rb-bad { color: var(--pw-danger) !important; }
.pw-rb .pw-rb-rec { color: var(--pw-danger); }
.pw-rb .pw-rb-hint { color: var(--pw-dim); font-size: 10px; letter-spacing: 0.06em; }
`;

export class ReplayBar {
  readonly el: HTMLDivElement;
  onToggle?: () => void;
  onSeek?: (t: number) => void;
  onSpeed?: (s: number) => void;
  onVideo?: () => void;
  onExit?: () => void;
  private range: HTMLInputElement;
  private time: HTMLSpanElement;
  private check: HTMLSpanElement;
  private play: HTMLButtonElement;
  private video: HTMLButtonElement;
  private seeking = false;

  constructor() {
    injectCss('theme', THEME);
    injectCss('replaybar', CSS);
    this.el = document.createElement('div');
    this.el.className = 'pw-rb pw-panel';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Replay');
    this.el.innerHTML = `
      <div class="pw-rb-row"><span class="pw-rb-title">REPLAY</span><span data-k="check"></span><span style="flex:1"></span>
        <span class="pw-rb-hint">C camera · Space play/pause · Y exit</span></div>
      <div class="pw-rb-row">
        <button type="button" class="pw-btn" data-a="play" aria-label="Play or pause">❚❚</button>
        <input type="range" min="0" max="1" step="0.001" value="0" aria-label="Replay position">
        <span data-k="time">0.0 / 0.0 s</span>
        <select aria-label="Speed">${REPLAY.speeds.map((s) => `<option value="${s}"${s === 1 ? ' selected' : ''}>${s}×</option>`).join('')}</select>
        <button type="button" class="pw-btn" data-a="video" title="Record the replay as a video (WebM)">VIDEO</button>
        <button type="button" class="pw-btn" data-a="exit">EXIT</button>
      </div>`;
    this.range = this.el.querySelector('input')!;
    this.time = this.el.querySelector('[data-k="time"]')!;
    this.check = this.el.querySelector('[data-k="check"]')!;
    this.play = this.el.querySelector('[data-a="play"]')!;
    this.video = this.el.querySelector('[data-a="video"]')!;
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'play') this.onToggle?.();
      if (a === 'video') this.onVideo?.();
      if (a === 'exit') this.onExit?.();
    });
    this.range.addEventListener('input', () => {
      this.seeking = true;
      this.onSeek?.(Number(this.range.value));
    });
    this.range.addEventListener('change', () => (this.seeking = false));
    this.el
      .querySelector('select')!
      .addEventListener('change', (e) => this.onSpeed?.(Number((e.target as HTMLSelectElement).value)));
    this.el.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) e.stopPropagation();
    });
    document.body.appendChild(this.el);
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  /**
   * @param t playback time @param ready resimulated so far @param duration recording length (s)
   * @param mismatch −1 while bit-identical, else the first differing time (s)
   */
  update(t: number, ready: number, duration: number, playing: boolean, mismatch: number, recording: boolean): void {
    this.range.max = String(duration);
    if (!this.seeking) this.range.value = String(t);
    const pct = duration > 0 ? (ready / duration) * 100 : 0;
    this.range.style.background = `linear-gradient(90deg, rgba(39,199,255,0.28) ${pct}%, rgba(255,255,255,0.06) ${pct}%)`;
    this.time.textContent = `${t.toFixed(1)} / ${duration.toFixed(1)} s`;
    this.play.textContent = playing ? '❚❚' : '▶';
    this.video.textContent = recording ? '■ STOP' : 'VIDEO';
    this.video.classList.toggle('pw-rb-rec', recording);
    const ok = mismatch < 0;
    const text =
      ready < duration
        ? `resimulating ${Math.round((ready / duration) * 100)}% · ${ok ? 'identical so far' : 'DIFFERS'}`
        : ok
          ? '✓ resimulated from seed + inputs: bit-identical to the flight'
          : `✗ differs from the recording at ${mismatch.toFixed(3)} s`;
    if (this.check.textContent !== text) this.check.textContent = text;
    this.check.className = ok ? 'pw-rb-ok' : 'pw-rb-bad';
  }
}
