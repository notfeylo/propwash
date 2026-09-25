const injected = new Set<string>();

/** Add a component's CSS once. */
export function injectCss(id: string, css: string): void {
  if (injected.has(id)) return;
  injected.add(id);
  const style = document.createElement('style');
  style.dataset.pw = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/**
 * Shared instrument-panel look: near-black glass, hairline borders, monospace readouts,
 * cyan for live values, amber for caution, green/red for armed/kill.
 */
export const THEME = `
:root {
  --pw-bg: rgba(12,14,17,0.8); --pw-bg-solid: #101317; --pw-line: rgba(255,255,255,0.12);
  --pw-line-strong: rgba(255,255,255,0.24); --pw-text: #e7eaee; --pw-dim: rgba(231,234,238,0.58);
  --pw-accent: #27c7ff; --pw-warn: #ffb347; --pw-ok: #3ddc84; --pw-danger: #ff5a4f;
  --pw-font: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
}
.pw-panel {
  background: var(--pw-bg); color: var(--pw-text); border: 1px solid var(--pw-line);
  border-radius: 12px; backdrop-filter: blur(8px); font: 500 12px/1.35 var(--pw-font);
  letter-spacing: 0.02em;
}
.pw-btn {
  font: 600 11px/1 var(--pw-font); letter-spacing: 0.06em; color: var(--pw-text);
  background: #1a1f25; border: 1px solid var(--pw-line-strong); border-radius: 8px;
  padding: 7px 10px; cursor: pointer;
}
.pw-btn:hover { border-color: rgba(255,255,255,0.4); }
.pw-btn:focus-visible, .pw-panel input:focus-visible, .pw-panel select:focus-visible {
  outline: 2px solid var(--pw-accent); outline-offset: 2px;
}
.pw-btn[aria-pressed="true"] { border-color: var(--pw-accent); color: var(--pw-accent); }
.pw-panel input[type=range] { accent-color: var(--pw-accent); width: 100%; }
.pw-panel select {
  font: 500 12px var(--pw-font); color: var(--pw-text); background: #1a1f25;
  border: 1px solid var(--pw-line-strong); border-radius: 6px; padding: 4px 6px;
}
`;
