type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const STORAGE_KEY = 'europe1914_muted';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean;
  private lastPlayed: Record<string, number> = {};

  constructor() {
    this.muted = this.loadMuteState();
  }

  private loadMuteState(): boolean {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      window.localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      // Ignore si le stockage local est indisponible
    }
    if (!this.muted) {
      this.playSelect();
    }
    return this.muted;
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;

    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private canTrigger(key: string, cooldownMs = 120): boolean {
    const now = performance.now();
    const prev = this.lastPlayed[key] ?? 0;
    if (now - prev < cooldownMs) return false;
    this.lastPlayed[key] = now;
    return true;
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Clic discret à la sélection d'une province */
  public playSelect(): void {
    if (!this.canTrigger('select', 70)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.045);

    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  /** Signal sourd en cas d'action refusée (ressources insuffisantes, mobilisation...) */
  public playError(): void {
    if (!this.canTrigger('error', 180)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(115, now + 0.14);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  /** Double coup d'enclume pour une construction */
  public playBuild(): void {
    if (!this.canTrigger('build', 160)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [0, 0.11].forEach((offset, idx) => {
      const t = now + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(idx === 0 ? 780 : 1040, t);
      osc.frequency.exponentialRampToValueAtTime(idx === 0 ? 520 : 700, t + 0.09);

      gain.gain.setValueAtTime(0.11, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  }

  /** Double coup de caisse claire pour un recrutement */
  public playRecruit(): void {
    if (!this.canTrigger('recruit', 160)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const noiseBuf = this.createNoiseBuffer(ctx, 0.1);

    [0, 0.095].forEach((offset) => {
      const t = now + offset;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1500, t);
      filter.Q.setValueAtTime(1.2, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);
      noise.stop(t + 0.09);
    });
  }

  /** Deux battements graves de tambour pour un ordre de marche */
  public playMarch(): void {
    if (!this.canTrigger('march', 180)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [0, 0.15].forEach((offset, idx) => {
      const t = now + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(idx === 0 ? 125 : 105, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.13);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  /** Coup de canon lointain (bataille ou bombardement d'artillerie) */
  public playCannon(): void {
    if (!this.canTrigger('cannon', 350)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Onde de choc grave
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(95, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.38);
    subGain.gain.setValueAtTime(0.28, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.45);

    // Déflagration filtrée
    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.45);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.24, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.5);
  }

  /** Impulsion morse pour un télégramme ou une offre diplomatique */
  public playTelegram(): void {
    if (!this.canTrigger('telegram', 400)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const pattern = [
      { start: 0, dur: 0.04 },
      { start: 0.075, dur: 0.04 },
      { start: 0.15, dur: 0.095 },
    ];

    for (const p of pattern) {
      const t = now + p.start;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1040, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.075, t + 0.008);
      gain.gain.setValueAtTime(0.075, t + p.dur - 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + p.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + p.dur + 0.01);
    }
  }

  /** Sonnerie de clairon à l'ouverture de la phase de guerre */
  public playBugleWar(): void {
    if (!this.canTrigger('bugle', 1000)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [
      { freq: 392.0, start: 0.0, dur: 0.16 },   // Sol4
      { freq: 523.25, start: 0.18, dur: 0.16 }, // Do5
      { freq: 659.25, start: 0.36, dur: 0.18 }, // Mi5
      { freq: 783.99, start: 0.56, dur: 0.48 }, // Sol5
    ];

    for (const n of notes) {
      const t = now + n.start;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(n.freq, t);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1450, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.11, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + n.dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + n.dur + 0.02);
    }
  }

  /** Accord solennel de fin de partie */
  public playVictory(): void {
    if (!this.canTrigger('victory', 1500)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const chord = [261.63, 329.63, 392.0, 523.25]; // Accord de Do majeur

    chord.forEach((freq, idx) => {
      const t = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1600, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.15);
    });
  }
}

export const soundEngine = new SoundEngine();