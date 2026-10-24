/**
 * Per-station bar renderers: given one bar of the tape and its start time,
 * schedule every note in it. Variation comes from a seeded RNG per bar, so the
 * same tape always plays the same way.
 */
import { Rng } from '../game/rng';
import * as I from './instruments';
import type { Kit } from './instruments';
import type { StationId } from './prefs';
import { bassNote, barSeconds, STATIONS, voice, type Bar, type StationDef } from './tape';

export interface BarCtx {
  k: Kit;
  t0: number;
  bar: Bar;
  station: StationDef;
  rng: Rng;
}

export type Renderer = (c: BarCtx) => void;

export function seed(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const x of n) h = Math.imul(h ^ (x >>> 0), 0x01000193);
  return h >>> 0;
}

/** Start time of 16th step `s` (may run past 15 into the next bar) with swing and a hair of human timing. */
function at(c: BarCtx, s: number, humanize = 0.006): number {
  const bd = barSeconds(c.bar.bpm);
  const sd = bd / 16;
  let t = c.t0 + s * sd;
  if (s % 2 === 1) t += (c.station.swing16 - 0.5) * 2 * sd;
  if (s % 4 === 2) t += (c.station.swing8 - 0.5) * (bd / 4);
  return t + (c.rng.next() - 0.5) * 2 * humanize;
}

const steps = (c: BarCtx, n: number) => (barSeconds(c.bar.bpm) / 16) * n;
const has = (c: BarCtx, l: Bar['section']['layers'][number]) => c.bar.section.layers.includes(l);
const lastBar = (c: BarCtx) => c.bar.barInSection === c.bar.sectionBars - 1;

interface Note {
  step: number;
  deg: number;
  len: number;
}

const motifs = new Map<number, Note[]>();

/** A short phrase over two bars, seeded per section so a hook repeats and returns. */
function motif(c: BarCtx, density: number): Note[] {
  const key = seed(c.station.id.charCodeAt(0), c.bar.sectionId, density * 10);
  const hit = motifs.get(key);
  if (hit) return hit;
  const r = new Rng(key);
  const notes: Note[] = [];
  let deg = r.int(2, 6);
  for (let s = 0; s < 32; s += 2) {
    if (s === 16 && r.chance(0.5)) s += 2; // leave a breath between halves
    if (!r.chance(density)) continue;
    deg = Math.max(0, Math.min(9, deg + r.pick([-2, -1, -1, 1, 1, 2, 0])));
    notes.push({ step: s, deg, len: r.pick([2, 2, 3, 4, 6]) });
  }
  motifs.set(key, notes);
  return notes;
}

function scaleNote(bar: Bar, deg: number, octave: number): number {
  const sc = bar.def.scale;
  return bar.def.key + octave * 12 + sc[deg % sc.length] + 12 * Math.floor(deg / sc.length);
}

function phrase(c: BarCtx, density: number, octave: number, play: (t: number, midi: number, dur: number) => void): void {
  const half = c.bar.barInSection % 2;
  for (const n of motif(c, density)) {
    const s = n.step - half * 16;
    if (s < 0 || s >= 16) continue;
    play(at(c, s), scaleNote(c.bar, n.deg, octave), steps(c, n.len));
  }
}

// --- lo-fi ------------------------------------------------------------------

const lofi: Renderer = (c) => {
  const { k, rng, bar } = c;
  const chord = voice(bar.chord, 55);
  const strum = (t: number, dur: number, vel: number) => chord.forEach((n, i) => I.rhodes(k, t + i * 0.012, n, dur, vel * (0.8 + rng.next() * 0.3)));

  if (has(c, 'keys')) {
    strum(at(c, 0), steps(c, 7), 0.9);
    if (rng.chance(0.6)) strum(at(c, rng.pick([7, 10])), steps(c, 5), 0.6);
  }
  if (has(c, 'drums')) {
    I.kick(k, at(c, 0), 0.9, 0.4);
    I.kick(k, at(c, 10), 0.75, 0.4);
    if (rng.chance(0.4)) I.kick(k, at(c, 7), 0.5, 0.4);
    I.snare(k, at(c, 4), 0.65, 0.35, 0.25);
    I.snare(k, at(c, 12), 0.7, 0.35, 0.25);
    for (let s = 0; s < 16; s += 2) I.hat(k, at(c, s), s % 4 ? 0.45 : 0.75);
    if (rng.chance(0.3)) I.hat(k, at(c, 15), 0.3);
    if (lastBar(c)) I.snare(k, at(c, 15), 0.3, 0.3);
  }
  if (has(c, 'perc')) for (let s = 1; s < 16; s += 2) I.shaker(k, at(c, s), 0.5 + rng.next() * 0.3);
  if (has(c, 'bass')) {
    const root = bassNote(bar.chord, 36);
    I.sub(k, at(c, 0), root, steps(c, 6));
    I.sub(k, at(c, 10), rng.chance(0.3) ? root + 7 : root, steps(c, 4), 0.8);
    if (rng.chance(0.4)) I.sub(k, at(c, 14), bassNote(bar.next, 36) - 1, steps(c, 2), 0.6);
  }
  if (has(c, 'lead')) phrase(c, 0.3, 3, (t, n, d) => I.rhodes(k, t, n, d, 0.55, true, 0.45));
};

// --- drum & bass ------------------------------------------------------------

