import type { SoundName } from "../render/animationPlan.js";
import { SAMPLE_GAIN, SAMPLES, sampleUrl } from "./samples.js";

const MUTE_KEY = "zombie.muted";

interface Tone {
  readonly frequency: number;
  readonly endFrequency?: number;
  readonly duration: number;
  readonly type: OscillatorType;
  readonly gain: number;
}

/** The synthesised fallback for every sound: what plays until its samples have loaded, or always when it has none. */
const TONES: Readonly<Record<SoundName, readonly Tone[]>> = {
  step: [{ frequency: 180, duration: 0.05, type: "triangle", gain: 0.15 }],
  shot: [{ frequency: 900, endFrequency: 120, duration: 0.12, type: "sawtooth", gain: 0.25 }],
  hit: [{ frequency: 220, endFrequency: 80, duration: 0.15, type: "square", gain: 0.2 }],
  heal: [
    { frequency: 520, duration: 0.08, type: "sine", gain: 0.2 },
    { frequency: 780, duration: 0.12, type: "sine", gain: 0.2 },
  ],
  pickup: [{ frequency: 660, endFrequency: 990, duration: 0.1, type: "sine", gain: 0.2 }],
  reload: [
    { frequency: 300, duration: 0.05, type: "square", gain: 0.15 },
    { frequency: 400, duration: 0.05, type: "square", gain: 0.15 },
  ],
  zombie: [{ frequency: 110, endFrequency: 70, duration: 0.25, type: "sawtooth", gain: 0.2 }],
  door: [{ frequency: 160, endFrequency: 120, duration: 0.09, type: "square", gain: 0.15 }],
  swing: [{ frequency: 700, endFrequency: 200, duration: 0.08, type: "triangle", gain: 0.2 }],
  crash: [{ frequency: 420, endFrequency: 50, duration: 0.3, type: "sawtooth", gain: 0.25 }],
  your_turn: [
    { frequency: 440, duration: 0.08, type: "sine", gain: 0.2 },
    { frequency: 660, duration: 0.12, type: "sine", gain: 0.2 },
  ],
  victory: [
    { frequency: 523, duration: 0.12, type: "sine", gain: 0.25 },
    { frequency: 659, duration: 0.12, type: "sine", gain: 0.25 },
    { frequency: 784, duration: 0.25, type: "sine", gain: 0.25 },
  ],
  defeat: [
    { frequency: 300, duration: 0.2, type: "sawtooth", gain: 0.2 },
    { frequency: 200, duration: 0.4, type: "sawtooth", gain: 0.2 },
  ],
};

/**
 * Plays named sounds through the Web Audio API: a recorded sample when one is loaded,
 * otherwise a short synthesised tone. The context is created on first use (browsers
 * require a user gesture first), samples are fetched and decoded right after that, and the
 * mute preference persists per browser.
 */
export class SoundPlayer {
  private context: AudioContext | undefined;
  private muted: boolean;
  private readonly listeners = new Set<(muted: boolean) => void>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private loading = false;

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === "true";
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, String(muted));
    for (const listener of this.listeners) listener(muted);
  }

  onMuteChange(listener: (muted: boolean) => void): void {
    this.listeners.add(listener);
  }

  play(name: SoundName): void {
    if (this.muted) return;
    const context = this.ensureContext();
    if (context === undefined) return;
    const files = SAMPLES[name];
    const file = files[Math.floor(Math.random() * files.length)];
    const buffer = file === undefined ? undefined : this.buffers.get(file);
    if (buffer !== undefined) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = SAMPLE_GAIN[name];
      source.connect(gain).connect(context.destination);
      source.start();
      return;
    }
    let start = context.currentTime;
    for (const tone of TONES[name]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      if (tone.endFrequency !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, start + tone.duration);
      }
      gain.gain.setValueAtTime(tone.gain, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + tone.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + tone.duration);
      start += tone.duration;
    }
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context === undefined) {
      try {
        this.context = new AudioContext();
      } catch {
        return undefined;
      }
    }
    if (this.context.state === "suspended") void this.context.resume();
    if (!this.loading) {
      this.loading = true;
      void this.loadSamples(this.context);
    }
    return this.context;
  }

  /** Fetches every sample once; a file that fails to load leaves its tone in place. */
  private async loadSamples(context: AudioContext): Promise<void> {
    const files = new Set(Object.values(SAMPLES).flat());
    await Promise.all(
      [...files].map(async (file) => {
        try {
          const response = await fetch(sampleUrl(file));
          if (!response.ok) return;
          const decoded = await context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(file, decoded);
        } catch {
          // Keep the synthesised tone for this sound.
        }
      }),
    );
  }
}
