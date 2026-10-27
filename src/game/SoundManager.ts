class SoundManager {
  private ctx: AudioContext | null = null;
  private volume = 0.8;
  private muted = false;
  private hapticsEnabled = true;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setConfig(volume: number, muted: boolean, hapticsEnabled: boolean) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
    this.hapticsEnabled = hapticsEnabled;
  }

  public vibrate(pattern: number | number[]) {
    if (!this.hapticsEnabled) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Ignore on unsupported devices
      }
    }
  }

  /**
   * Crisp wooden carrom coin-to-coin or striker-to-coin click
   */
  public playCollision(relativeSpeed: number, involvesStriker: boolean) {
    const ctx = this.ensureContext();
    const intensity = Math.min(1, Math.max(0.06, relativeSpeed / 14));

    if (intensity > 0.25) {
      this.vibrate(involvesStriker ? 12 : 6);
    }

    if (!ctx) return;
    const now = ctx.currentTime;
    const gainValue = intensity * this.volume * (involvesStriker ? 0.65 : 0.5);
    if (gainValue < 0.01) return;

    // Resonant wood modal synthesis (two pitched woody partials + short click transient)
    const baseFreq = involvesStriker ? 820 : 1080;
    const pitchJitter = 0.94 + Math.random() * 0.12;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'triangle';
    osc2.type = 'sine';

    osc1.frequency.setValueAtTime(baseFreq * pitchJitter, now);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.42, now + 0.045);

    osc2.frequency.setValueAtTime(baseFreq * 2.15 * pitchJitter, now);
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 0.85, now + 0.028);

    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.055);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.06);
    osc2.stop(now + 0.06);
  }

  /**
   * Hardwood board frame rebound sound
   */
  public playCushionHit(speed: number) {
    const ctx = this.ensureContext();
    const intensity = Math.min(1, Math.max(0.05, speed / 14));
    if (intensity > 0.35) {
      this.vibrate(8);
    }
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const startFreq = 310 + Math.random() * 40;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.065);

    gain.gain.setValueAtTime(intensity * this.volume * 0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.075);
  }

  /**
   * Release shot swoosh / flick
   */
  public playStrikeRelease(powerRatio: number) {
    const ctx = this.ensureContext();
    this.vibrate(15);
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220 + powerRatio * 180, now);
    osc.frequency.exponentialRampToValueAtTime(520 + powerRatio * 260, now + 0.07);

    gain.gain.setValueAtTime(0.25 * this.volume * Math.max(0.3, powerRatio), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.085);
  }

  /**
   * Coin dropping into corner net pocket
   */
  public playPocketDrop(isQueen: boolean, isFoul: boolean) {
    const ctx = this.ensureContext();
    this.vibrate(isQueen ? [20, 40, 30] : isFoul ? [40, 30, 40] : 22);
    if (!ctx) return;

    const now = ctx.currentTime;

    if (isFoul) {
      // Low muted warning reed
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(165, now);
      osc.frequency.linearRampToValueAtTime(125, now + 0.28);

      gain.gain.setValueAtTime(0.28 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.32);
      return;
    }

    // Wooden rim rattle + net drop
    const notes = isQueen ? [587.33, 783.99, 1046.5, 1318.5] : [440, 587.33, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.045;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.92, start + 0.14);

      gain.gain.setValueAtTime(0.32 * this.volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.17);
    });
  }

  /**
   * Championship victory fanfare
   */
  public playVictory() {
    const ctx = this.ensureContext();
    this.vibrate([30, 50, 30, 50, 60]);
    if (!ctx) return;

    const now = ctx.currentTime;
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.08;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.28 * this.volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.65);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.68);
    });
  }
}

export const soundManager = new SoundManager();