const dnb: Renderer = (c) => {
  const { k, rng, bar } = c;
  const odd = bar.barInSection % 2 === 1;

  if (has(c, 'keys') && bar.cycleBar % bar.def.barsPerChord === 0) {
    const dur = barSeconds(bar.bpm) * bar.def.barsPerChord;
    for (const n of voice(bar.chord, 57, 4)) I.pad(k, at(c, 0, 0), n, dur, 1, has(c, 'low') ? 0.3 : 1);
  }
  if (has(c, 'drums')) {
    I.kick(k, at(c, 0, 0.002), 1, 1);
    I.kick(k, at(c, 10, 0.002), 0.9, 1);
    if (odd && rng.chance(0.5)) I.kick(k, at(c, rng.pick([2, 13]), 0.002), 0.7, 1);
    I.snare(k, at(c, 4, 0.002), 0.85, 1, 0.12);
    I.snare(k, at(c, 12, 0.002), 0.9, 1, 0.12);
    for (const s of [7, 9, 15]) if (rng.chance(0.3)) I.snare(k, at(c, s), 0.22, 0.8, 0.05);
    for (let s = 0; s < 16; s += 2) I.hat(k, at(c, s), s % 4 ? 0.55 : 0.35, s === 14 && rng.chance(0.3));
    if (lastBar(c)) for (let s = 12; s < 16; s++) I.snare(k, at(c, s, 0.002), 0.4 + (s - 12) * 0.15, 1, 0.1);
  }
  if (has(c, 'perc')) for (let s = 1; s < 16; s += 2) I.shaker(k, at(c, s), 0.4 + rng.next() * 0.3);
  if (has(c, 'bass')) {
    const root = bassNote(bar.chord, 40);
    I.reese(k, at(c, 0, 0), root, steps(c, 7));
    I.reese(k, at(c, 10, 0), odd && rng.chance(0.4) ? root + 3 : root, steps(c, 5), 0.85);
  }
  if (has(c, 'lead')) {
    const tones = voice(bar.chord, 69, 4);
    const mask = new Rng(seed(bar.sectionId, 7));
    for (let s = 0; s < 16; s++) if (mask.chance(0.45)) I.pluck(k, at(c, s, 0.002), tones[(s * 3) % tones.length], 0.5 + rng.next() * 0.4);
  }
};

// --- blues & jazz -----------------------------------------------------------

const jazz: Renderer = (c) => {
  const { k, rng, bar } = c;
  const swinging = has(c, 'drums');

  if (swinging) {
    for (const s of [0, 4, 6, 8, 12, 14]) I.ride(k, at(c, s), s === 4 || s === 12 ? 0.9 : 0.6);
    I.hat(k, at(c, 4), 0.35);
    I.hat(k, at(c, 12), 0.35);
    for (let b = 0; b < 4; b++) I.kick(k, at(c, b * 4), 0.18, 0);
    for (const s of [2, 6, 10, 14]) if (rng.chance(0.15)) I.snare(k, at(c, s), 0.18, 0.2, 0.2);
    if (lastBar(c)) {
      I.snare(k, at(c, 14), 0.5, 0.4, 0.2);
      I.kick(k, at(c, 14), 0.5, 0.2);
    }
  }
  if (has(c, 'perc')) for (let b = 0; b < 4; b++) I.brush(k, at(c, b * 4, 0), steps(c, 4), 0.9);

  if (has(c, 'bass')) {
    const root = bassNote(bar.chord, 36);
    const next = bassNote(bar.next, 36);
    if (swinging) {
      const third = root + bar.chord.tones[1];
      const fifth = root + bar.chord.tones[2];
      const line = [root, rng.pick([third, root + 2]), rng.pick([fifth, third]), next + rng.pick([-1, 1])];
      line.forEach((n, i) => I.upright(k, at(c, i * 4), n, steps(c, 3.6), i === 0 ? 1 : 0.8));
    } else {
      I.upright(k, at(c, 0), root, steps(c, 7));
      I.upright(k, at(c, 8), root + bar.chord.tones[2], steps(c, 7), 0.8);
    }
  }

  if (has(c, 'keys')) {
    // Rootless shell: third, seventh, and the top extension.
    const shell = voice({ root: bar.chord.root, tones: [bar.chord.tones[1], bar.chord.tones[3], bar.chord.tones[4] ?? bar.chord.tones[2]] }, 53);
    const hits = swinging ? rng.pick([[0, 6], [6], [0, 14], [2, 10], [6, 14]]) : [0];
    for (const s of hits) shell.forEach((n) => I.piano(k, at(c, s), n, steps(c, swinging ? 3 : 12), swinging ? 0.6 : 0.8));
  }

  if (has(c, 'lead')) {
    const solo = has(c, 'perc');
    phrase(c, solo ? 0.55 : 0.35, 3, (t, n, d) => I.vibes(k, t, n, d, 0.7));
  }
};

export const RENDERERS: Record<StationId, Renderer> = { lofi, dnb, jazz };

/** Station-wide tone: low-pass cutoff (open and for "low" sections), reverb level, vinyl level. */
export const TONE: Record<StationId, { open: number; low: number; wet: number; vinyl: number }> = {
  lofi: { open: 3800, low: 1500, wet: 0.35, vinyl: 1 },
  dnb: { open: 12000, low: 2200, wet: 0.3, vinyl: 0 },
  jazz: { open: 6500, low: 2200, wet: 0.4, vinyl: 0.35 },
};

export { STATIONS };
