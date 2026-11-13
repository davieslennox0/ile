/**
 * All of Ilé's sound is synthesised with WebAudio — no audio files to license.
 * The context is created on the first user gesture (browsers require it).
 */

let ctx: AudioContext | null = null;
let windGain: GainNode | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  slideTo?: number,
  delay = 0,
): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const Sfx = {
  /** Wake the audio context from a user gesture. */
  unlock(): void {
    audio();
  },
  /** Soft wooden click: a handle was grabbed. */
  grab(): void {
    blip(520, 0.07, 'triangle', 0.16, 300);
  },
  /** Tiny tick: a value snapped to the next grid step. */
  tick(): void {
    blip(1100, 0.03, 'sine', 0.06);
  },
  release(): void {
    blip(300, 0.08, 'triangle', 0.1, 420);
  },
  /** Two-note chime: a fix was accepted, the score went up. */
  chime(): void {
    blip(660, 0.35, 'sine', 0.14);
    blip(990, 0.5, 'sine', 0.12, undefined, 0.12);
  },
  /** Falling note: rejected or undone. */
  dismiss(): void {
    blip(420, 0.18, 'sine', 0.1, 240);
  },
  /** Menu opened. */
  open(): void {
    blip(740, 0.09, 'sine', 0.08, 880);
  },
  /** Air rush for the scale transition. */
  whoosh(): void {
    const a = audio();
    if (!a) return;
    const len = Math.floor(a.sampleRate * 1.3);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    const t = a.currentTime;
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + 0.6);
    filter.frequency.exponentialRampToValueAtTime(300, t + 1.25);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    src.connect(filter).connect(g).connect(a.destination);
    src.start(t);
  },
  /**
   * Ambient wind for the full-scale view. `level` 0–1 follows how well the
   * room you are sitting in is ventilated; 0 fades it out.
   */
  wind(level: number): void {
    const a = audio();
    if (!a) return;
    if (!windGain) {
      const len = a.sampleRate * 2;
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i += 1) {
        last = last * 0.98 + (Math.random() * 2 - 1) * 0.02;
        data[i] = last * 6;
      }
      const src = a.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = a.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      windGain = a.createGain();
      windGain.gain.value = 0;
      src.connect(filter).connect(windGain).connect(a.destination);
      src.start();
    }
    windGain.gain.setTargetAtTime(Math.max(0, level) * 0.12, a.currentTime, 0.6);
  },
};

let subtitleVoice: SpeechSynthesisVoice | null = null;

/** Speak a line with the browser's built-in voice. Subtitles always show. */
export function speak(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (!subtitleVoice) {
      const voices = synth.getVoices();
      subtitleVoice =
        voices.find((v) => /en[-_](NG|GB|ZA)/i.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
    }
    if (subtitleVoice) u.voice = subtitleVoice;
    u.lang = 'en';
    u.rate = 0.92;
    u.pitch = 0.8;
    synth.speak(u);
  } catch {
    // Speech is a nicety; the subtitle panel carries the line.
  }
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
}
