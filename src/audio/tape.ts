/**
 * The radio's "tapes": pure data describing each station's tracks, and the
 * arrangement that lays them out bar by bar. No audio here, so it is testable.
 */
import type { StationId } from './prefs';

export const QUALITIES = {
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  dom7: [0, 4, 7, 10],
  dom9: [0, 4, 7, 10, 14],
  dom13: [0, 4, 10, 14, 21],
  dom7b9: [0, 4, 7, 10, 13],
  m7b5: [0, 3, 6, 10],
} as const;
export type Quality = keyof typeof QUALITIES;

export type Layer = 'drums' | 'bass' | 'keys' | 'lead' | 'perc' | 'low';

export interface Section {
  name: string;
  /** Length in passes through the track's progression. */
  cycles: number;
  layers: Layer[];
}

export interface TrackDef {
  name: string;
  bpm: number;
  /** MIDI note of the tonic, in the bass register. */
  key: number;
  /** [semitones above the tonic, quality] per chord. */
  prog: [number, Quality][];
  barsPerChord: number;
  /** Scale for melodies, as semitones above the tonic. */
  scale: number[];
  intro: Section[];
  body: Section[];
  outro: Section[];
}

export interface StationDef {
  id: StationId;
  name: string;
  freq: string;
  /** Swing for off-beat 16ths (lo-fi) or 8ths (jazz). 0.5 is straight. */
  swing16: number;
  swing8: number;
  tracks: TrackDef[];
}

export interface Chord {
  root: number;
  tones: readonly number[];
}

export interface Bar {
  track: number;
  bar: number;
  bpm: number;
  section: Section;
  /** Index of the section within the whole tape: seeds its melody. */
  sectionId: number;
  barInSection: number;
  sectionBars: number;
  chord: Chord;
  next: Chord;
  /** Bar index within the progression cycle. */
  cycleBar: number;
  def: TrackDef;
}

export const TRACK_SECONDS = 150;

