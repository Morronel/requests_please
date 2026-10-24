/**
 * Tiny synth voices for the radio. Every voice is a few oscillators or a noise
 * burst with an envelope, scheduled at an exact AudioContext time and stopped
 * right after it fades, so nothing lingers in the graph.
 */
export interface Kit {
  ctx: BaseAudioContext;
  noise: AudioBuffer;
  /** Dry station output. */
  dry: AudioNode;
  /** Reverb send. */
  wet: AudioNode;
}

export const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const shared = new WeakMap<Kit, Map<string, AudioNode>>();

function cached<T extends AudioNode>(k: Kit, key: string, make: () => T): T {
  let m = shared.get(k);
  if (!m) shared.set(k, (m = new Map()));
  let n = m.get(key) as T | undefined;
  if (!n) m.set(key, (n = make()));
  return n;
}

function out(k: Kit, node: AudioNode, send = 0): void {
  node.connect(k.dry);
  if (send > 0)
    node.connect(
      cached(k, `send:${send}`, () => {
        const g = k.ctx.createGain();
        g.gain.value = send;
        g.connect(k.wet);
        return g;
      }),
    );
}

/**
 * Filters are the expensive part of a voice, so fixed ones are built once per
 * station and every note of that instrument plays through the same node.
 */
function bus(k: Kit, type: BiquadFilterType, freq: number, q: number, send: number): AudioNode {
  return cached(k, `bus:${type}:${freq}:${q}:${send}`, () => {
    const f = filter(k, type, freq, q);
    out(k, f, send);
    return f;
  });
}

function env(k: Kit, t: number, peak: number, attack: number, decay: number, sustain = 0): GainNode {
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(Math.max(sustain * peak, 0.0001), t + attack, decay / 4);
  return g;
}

function release(g: GainNode, t: number, time: number): void {
  g.gain.cancelScheduledValues(t);
  g.gain.setTargetAtTime(0, t, time / 4);
}

function osc(k: Kit, type: OscillatorType, freq: number, t: number, stop: number, detune = 0): OscillatorNode {
  const o = k.ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(t);
  o.stop(stop);
  return o;
}

function noise(k: Kit, t: number, dur: number): AudioBufferSourceNode {
  const s = k.ctx.createBufferSource();
  s.buffer = k.noise;
  s.start(t, Math.random() * (k.noise.duration - dur - 0.05), dur + 0.05);
  return s;
}

function filter(k: Kit, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = k.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// --- drums ------------------------------------------------------------------

export function kick(k: Kit, t: number, vel = 1, punch = 1): void {
  const o = osc(k, 'sine', 50, t, t + 0.5);
  o.frequency.setValueAtTime(110 + 70 * punch, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.07 + 0.03 * punch);
  const g = env(k, t, 0.9 * vel, 0.002, 0.32);
  o.connect(g);
  out(k, g);
}

export function snare(k: Kit, t: number, vel = 1, bright = 1, send = 0.15): void {
  const n = noise(k, t, 0.25);
  const g = env(k, t, 0.42 * vel, 0.001, 0.16);
  n.connect(g).connect(bus(k, 'bandpass', Math.round(1400 + 1200 * bright), 0.6, send));
  const o = osc(k, 'triangle', 185, t, t + 0.15);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
  const og = env(k, t, 0.3 * vel, 0.001, 0.07);
  o.connect(og);
  out(k, og);
}

export function hat(k: Kit, t: number, vel = 1, open = false): void {
  const dur = open ? 0.28 : 0.05;
  const n = noise(k, t, dur);
  const g = env(k, t, 0.16 * vel, 0.001, dur);
  n.connect(g).connect(bus(k, 'highpass', 7200, 0.7, 0.05));
}

export function ride(k: Kit, t: number, vel = 1): void {
  const n = noise(k, t, 0.9);
  const g = env(k, t, 0.12 * vel, 0.001, 0.8);
  n.connect(g).connect(bus(k, 'bandpass', 6500, 1.4, 0.2));
  // An inharmonic square partial gives it the "ping".
  const o = osc(k, 'square', 3150, t, t + 0.5);
  const og = env(k, t, 0.02 * vel, 0.001, 0.4);
  o.connect(og).connect(bus(k, 'highpass', 2500, 0.7, 0.2));
}

/** A brush sweep: filtered noise that swells in and out over `dur`. */
export function brush(k: Kit, t: number, dur: number, vel = 1): void {
  const n = noise(k, t, dur);
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05 * vel, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0, t + dur);
  n.connect(g).connect(bus(k, 'bandpass', 3200, 0.5, 0.1));
}

export function shaker(k: Kit, t: number, vel = 1): void {
  const n = noise(k, t, 0.06);
  const g = env(k, t, 0.07 * vel, 0.008, 0.05);
  n.connect(g).connect(bus(k, 'bandpass', 9000, 1, 0));
}

// --- bass -------------------------------------------------------------------

export function sub(k: Kit, t: number, midi: number, dur: number, vel = 1): void {
  const end = t + dur;
  const g = env(k, t, 0.42 * vel, 0.01, dur, 0.7);
  release(g, end, 0.12);
  osc(k, 'sine', hz(midi), t, end + 0.3).connect(g);
  // A quiet octave up so the bass still reads on phone speakers.
  const o2 = osc(k, 'sine', hz(midi + 12), t, end + 0.3);
  const g2 = k.ctx.createGain();
  g2.gain.value = 0.18;
  o2.connect(g2).connect(g);
  out(k, g);
}

