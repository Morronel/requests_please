export type StationId = 'lofi' | 'dnb' | 'jazz';

export interface AudioPrefs {
  station: StationId | 'off';
  /** Music volume, 0 to 1. */
  volume: number;
  sfx: boolean;
}

// Kept apart from the game save so audio settings never collide with it.
const KEY = 'requests-please:audio:v1';
const DEFAULTS: AudioPrefs = { station: 'lofi', volume: 0.6, sfx: true };

function load(): AudioPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioPrefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let state = load();
const listeners = new Set<() => void>();

export const prefs = {
  get(): AudioPrefs {
    return state;
  },
  set(patch: Partial<AudioPrefs>): void {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Not fatal: settings just reset next visit.
    }
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
