import { AudioEngine, type AudioFrame } from './AudioEngine';

export type LiveAudioState = 'idle' | 'starting' | 'running' | 'suspended' | 'unsupported' | 'failed';

/**
 * Owns the real AudioContext. Browsers only allow audio after a user gesture, so the context
 * is created lazily by `start()` (called from a click/key handler) and resumed on later
 * gestures if the browser suspends it.
 */
export class LiveAudio {
  state: LiveAudioState = 'idle';
  engine: AudioEngine | null = null;
  private ctx: AudioContext | null = null;
  private listeners = new Set<(s: LiveAudioState) => void>();

  constructor(target: Window = window) {
    const gesture = () => void this.start();
    target.addEventListener('pointerdown', gesture);
    target.addEventListener('keydown', gesture);
    if (typeof AudioContext === 'undefined') this.setState('unsupported');
  }

  onChange(fn: (s: LiveAudioState) => void): void {
    this.listeners.add(fn);
    fn(this.state);
  }

  private setState(s: LiveAudioState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  async start(): Promise<void> {
    if (this.state === 'unsupported' || this.state === 'starting' || this.state === 'failed') return;
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
      this.setState(this.ctx.state === 'running' ? 'running' : 'suspended');
      return;
    }
    this.setState('starting');
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx.addEventListener('statechange', () => {
        if (this.engine) this.setState(this.ctx?.state === 'running' ? 'running' : 'suspended');
      });
      await this.ctx.resume();
      this.engine = await AudioEngine.create(this.ctx, { loadClips: true });
      this.setState(this.ctx.state === 'running' ? 'running' : 'suspended');
    } catch (err) {
      console.warn('Audio unavailable:', err);
      this.setState('failed');
    }
  }

  private pausedByApp = false;

  /** Hidden tab: the sim stops, so stop the sound too. */
  pause(): void {
    if (this.ctx?.state === 'running') {
      this.pausedByApp = true;
      void this.ctx.suspend();
    }
  }

  resume(): void {
    if (this.ctx && this.pausedByApp) {
      this.pausedByApp = false;
      void this.ctx.resume();
    }
  }

  update(frame: AudioFrame): void {
    if (this.state === 'running') this.engine?.update(frame);
  }

  get mode(): string {
    return this.engine?.mode ?? 'not started';
  }
}