/** Two detuned saws through a wobbling low-pass: the classic Reese. */
export function reese(k: Kit, t: number, midi: number, dur: number, vel = 1): void {
  const end = t + dur;
  const f = filter(k, 'lowpass', 340, 2);
  f.frequency.setValueAtTime(260, t);
  f.frequency.linearRampToValueAtTime(520, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(300, end);
  const g = env(k, t, 0.16 * vel, 0.02, dur, 0.85);
  release(g, end, 0.1);
  for (const d of [-14, 14]) osc(k, 'sawtooth', hz(midi), t, end + 0.2, d).connect(f);
  f.connect(g);
  out(k, g);
  sub(k, t, midi - 12, dur, 0.7 * vel);
}

/** Upright bass: a soft pluck with a fast decay into a short sustain. */
export function upright(k: Kit, t: number, midi: number, dur: number, vel = 1): void {
  const end = t + dur;
  const g = env(k, t, 0.55 * vel, 0.004, 0.35, 0.35);
  release(g, end, 0.08);
  osc(k, 'triangle', hz(midi), t, end + 0.2).connect(g);
  // The thump of the pluck: a short, brighter partial on top.
  const p = osc(k, 'triangle', hz(midi + 12), t, t + 0.12);
  const pg = env(k, t, 0.25 * vel, 0.002, 0.06);
  p.connect(pg).connect(g);
  g.connect(bus(k, 'lowpass', 1100, 1, 0.05));
}

// --- keys -------------------------------------------------------------------

/** FM electric piano. `bell` raises the modulator ratio for a glassier tine. */
export function rhodes(k: Kit, t: number, midi: number, dur: number, vel = 1, bell = false, send = 0.3): void {
  const f0 = hz(midi);
  const end = t + dur;
  const car = osc(k, 'sine', f0, t, end + 0.6);
  const mod = osc(k, 'sine', f0 * (bell ? 3.5 : 1), t, end + 0.6);
  const idx = k.ctx.createGain();
  idx.gain.setValueAtTime(f0 * (bell ? 1.2 : 1.8) * vel, t);
  idx.gain.setTargetAtTime(f0 * 0.15, t, 0.25);
  mod.connect(idx).connect(car.frequency);
  const g = env(k, t, 0.11 * vel, 0.004, 1.6, 0.25);
  release(g, end, 0.35);
  car.connect(g);
  out(k, g, send);
}

export function piano(k: Kit, t: number, midi: number, dur: number, vel = 1): void {
  const f0 = hz(midi);
  const end = t + dur;
  const g = env(k, t, 0.1 * vel, 0.003, 1.1, 0.15);
  release(g, end, 0.25);
  osc(k, 'triangle', f0, t, end + 0.4).connect(g);
  const h = osc(k, 'sine', f0 * 2, t, end + 0.4, 3);
  const hg = k.ctx.createGain();
  hg.gain.value = 0.3;
  h.connect(hg).connect(g);
  g.connect(bus(k, 'lowpass', 3000, 0.7, 0.25));
}

export function vibes(k: Kit, t: number, midi: number, dur: number, vel = 1): void {
  const f0 = hz(midi);
  const end = t + Math.max(dur, 0.6);
  const g = env(k, t, 0.1 * vel, 0.002, 1.4);
  release(g, end, 0.6);
  osc(k, 'sine', f0, t, end + 0.5).connect(g);
  const p = osc(k, 'sine', f0 * 4, t, t + 0.3);
  const pg = env(k, t, 0.25, 0.001, 0.12);
  p.connect(pg).connect(g);
  // One motor tremolo shared by every bar.
  g.connect(
    cached(k, 'vibes', () => {
      const trem = k.ctx.createGain();
      trem.gain.value = 0.8;
      const lfo = k.ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = k.ctx.createGain();
      depth.gain.value = 0.2;
      lfo.connect(depth).connect(trem.gain);
      lfo.start();
      out(k, trem, 0.35);
      return trem;
    }),
  );
}

/** Slow detuned-saw pad. */
export function pad(k: Kit, t: number, midi: number, dur: number, vel = 1, bright = 1): void {
  const end = t + dur;
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.035 * vel, t + Math.min(0.6, dur / 3));
  g.gain.setValueAtTime(0.035 * vel, end);
  g.gain.linearRampToValueAtTime(0, end + 0.8);
  for (const d of [-9, 9]) osc(k, 'sawtooth', hz(midi), t, end + 0.9, d).connect(g);
  g.connect(bus(k, 'lowpass', Math.round(700 + 900 * bright), 0.8, 0.5));
}

/** Short filtered square stab for arps. */
export function pluck(k: Kit, t: number, midi: number, vel = 1, send = 0.4): void {
  const g = env(k, t, 0.06 * vel, 0.002, 0.2);
  osc(k, 'square', hz(midi), t, t + 0.3).connect(g);
  // The octave-up saw dies first, which reads as a closing filter.
  const top = osc(k, 'sawtooth', hz(midi + 12), t, t + 0.12, 6);
  const tg = env(k, t, 0.5, 0.002, 0.06);
  top.connect(tg).connect(g);
  g.connect(bus(k, 'lowpass', 1800, 2, send));
}

// --- texture ----------------------------------------------------------------

/** Vinyl crackle and hiss, looped. Returns a stop function. */
export function vinyl(k: Kit, t: number, level = 1): () => void {
  const ctx = k.ctx;
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let v = (Math.random() * 2 - 1) * 0.012;
    if (Math.random() < 0.0004) v += (Math.random() * 2 - 1) * 0.5;
    d[i] = v;
  }
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  const f = filter(k, 'lowpass', 5200);
  const g = ctx.createGain();
  g.gain.value = 0.5 * level;
  s.connect(f).connect(g);
  out(k, g);
  s.start(t);
  return () => {
    try {
      s.stop();
    } catch {
      // Already stopped.
    }
  };
}
