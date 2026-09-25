import type { LiveAudio, LiveAudioState } from '../audio/LiveAudio';

const CSS = `
.pw-audio {
  position: fixed; left: 16px; bottom: 16px; z-index: 10;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(12,14,17,0.78); color: #e7eaee;
  font: 500 13px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.02em;
  cursor: pointer; backdrop-filter: blur(6px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.pw-audio:hover { border-color: rgba(255,255,255,0.3); }
.pw-audio:focus-visible { outline: 2px solid #27c7ff; outline-offset: 2px; }
.pw-audio svg { flex: none; }
.pw-audio.pw-hidden { opacity: 0; transform: translateY(8px); pointer-events: none; }
.pw-keys {
  position: fixed; left: 16px; bottom: 16px; z-index: 9;
  color: rgba(231,234,238,0.62);
  font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace;
  pointer-events: none; user-select: none;
}
.pw-keys b { color: #e7eaee; font-weight: 600; }
@media (max-width: 520px) { .pw-keys { display: none; } }
`;

const SPEAKER = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;

const LABELS: Partial<Record<LiveAudioState, string>> = {
  idle: 'Click to power up audio',
  starting: 'Starting audio…',
  suspended: 'Audio paused: click to resume',
  unsupported: 'Audio not supported in this browser',
  failed: 'Audio failed to start',
};

/**
 * The autoplay-policy affordance (PRD §4.5): a small button until the AudioContext runs,
 * then a one-line key hint. Task 8 replaces the hint with the HUD.
 */
export function mountAudioPrompt(audio: LiveAudio, parent: HTMLElement = document.body): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pw-audio';
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    void audio.start();
  });

  const keys = document.createElement('div');
  keys.className = 'pw-keys';
  keys.innerHTML =
    '<b>P</b> battery · <b>Space</b> arm · <b>W/S</b> throttle (Shift fast) · <b>0</b> zero · <b>X</b> kill · <b>C</b> camera · <b>V</b> feed · <b>B</b> beacon · <b>L</b> payload';

  parent.append(keys, button);
  audio.onChange((s) => {
    const label = LABELS[s];
    button.classList.toggle('pw-hidden', !label);
    keys.style.visibility = label ? 'hidden' : 'visible';
    if (label) button.innerHTML = `${SPEAKER}<span>${label}</span>`;
  });
}