const PENTA_MAJ = [0, 2, 4, 7, 9];
const PENTA_MIN = [0, 3, 5, 7, 10];
const BLUES = [0, 3, 5, 6, 7, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

const L = (...layers: Layer[]) => layers;

const lofiForm = (): Pick<TrackDef, 'intro' | 'body' | 'outro'> => ({
  intro: [{ name: 'intro', cycles: 1, layers: L('keys', 'low') }],
  body: [
    { name: 'verse', cycles: 2, layers: L('drums', 'bass', 'keys') },
    { name: 'hook', cycles: 2, layers: L('drums', 'bass', 'keys', 'lead', 'perc') },
    { name: 'dip', cycles: 1, layers: L('keys', 'lead', 'low') },
    { name: 'hook', cycles: 2, layers: L('drums', 'bass', 'keys', 'lead') },
  ],
  outro: [{ name: 'outro', cycles: 1, layers: L('keys', 'bass', 'low') }],
});

const dnbForm = (): Pick<TrackDef, 'intro' | 'body' | 'outro'> => ({
  intro: [
    { name: 'intro', cycles: 1, layers: L('keys', 'low') },
    { name: 'build', cycles: 1, layers: L('keys', 'perc', 'lead') },
  ],
  body: [
    { name: 'drop', cycles: 2, layers: L('drums', 'bass', 'keys', 'perc') },
    { name: 'roll', cycles: 2, layers: L('drums', 'bass', 'keys', 'lead', 'perc') },
    { name: 'break', cycles: 1, layers: L('keys', 'lead', 'low') },
  ],
  outro: [{ name: 'outro', cycles: 1, layers: L('drums', 'keys', 'low') }],
});

const jazzForm = (): Pick<TrackDef, 'intro' | 'body' | 'outro'> => ({
  intro: [{ name: 'head-in', cycles: 1, layers: L('keys', 'bass', 'low') }],
  body: [
    { name: 'head', cycles: 1, layers: L('drums', 'bass', 'keys', 'lead') },
    { name: 'comp', cycles: 1, layers: L('drums', 'bass', 'keys') },
    { name: 'solo', cycles: 1, layers: L('drums', 'bass', 'keys', 'lead', 'perc') },
  ],
  outro: [{ name: 'tag', cycles: 1, layers: L('keys', 'bass', 'low') }],
});

export const STATIONS: Record<StationId, StationDef> = {
  lofi: {
    id: 'lofi',
    name: 'lo-fi',
    freq: '88.0',
    swing16: 0.6,
    swing8: 0.5,
    tracks: [
      { name: 'packets to study to', bpm: 80, key: 41, prog: [[2, 'm9'], [7, 'dom9'], [0, 'maj9'], [9, 'm9']], barsPerChord: 1, scale: PENTA_MAJ, ...lofiForm() },
      { name: 'idle_timeout', bpm: 76, key: 38, prog: [[5, 'maj9'], [4, 'm7'], [2, 'm9'], [7, 'dom13']], barsPerChord: 1, scale: PENTA_MAJ, ...lofiForm() },
      { name: 'keepalive', bpm: 84, key: 39, prog: [[9, 'm9'], [5, 'maj9'], [0, 'maj9'], [7, 'dom9']], barsPerChord: 1, scale: PENTA_MAJ, ...lofiForm() },
      { name: 'rainy 404', bpm: 72, key: 45, prog: [[0, 'm9'], [5, 'm9'], [10, 'dom13'], [3, 'maj9']], barsPerChord: 1, scale: PENTA_MIN, ...lofiForm() },
    ],
  },
  dnb: {
    id: 'dnb',
    name: 'drum & bass',
    freq: '174.0',
    swing16: 0.5,
    swing8: 0.5,
    tracks: [
      { name: 'rate_limit_exceeded', bpm: 172, key: 45, prog: [[0, 'm9'], [8, 'maj9'], [5, 'm9'], [7, 'm7']], barsPerChord: 2, scale: DORIAN, ...dnbForm() },
      { name: 'syn_flood', bpm: 174, key: 41, prog: [[0, 'm11'], [8, 'maj9'], [3, 'maj9'], [10, 'dom9']], barsPerChord: 2, scale: PENTA_MIN, ...dnbForm() },
      { name: 'amen.pcap', bpm: 170, key: 38, prog: [[0, 'm9'], [5, 'm9'], [10, 'maj9'], [7, 'm7']], barsPerChord: 2, scale: DORIAN, ...dnbForm() },
      { name: 'zero_day', bpm: 174, key: 36, prog: [[0, 'm9'], [8, 'maj9'], [3, 'maj9'], [10, 'dom9']], barsPerChord: 2, scale: PENTA_MIN, ...dnbForm() },
    ],
  },
  jazz: {
    id: 'jazz',
    name: 'blues & jazz',
    freq: '101.3',
    swing16: 0.5,
    swing8: 0.65,
    tracks: [
      {
        name: 'blue_screen_blues',
        bpm: 100,
        key: 46,
        prog: [[0, 'dom13'], [5, 'dom9'], [0, 'dom13'], [0, 'dom13'], [5, 'dom9'], [5, 'dom9'], [0, 'dom13'], [9, 'dom7b9'], [2, 'm9'], [7, 'dom13'], [0, 'dom13'], [7, 'dom7b9']],
        barsPerChord: 1,
        scale: BLUES,
        ...jazzForm(),
      },
      {
        name: 'round robin',
        bpm: 112,
        key: 41,
        prog: [[2, 'm9'], [7, 'dom13'], [0, 'maj9'], [9, 'dom7b9'], [2, 'm9'], [7, 'dom13'], [0, 'maj9'], [0, 'maj9']],
        barsPerChord: 1,
        scale: PENTA_MAJ,
        ...jazzForm(),
      },
      {
        name: 'smooth handshake',
        bpm: 92,
        key: 36,
        prog: [[0, 'm9'], [0, 'm9'], [0, 'm9'], [0, 'm9'], [5, 'm9'], [5, 'm9'], [0, 'm9'], [0, 'm9'], [8, 'dom13'], [7, 'dom7b9'], [0, 'm9'], [7, 'dom7b9']],
        barsPerChord: 1,
        scale: BLUES,
        ...jazzForm(),
      },
      {
        name: 'late night on-call',
        bpm: 96,
        key: 39,
        prog: [[0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, 'dom13'], [5, 'maj9'], [10, 'dom9'], [0, 'maj9'], [7, 'dom13']],
        barsPerChord: 1,
        scale: PENTA_MAJ,
        ...jazzForm(),
      },
    ],
  },
};

export const barSeconds = (bpm: number) => (60 / bpm) * 4;

function chordAt(def: TrackDef, cycleBar: number): Chord {
  const [deg, q] = def.prog[Math.floor(cycleBar / def.barsPerChord) % def.prog.length];
  return { root: def.key + deg, tones: QUALITIES[q] };
}

/** Lays out one track: intro, then body sections on repeat until ~TRACK_SECONDS, then outro. */
export function arrange(def: TrackDef, track: number, sectionBase = 0): Bar[] {
  const cycle = def.prog.length * def.barsPerChord;
  const barSec = barSeconds(def.bpm);
  const outroBars = def.outro.reduce((n, s) => n + s.cycles * cycle, 0);
  const sections: Section[] = [...def.intro];
  let bars = sections.reduce((n, s) => n + s.cycles * cycle, 0);
  for (let i = 0; (bars + outroBars) * barSec < TRACK_SECONDS; i++) {
    const s = def.body[i % def.body.length];
    sections.push(s);
    bars += s.cycles * cycle;
  }
  sections.push(...def.outro);

  const out: Bar[] = [];
  sections.forEach((section, si) => {
    const sectionBars = section.cycles * cycle;
    for (let b = 0; b < sectionBars; b++) {
      const cycleBar = b % cycle;
      out.push({
        track,
        bar: out.length,
        bpm: def.bpm,
        section,
        sectionId: sectionBase + si,
        barInSection: b,
        sectionBars,
        chord: chordAt(def, cycleBar),
        next: chordAt(def, cycleBar + def.barsPerChord - (cycleBar % def.barsPerChord)),
        cycleBar,
        def,
      });
    }
  });
  return out;
}

/** The whole tape for a station: every track back to back, about ten minutes. */
export function tape(station: StationDef): Bar[] {
  const out: Bar[] = [];
  station.tracks.forEach((def, i) => out.push(...arrange(def, i, i * 100)));
  return out;
}

export function tapeSeconds(bars: Bar[]): number {
  return bars.reduce((s, b) => s + barSeconds(b.bpm), 0);
}

/** Close voicing: every chord tone folded into the octave starting at `floor`. */
export function voice(chord: Chord, floor: number, maxTones = 5): number[] {
  const notes = chord.tones.slice(0, maxTones).map((iv) => floor + ((((chord.root + iv - floor) % 12) + 12) % 12));
  return [...new Set(notes)].sort((a, b) => a - b);
}

/** The chord root folded into a bass register starting at `floor`. */
export function bassNote(chord: Chord, floor = 33): number {
  return floor + ((((chord.root - floor) % 12) + 12) % 12);
}
