type SfxName =
  | "shoot"
  | "playerHit"
  | "enemyHit"
  | "enemyDeath"
  | "levelUp"
  | "pickup"
  | "stairs"
  | "gameOver"
  | "bossAlert"
  | "parry";

export class SfxManager {
  private ctx: AudioContext | null = null;
  private _muted: boolean;

  constructor() {
    this._muted = localStorage.getItem("arcane-sfx-muted") === "true";
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(value: boolean) {
    this._muted = value;
    localStorage.setItem("arcane-sfx-muted", String(value));
  }

  toggleMute(): boolean {
    this.muted = !this._muted;
    return this._muted;
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  play(name: SfxName): void {
    if (this._muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    switch (name) {
      case "shoot":
        this.playShoot(ctx);
        break;
      case "playerHit":
        this.playPlayerHit(ctx);
        break;
      case "enemyHit":
        this.playEnemyHit(ctx);
        break;
      case "enemyDeath":
        this.playEnemyDeath(ctx);
        break;
      case "levelUp":
        this.playLevelUp(ctx);
        break;
      case "pickup":
        this.playPickup(ctx);
        break;
      case "stairs":
        this.playStairs(ctx);
        break;
      case "gameOver":
        this.playGameOver(ctx);
        break;
      case "bossAlert":
        this.playBossAlert(ctx);
        break;
      case "parry":
        this.playParry(ctx);
        break;
    }
  }

  private osc(
    ctx: AudioContext,
    type: OscillatorType,
    freq: number,
    gain: number,
    startTime: number,
    duration: number,
    freqEnd?: number
  ): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, startTime);
    if (freqEnd !== undefined) {
      o.frequency.linearRampToValueAtTime(freqEnd, startTime + duration);
    }
    g.gain.setValueAtTime(gain, startTime);
    g.gain.linearRampToValueAtTime(0, startTime + duration);
    o.connect(g).connect(ctx.destination);
    o.start(startTime);
    o.stop(startTime + duration);
  }

  private noise(
    ctx: AudioContext,
    gain: number,
    startTime: number,
    duration: number
  ): void {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, startTime);
    g.gain.linearRampToValueAtTime(0, startTime + duration);
    src.connect(g).connect(ctx.destination);
    src.start(startTime);
    src.stop(startTime + duration);
  }

  /** Very short click/blip */
  private playShoot(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "square", 880, 0.08, t, 0.04, 440);
  }

  /** Short low thud */
  private playPlayerHit(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "sine", 120, 0.25, t, 0.12, 60);
    this.noise(ctx, 0.1, t, 0.08);
  }

  /** Quick high-pitched pop */
  private playEnemyHit(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "sine", 600, 0.12, t, 0.06, 300);
  }

  /** Descending tone */
  private playEnemyDeath(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "sawtooth", 400, 0.12, t, 0.2, 80);
    this.noise(ctx, 0.06, t + 0.05, 0.15);
  }

  /** Ascending arpeggio - 3 quick notes going up */
  private playLevelUp(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "sine", 523, 0.15, t, 0.12);          // C5
    this.osc(ctx, "sine", 659, 0.15, t + 0.1, 0.12);    // E5
    this.osc(ctx, "sine", 784, 0.18, t + 0.2, 0.18);    // G5
  }

  /** Bright short chime */
  private playPickup(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "sine", 1047, 0.12, t, 0.08);
    this.osc(ctx, "sine", 1319, 0.14, t + 0.06, 0.1);
  }

  /** Deep resonant tone */
  private playStairs(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "sine", 110, 0.2, t, 0.35);
    this.osc(ctx, "triangle", 220, 0.1, t, 0.3);
  }

  /** Low descending sad tones */
  private playGameOver(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "sine", 330, 0.2, t, 0.3);
    this.osc(ctx, "sine", 262, 0.2, t + 0.25, 0.3);
    this.osc(ctx, "sine", 196, 0.2, t + 0.5, 0.4);
  }

  /** Dramatic low rumble */
  private playBossAlert(ctx: AudioContext): void {
    const t = ctx.currentTime;
    this.osc(ctx, "sawtooth", 55, 0.15, t, 0.5, 40);
    this.osc(ctx, "sine", 80, 0.2, t, 0.4, 50);
    this.noise(ctx, 0.08, t, 0.3);
  }

  private playParry(ctx: AudioContext): void {
    const t = ctx.currentTime;
    // Sharp metallic "kin!" — high freq square + sine ping
    this.osc(ctx, "square", 1800, 0.12, t, 0.06, 2400);
    this.osc(ctx, "sine", 2200, 0.18, t + 0.01, 0.08, 3200);
    this.osc(ctx, "sine", 1200, 0.08, t + 0.02, 0.12);
    this.noise(ctx, 0.06, t, 0.04);
  }
}
