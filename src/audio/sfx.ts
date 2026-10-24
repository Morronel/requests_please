import { audio } from './context';
import { hz } from './instruments';
import { prefs } from './prefs';

/**
 * Short UI sounds, all synthesized: soft sine and square blips, a filtered noise
 * thud for the stamps. Each one is under half a second.
 */
type Tone = { midi: number; at?: number; dur?: number; type?: OscillatorType; vol?: number; glide?: number };

function play(tones: Tone[], thud?: { vol: number; freq: number; dur: number }): void {
  if (!prefs.get().sfx) return;
  const e = audio();
  if (!e || e.ctx.state !== 'running') return;
  const { ctx } = e;
  const t0 = ctx.currentTime + 0.005;
  for (const { midi, at = 0, dur = 0.08, type = 'sine', vol = 0.3, glide } of tones) {
    const t = t0 + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz(midi), t);
    if (glide !== undefined) o.frequency.exponentialRampToValueAtTime(hz(midi + glide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o.connect(g);
    if (type !== 'sine') {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2400;
      node = node.connect(f);
    }
    node.connect(e.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  if (thud) {
    const n = ctx.createBufferSource();
    n.buffer = e.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = thud.freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(thud.vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + thud.dur);
    n.connect(f).connect(g).connect(e.sfx);
    n.start(t0, Math.random(), thud.dur + 0.02);
  }
}

export const sfx = {
  /** Any button press: a barely-there tick. */
  tap: () => play([{ midi: 96, dur: 0.025, vol: 0.06 }]),
  allow: () => play([{ midi: 76, dur: 0.07, vol: 0.18 }, { midi: 83, at: 0.06, dur: 0.12, vol: 0.18 }], { vol: 0.5, freq: 900, dur: 0.09 }),
  block: () => play([{ midi: 43, dur: 0.16, type: 'square', vol: 0.2, glide: -5 }], { vol: 0.9, freq: 600, dur: 0.14 }),
  correct: () => play([{ midi: 84, dur: 0.06, vol: 0.12 }, { midi: 88, at: 0.05, dur: 0.09, vol: 0.12 }]),
  wrong: () => play([{ midi: 50, dur: 0.22, type: 'sawtooth', vol: 0.16, glide: -3 }, { midi: 49, at: 0.01, dur: 0.22, type: 'square', vol: 0.08, glide: -3 }]),
  undo: () => play([{ midi: 79, dur: 0.12, vol: 0.14, glide: -12 }]),
  /** Opening the class picker. */
  sheet: () => play([{ midi: 67, dur: 0.06, vol: 0.08, glide: 5 }]),
  /** Running a decoder on a value: a little data chirp. */
  decode: () => play([60, 67, 72].map((m, i) => ({ midi: m + 12, at: i * 0.03, dur: 0.04, type: 'square' as const, vol: 0.06 }))),
  /** A decoder that does not apply. */
  nope: () => play([{ midi: 45, dur: 0.07, type: 'square', vol: 0.08 }]),
  /** Somebody pinged you on chat. */
  ping: () => play([{ midi: 81, dur: 0.09, vol: 0.13 }, { midi: 86, at: 0.1, dur: 0.14, vol: 0.11 }]),
  /** A deployed rule caught something on its own. */
  zap: () => play([{ midi: 88, dur: 0.05, type: 'square', vol: 0.06, glide: -12 }]),
  deploy: () => play([{ midi: 72, dur: 0.05, vol: 0.12 }, { midi: 79, at: 0.05, dur: 0.05, vol: 0.12 }, { midi: 84, at: 0.1, dur: 0.12, vol: 0.12 }]),
  shiftStart: () => play([{ midi: 60, dur: 0.08, type: 'square', vol: 0.07 }, { midi: 67, at: 0.09, dur: 0.08, type: 'square', vol: 0.07 }, { midi: 72, at: 0.18, dur: 0.18, type: 'square', vol: 0.07 }]),
  shiftEnd: () => play([72, 76, 79, 84].map((m, i) => ({ midi: m, at: i * 0.07, dur: 0.22, vol: 0.1 }))),
  gameOver: () => play([67, 63, 60, 55].map((m, i) => ({ midi: m, at: i * 0.14, dur: 0.3, type: 'triangle' as const, vol: 0.16 }))),
};
